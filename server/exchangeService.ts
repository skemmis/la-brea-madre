/**
 * Exchange service — the live prediction-market floor.
 *
 * Markets run on the real day: each PT day a rotating board opens (specs from
 * exchangeBoard, priced from trailing history), trading closes at midnight,
 * and settlement happens when the city's records for that day land — usually
 * a day or two later, like any market whose source publishes on a lag.
 *
 * The pure LMSR engine (shared/core) prices, trades, and settles; this shell
 * decides which markets exist, when they close, and against what real data.
 * Every fill is journaled (exchange_trade) for price history and the public
 * tape; every settlement is journaled (exchange_payout) for portfolios.
 */
import { pool } from "./db";
import { getOrInitGame, saveState, ensurePlayer, pid } from "./gameService";
import { getMetricSeries } from "./storage";
import {
  openMarket,
  buyContracts,
  sellContracts,
  resolveMarket,
  sharesForBudget,
  quoteSellRefund,
  marketView,
  marketPrices,
  type MarketView,
  type Settlement,
} from "@shared/core";
import {
  buildLiveLine,
  buildLiveFaceoff,
  buildWeekdayLine,
  dowBreakdown,
  median,
  type MetricPoint,
} from "./marketMetrics";
import { boardSpecsFor, VIOLATIONS, type BoardSpec } from "./exchangeBoard";

const WINDOW = 30; // trailing days used to set lines + opening odds
const YES_NO = ["YES", "NO"];

function todayPT(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .split("T")[0];
}

// ─── Runtime tables ──────────────────────────────────────────────────────────────

export async function ensureExchangeRuntime(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS game_clock (id text PRIMARY KEY, current_day text NOT NULL)`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS exchange_round (
       market_id text PRIMARY KEY,
       market_type text NOT NULL,
       target_date text NOT NULL,
       outcome_index integer,
       line integer,
       actual_a integer,
       actual_b integer,
       settled boolean NOT NULL DEFAULT false
     )`
  );
  // Live-exchange columns (the table predates the live floor).
  await pool.query(`ALTER TABLE exchange_round ALTER COLUMN outcome_index DROP NOT NULL`);
  for (const col of [
    "kind text",
    "category text",
    "metric_a text",
    "metric_b text",
    "label_a text",
    "label_b text",
    "question text",
    "rules text",
    "base_rate_yes real",
    "settled_at timestamptz",
  ]) {
    await pool.query(`ALTER TABLE exchange_round ADD COLUMN IF NOT EXISTS ${col}`);
  }

  // The tape: every fill, with the post-trade price curve for charts.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS exchange_trade (
       id serial PRIMARY KEY,
       market_id text NOT NULL,
       user_id integer NOT NULL,
       action text NOT NULL,
       outcome integer NOT NULL,
       shares real NOT NULL,
       cost real NOT NULL,
       yes_price real NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now()
     )`
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS exchange_trade_market_idx ON exchange_trade (market_id, id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS exchange_trade_user_idx ON exchange_trade (user_id, id)`);

  // The ledger: per-player settlement results.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS exchange_payout (
       id serial PRIMARY KEY,
       market_id text NOT NULL,
       user_id integer NOT NULL,
       target_date text NOT NULL,
       question text NOT NULL,
       outcome text NOT NULL,
       won boolean NOT NULL,
       shares real NOT NULL,
       spent real NOT NULL,
       payout real NOT NULL,
       profit real NOT NULL,
       settled_at timestamptz NOT NULL DEFAULT now()
     )`
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS exchange_payout_user_idx ON exchange_payout (user_id, id)`);
}

// ─── Round rows ──────────────────────────────────────────────────────────────────

interface RoundRow {
  market_id: string;
  market_type: string;
  target_date: string;
  outcome_index: number | null;
  line: number | null;
  actual_a: number | null;
  actual_b: number | null;
  settled: boolean;
  kind: string | null;
  category: string | null;
  metric_a: string | null;
  metric_b: string | null;
  label_a: string | null;
  label_b: string | null;
  question: string | null;
  rules: string | null;
  base_rate_yes: number | null;
  settled_at: Date | null;
}

async function roundsByIds(ids: string[]): Promise<Map<string, RoundRow>> {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(`SELECT * FROM exchange_round WHERE market_id = ANY($1)`, [ids]);
  return new Map((rows as RoundRow[]).map((r) => [r.market_id, r]));
}

// ─── Board construction ───────────────────────────────────────────────────────────

async function buildAndOpen(spec: BoardSpec, day: string): Promise<boolean> {
  const id = `${spec.specId}-${day}`;
  let { state, config } = await getOrInitGame();
  if (state.markets?.[id]) return false;

  const a = (await getMetricSeries(spec.metricA)) as MetricPoint[];
  let line = 0;
  let baseRateYes: number;

  if (spec.kind === "faceoff") {
    const b = (await getMetricSeries(spec.metricB!)) as MetricPoint[];
    const m = buildLiveFaceoff(a, b, WINDOW);
    if (!m) return false;
    baseRateYes = m.baseRateYes;
  } else if (spec.kind === "weekday") {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const m = buildWeekdayLine(a, weekday);
    if (!m) return false;
    line = m.line;
    baseRateYes = m.baseRateYes;
  } else {
    const m = buildLiveLine(a, WINDOW);
    if (!m) return false;
    line = m.line;
    baseRateYes = m.baseRateYes;
  }

  const question = spec.question(line);
  state = openMarket(state, config, {
    id,
    question,
    outcomes: YES_NO,
    baseRates: [baseRateYes, 1 - baseRateYes],
  });
  await saveState(state);

  await pool.query(
    `INSERT INTO exchange_round
       (market_id, market_type, target_date, line, kind, category, metric_a, metric_b,
        label_a, label_b, question, rules, base_rate_yes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (market_id) DO NOTHING`,
    [
      id, spec.specId, day, line, spec.kind, spec.category, spec.metricA,
      spec.metricB ?? null, spec.labelA ?? null, spec.labelB ?? null,
      question, spec.rules, baseRateYes,
    ]
  );
  return true;
}

/** Ensure today's board exists (idempotent). */
export async function ensureTodaysBoard(): Promise<string> {
  const day = todayPT();
  const { rows } = await pool.query(
    `SELECT market_id FROM exchange_round WHERE target_date = $1`,
    [day]
  );
  const existing = new Set(rows.map((r: any) => r.market_id));
  for (const spec of boardSpecsFor(day)) {
    if (!existing.has(`${spec.specId}-${day}`)) await buildAndOpen(spec, day);
  }
  return day;
}

// ─── Enrichment (volume, tape, sparkline) ─────────────────────────────────────────

interface MarketStats {
  volume: number;
  traders: number;
  trades: number;
  spark: number[]; // YES price after each fill (chronological)
}

async function statsByMarket(ids: string[]): Promise<Map<string, MarketStats>> {
  const out = new Map<string, MarketStats>();
  if (!ids.length) return out;
  const { rows } = await pool.query(
    `SELECT market_id,
            COALESCE(SUM(ABS(cost)), 0) AS volume,
            COUNT(DISTINCT user_id) AS traders,
            COUNT(*) AS trades
     FROM exchange_trade WHERE market_id = ANY($1) GROUP BY market_id`,
    [ids]
  );
  for (const r of rows as any[]) {
    out.set(r.market_id, {
      volume: Math.round(Number(r.volume)),
      traders: Number(r.traders),
      trades: Number(r.trades),
      spark: [],
    });
  }
  const { rows: ticks } = await pool.query(
    `SELECT market_id, yes_price FROM exchange_trade WHERE market_id = ANY($1) ORDER BY id ASC`,
    [ids]
  );
  for (const t of ticks as any[]) {
    const s = out.get(t.market_id);
    if (s) s.spark.push(Number(t.yes_price));
  }
  return out;
}

export interface EnrichedMarket extends MarketView {
  targetDate: string;
  category: string;
  kind: string;
  line: number;
  labelA: string | null;
  labelB: string | null;
  state: "trading" | "closed" | "settled";
  volume: number;
  traders: number;
  spark: number[]; // opening odds + fills
  baseRateYes: number;
  outcome?: string | null;
  actualA?: number | null;
  actualB?: number | null;
  myShares?: number[];
  mySpent?: number;
}

function enrich(
  view: MarketView,
  round: RoundRow,
  stats: MarketStats | undefined,
  today: string,
  userId?: number,
  holdings?: number[],
  spent?: number
): EnrichedMarket {
  const st: EnrichedMarket["state"] = round.settled
    ? "settled"
    : round.target_date < today
      ? "closed"
      : "trading";
  return {
    ...view,
    targetDate: round.target_date,
    category: round.category ?? "totals",
    kind: round.kind ?? "overunder",
    line: round.line ?? 0,
    labelA: round.label_a,
    labelB: round.label_b,
    state: st,
    volume: stats?.volume ?? 0,
    traders: stats?.traders ?? 0,
    spark: [round.base_rate_yes ?? view.prices[0], ...(stats?.spark ?? [])],
    baseRateYes: round.base_rate_yes ?? view.prices[0],
    outcome: round.settled && round.outcome_index != null ? YES_NO[round.outcome_index] : null,
    actualA: round.actual_a,
    actualB: round.actual_b,
    myShares: userId != null ? holdings : undefined,
    mySpent: userId != null ? spent : undefined,
  };
}

// ─── Board view ──────────────────────────────────────────────────────────────────

export interface BoardView {
  day: string;
  markets: EnrichedMarket[]; // trading today
  closed: EnrichedMarket[]; // awaiting the city's records
  settled: EnrichedMarket[]; // recent results
  empty?: string;
}

export async function getBoard(userId?: number): Promise<BoardView> {
  const day = await ensureTodaysBoard();
  const { state } = await getOrInitGame();
  const me = userId != null ? pid(userId) : null;

  const { rows } = await pool.query(
    `SELECT * FROM exchange_round
     WHERE target_date >= to_char(now() AT TIME ZONE 'America/Los_Angeles' - interval '5 days', 'YYYY-MM-DD')
     ORDER BY target_date DESC, market_id`
  );
  const rounds = rows as RoundRow[];
  const stats = await statsByMarket(rounds.map((r) => r.market_id));

  const markets: EnrichedMarket[] = [];
  const closed: EnrichedMarket[] = [];
  const settled: EnrichedMarket[] = [];
  for (const r of rounds) {
    const m = state.markets?.[r.market_id];
    if (!m) continue;
    const e = enrich(
      marketView(m),
      r,
      stats.get(r.market_id),
      day,
      userId,
      me ? m.holdings[me] : undefined,
      me ? m.spent[me] : undefined
    );
    if (e.state === "trading") markets.push(e);
    else if (e.state === "closed") closed.push(e);
    else if (settled.length < 12) settled.push(e);
  }

  if (!markets.length && !closed.length && !settled.length) {
    return { day, markets, closed, settled, empty: "Not enough citation history yet — run the pipeline." };
  }
  return { day, markets, closed, settled };
}

// ─── Market detail ────────────────────────────────────────────────────────────────

export interface TradeRow {
  id: number;
  user: string;
  userId: number;
  action: "buy" | "sell";
  outcome: string;
  shares: number;
  cost: number;
  yesPrice: number;
  at: string;
  marketId?: string;
  question?: string;
}

export interface HolderRow {
  user: string;
  userId: number;
  yes: number;
  no: number;
  spent: number;
}

export interface SeriesPanel {
  metric: string;
  label: string;
  series: MetricPoint[]; // trailing window for charts
  dow: { dow: number; avg: number; n: number }[];
  stats: { mean: number; median: number; max: number; maxDate: string; last: number; lastDate: string };
}

export interface MarketDetail {
  market: EnrichedMarket;
  rules: string;
  question: string;
  priceHistory: { t: string; yes: number }[];
  trades: TradeRow[];
  holders: HolderRow[];
  research: SeriesPanel[];
}

async function seriesPanel(metric: string, label: string): Promise<SeriesPanel | null> {
  const series = (await getMetricSeries(metric)) as MetricPoint[];
  if (!series.length) return null;
  const tail = series.slice(-180);
  const values = tail.map((p) => p.value);
  const maxV = Math.max(...values);
  const maxAt = tail[values.indexOf(maxV)];
  const last = tail[tail.length - 1];
  return {
    metric,
    label,
    series: tail,
    dow: dowBreakdown(series, 180),
    stats: {
      mean: Math.round(values.reduce((a, c) => a + c, 0) / values.length),
      median: median(values),
      max: maxV,
      maxDate: maxAt.date,
      last: last.value,
      lastDate: last.date,
    },
  };
}

const METRIC_FALLBACK_LABELS: Record<string, string> = {
  citations: "Parking tickets / day",
  fines: "Fines collected / day ($)",
  dead_animals: "Dead animal reports / day",
};

/** Chart caption for a metric series, e.g. "Venice — tickets / day". */
function researchLabel(metric: string, label: string | null): string {
  if (metric.startsWith("hoodcit:")) return `${label} — tickets / day`;
  if (metric.startsWith("hoodda:")) return `${label} — dead animals / day`;
  if (metric.startsWith("viol:")) {
    const v = VIOLATIONS[metric.slice(5)];
    return v ? `${v.phrase} / day` : metric;
  }
  if (label) return `${label} ticketed / day`;
  return METRIC_FALLBACK_LABELS[metric] ?? metric;
}

export async function getMarketDetail(marketId: string, userId?: number): Promise<MarketDetail> {
  const today = todayPT();
  const { state } = await getOrInitGame();
  const m = state.markets?.[marketId];
  const round = (await roundsByIds([marketId])).get(marketId);
  if (!m || !round) throw new Error("No such market.");

  const me = userId != null ? pid(userId) : null;
  const stats = (await statsByMarket([marketId])).get(marketId);
  const market = enrich(
    marketView(m),
    round,
    stats,
    today,
    userId,
    me ? m.holdings[me] : undefined,
    me ? m.spent[me] : undefined
  );

  const { rows: tradeRows } = await pool.query(
    `SELECT t.*, u.display_name FROM exchange_trade t
     JOIN users u ON u.id = t.user_id
     WHERE t.market_id = $1 ORDER BY t.id DESC LIMIT 60`,
    [marketId]
  );
  const trades: TradeRow[] = (tradeRows as any[]).map((t) => ({
    id: t.id,
    user: t.display_name,
    userId: t.user_id,
    action: t.action,
    outcome: YES_NO[t.outcome],
    shares: Number(t.shares),
    cost: Number(t.cost),
    yesPrice: Number(t.yes_price),
    at: t.created_at.toISOString(),
  }));

  // Price history: opening odds, then one point per fill.
  const { rows: tickRows } = await pool.query(
    `SELECT yes_price, created_at FROM exchange_trade WHERE market_id = $1 ORDER BY id ASC`,
    [marketId]
  );
  const priceHistory = [
    { t: `${round.target_date}T00:00:00.000Z`, yes: round.base_rate_yes ?? market.prices[0] },
    ...(tickRows as any[]).map((t) => ({ t: t.created_at.toISOString(), yes: Number(t.yes_price) })),
  ];

  // Holders, by name (fully public floor).
  const holderIds = Object.entries(m.holdings)
    .filter(([, h]) => (h[0] ?? 0) > 1e-6 || (h[1] ?? 0) > 1e-6)
    .map(([p]) => Number(p));
  let holders: HolderRow[] = [];
  if (holderIds.length) {
    const { rows: users } = await pool.query(
      `SELECT id, display_name FROM users WHERE id = ANY($1)`,
      [holderIds]
    );
    const names = new Map((users as any[]).map((u) => [u.id, u.display_name]));
    holders = holderIds
      .map((uid) => {
        const h = m.holdings[pid(uid)] ?? [0, 0];
        return {
          user: names.get(uid) ?? `Player ${uid}`,
          userId: uid,
          yes: h[0] ?? 0,
          no: h[1] ?? 0,
          spent: m.spent[pid(uid)] ?? 0,
        };
      })
      .sort((a, b) => b.yes + b.no - (a.yes + a.no))
      .slice(0, 20);
  }

  // The research desk: the underlying series for each leg.
  const research: SeriesPanel[] = [];
  if (round.metric_a) {
    const p = await seriesPanel(round.metric_a, researchLabel(round.metric_a, round.label_a));
    if (p) research.push(p);
  }
  if (round.metric_b) {
    const p = await seriesPanel(round.metric_b, researchLabel(round.metric_b, round.label_b));
    if (p) research.push(p);
  }

  return {
    market,
    rules: round.rules ?? "",
    question: m.question,
    priceHistory,
    trades,
    holders,
    research,
  };
}

// ─── Trading ─────────────────────────────────────────────────────────────────────

export interface TradeResult {
  market: MarketView;
  crude: number;
  shares: number;
  cost: number;
}

async function assertTradable(marketId: string): Promise<void> {
  const round = (await roundsByIds([marketId])).get(marketId);
  if (!round) throw new Error("That market isn't on the board.");
  if (round.settled) throw new Error("That market has settled.");
  if (round.target_date !== todayPT()) {
    throw new Error("Trading is closed — awaiting the city's records.");
  }
}

async function journal(
  marketId: string,
  userId: number,
  action: "buy" | "sell",
  outcome: number,
  shares: number,
  cost: number,
  yesPrice: number
): Promise<void> {
  await pool.query(
    `INSERT INTO exchange_trade (market_id, user_id, action, outcome, shares, cost, yes_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [marketId, userId, action, outcome, shares, cost, yesPrice]
  );
}

export async function buy(
  userId: number,
  marketId: string,
  outcome: number,
  budget: number
): Promise<TradeResult> {
  if (!(budget > 0)) throw new Error("Stake must be positive.");
  await assertTradable(marketId);

  let { state, config } = await getOrInitGame();
  state = await ensurePlayer(state, config, userId);
  const market = state.markets?.[marketId];
  if (!market || market.status !== "open") throw new Error("That market isn't open.");

  const before = state.players[pid(userId)].crude;
  const shares = sharesForBudget(market, outcome, budget);
  state = buyContracts(state, config, pid(userId), marketId, outcome, shares);
  await saveState(state);

  const m = state.markets[marketId];
  const cost = before - state.players[pid(userId)].crude;
  await journal(marketId, userId, "buy", outcome, shares, cost, marketPrices(m)[0]);

  return { market: marketView(m), crude: state.players[pid(userId)].crude, shares, cost };
}

export async function sell(
  userId: number,
  marketId: string,
  outcome: number,
  shares: number
): Promise<TradeResult> {
  if (!(shares > 0)) throw new Error("Share count must be positive.");
  await assertTradable(marketId);

  let { state, config } = await getOrInitGame();
  state = await ensurePlayer(state, config, userId);
  const market = state.markets?.[marketId];
  if (!market || market.status !== "open") throw new Error("That market isn't open.");

  const refund = quoteSellRefund(market, outcome, shares);
  state = sellContracts(state, config, pid(userId), marketId, outcome, shares);
  await saveState(state);

  const m = state.markets[marketId];
  await journal(marketId, userId, "sell", outcome, shares, -refund, marketPrices(m)[0]);

  return { market: marketView(m), crude: state.players[pid(userId)].crude, shares, cost: -refund };
}

// ─── Settlement ──────────────────────────────────────────────────────────────────

/**
 * A day's records are "in" when the source series has moved past it — the
 * city published a later day, so the target day's count is final (or truly
 * zero for sparse cohorts).
 */
async function dataReady(round: RoundRow): Promise<boolean> {
  const probe = round.metric_a ?? "citations";
  const base =
    probe.startsWith("make:") || probe.startsWith("color:") ||
    probe.startsWith("viol:") || probe.startsWith("hoodcit:")
      ? "citations"
      : probe.startsWith("hoodda:")
        ? "dead_animals"
        : probe;
  const series = (await getMetricSeries(base)) as MetricPoint[];
  return series.some((p) => p.date > round.target_date);
}

async function valueOn(metric: string, date: string): Promise<number> {
  const series = (await getMetricSeries(metric)) as MetricPoint[];
  return series.find((p) => p.date === date)?.value ?? 0;
}

export interface SettleOutcome {
  marketId: string;
  question: string;
  outcome: string;
  actualA: number;
  actualB: number;
  line: number;
}

/** Settle every closed round whose records have arrived. Returns what settled. */
export async function settleDue(): Promise<SettleOutcome[]> {
  const today = todayPT();
  const { rows } = await pool.query(
    `SELECT * FROM exchange_round WHERE settled = false AND target_date < $1`,
    [today]
  );
  const out: SettleOutcome[] = [];
  let { state, config } = await getOrInitGame();
  let dirty = false;

  for (const round of rows as RoundRow[]) {
    const market = state.markets?.[round.market_id];
    if (!market || market.status !== "open") {
      // Round exists without a live market (legacy rows) — close it out.
      await pool.query(
        `UPDATE exchange_round SET settled = true, settled_at = now() WHERE market_id = $1`,
        [round.market_id]
      );
      continue;
    }

    let outcomeIndex = round.outcome_index; // legacy replay rounds knew theirs
    let actualA = round.actual_a ?? 0;
    let actualB = round.actual_b ?? 0;

    if (outcomeIndex == null) {
      if (!(await dataReady(round))) continue; // records not in yet
      actualA = await valueOn(round.metric_a!, round.target_date);
      if (round.kind === "faceoff") {
        actualB = await valueOn(round.metric_b!, round.target_date);
        outcomeIndex = actualA > actualB ? 0 : 1;
      } else {
        outcomeIndex = actualA > (round.line ?? 0) ? 0 : 1;
      }
    }

    state = resolveMarket(state, config, round.market_id, outcomeIndex);
    dirty = true;
    const settlement: Settlement | null = state.lastSettlement ?? null;

    await pool.query(
      `UPDATE exchange_round
       SET settled = true, settled_at = now(), outcome_index = $2, actual_a = $3, actual_b = $4
       WHERE market_id = $1`,
      [round.market_id, outcomeIndex, actualA, actualB]
    );

    if (settlement) {
      for (const [playerId, entry] of Object.entries(settlement.perPlayer)) {
        if (entry.shares === 0 && entry.spent === 0) continue;
        await pool.query(
          `INSERT INTO exchange_payout
             (market_id, user_id, target_date, question, outcome, won, shares, spent, payout, profit)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            round.market_id,
            Number(playerId),
            round.target_date,
            market.question,
            YES_NO[outcomeIndex],
            entry.profit > 0,
            entry.shares,
            entry.spent,
            entry.payout,
            entry.profit,
          ]
        );
      }
    }

    out.push({
      marketId: round.market_id,
      question: market.question,
      outcome: YES_NO[outcomeIndex],
      actualA,
      actualB,
      line: round.line ?? 0,
    });
  }

  if (dirty) await saveState(state);
  return out;
}

/** Nightly housekeeping: settle what's due, open today's board. */
export async function rollExchangeDay(): Promise<{ settled: number; day: string }> {
  const settled = await settleDue();
  const day = await ensureTodaysBoard();
  return { settled: settled.length, day };
}

// ─── The tape (public activity) ───────────────────────────────────────────────────

export async function getActivity(limit = 40): Promise<TradeRow[]> {
  const { rows } = await pool.query(
    `SELECT t.*, u.display_name, r.question
     FROM exchange_trade t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN exchange_round r ON r.market_id = t.market_id
     ORDER BY t.id DESC LIMIT $1`,
    [limit]
  );
  return (rows as any[]).map((t) => ({
    id: t.id,
    user: t.display_name,
    userId: t.user_id,
    action: t.action,
    outcome: YES_NO[t.outcome],
    shares: Number(t.shares),
    cost: Number(t.cost),
    yesPrice: Number(t.yes_price),
    at: t.created_at.toISOString(),
    marketId: t.market_id,
    question: t.question ?? undefined,
  }));
}

// ─── Portfolio ───────────────────────────────────────────────────────────────────

export interface OpenPosition {
  marketId: string;
  question: string;
  targetDate: string;
  state: "trading" | "closed";
  outcomes: string[];
  prices: number[];
  shares: number[];
  spent: number;
  value: number;
}

export interface PortfolioView {
  crude: number;
  open: OpenPosition[];
  history: {
    marketId: string;
    question: string;
    targetDate: string;
    outcome: string;
    won: boolean;
    shares: number;
    spent: number;
    payout: number;
    profit: number;
    settledAt: string;
  }[];
  trades: TradeRow[];
  equity: { date: string; realized: number }[]; // cumulative settled P&L
  stats: {
    realized: number;
    openValue: number;
    openSpent: number;
    volume: number;
    marketsTraded: number;
    settledMarkets: number;
    wins: number;
    bestProfit: number;
    worstLoss: number;
  };
}

export async function getPortfolio(userId: number): Promise<PortfolioView> {
  const today = todayPT();
  const { state } = await getOrInitGame();
  const me = pid(userId);

  const openIds = Object.values(state.markets ?? {})
    .filter((m) => m.status === "open" && m.holdings[me]?.some((s) => s > 1e-6))
    .map((m) => m.id);
  const rounds = await roundsByIds(openIds);

  const open: OpenPosition[] = [];
  for (const id of openIds) {
    const m = state.markets![id];
    const r = rounds.get(id);
    const prices = marketPrices(m);
    const shares = m.holdings[me]!;
    open.push({
      marketId: id,
      question: m.question,
      targetDate: r?.target_date ?? "",
      state: r && r.target_date < today ? "closed" : "trading",
      outcomes: m.outcomes,
      prices,
      shares,
      spent: m.spent[me] ?? 0,
      value: shares.reduce((a, s, i) => a + s * prices[i], 0),
    });
  }

  const { rows: payoutRows } = await pool.query(
    `SELECT * FROM exchange_payout WHERE user_id = $1 ORDER BY id DESC LIMIT 200`,
    [userId]
  );
  const history = (payoutRows as any[]).map((p) => ({
    marketId: p.market_id,
    question: p.question,
    targetDate: p.target_date,
    outcome: p.outcome,
    won: p.won,
    shares: Number(p.shares),
    spent: Number(p.spent),
    payout: Number(p.payout),
    profit: Number(p.profit),
    settledAt: p.settled_at.toISOString(),
  }));

  const { rows: tradeRows } = await pool.query(
    `SELECT t.*, u.display_name, r.question
     FROM exchange_trade t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN exchange_round r ON r.market_id = t.market_id
     WHERE t.user_id = $1 ORDER BY t.id DESC LIMIT 100`,
    [userId]
  );
  const trades: TradeRow[] = (tradeRows as any[]).map((t) => ({
    id: t.id,
    user: t.display_name,
    userId: t.user_id,
    action: t.action,
    outcome: YES_NO[t.outcome],
    shares: Number(t.shares),
    cost: Number(t.cost),
    yesPrice: Number(t.yes_price),
    at: t.created_at.toISOString(),
    marketId: t.market_id,
    question: t.question ?? undefined,
  }));

  // Equity curve: cumulative realized P&L by settlement day (oldest → newest).
  const byDay = new Map<string, number>();
  for (const h of [...history].reverse()) {
    const d = h.settledAt.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + h.profit);
  }
  let cum = 0;
  const equity = [...byDay.entries()].map(([date, p]) => {
    cum += p;
    return { date, realized: Math.round(cum * 10) / 10 };
  });

  const realized = history.reduce((a, h) => a + h.profit, 0);
  const { rows: volRows } = await pool.query(
    `SELECT COALESCE(SUM(ABS(cost)),0) AS volume, COUNT(DISTINCT market_id) AS n
     FROM exchange_trade WHERE user_id = $1`,
    [userId]
  );

  return {
    crude: state.players[me]?.crude ?? 0,
    open,
    history,
    trades,
    equity,
    stats: {
      realized: Math.round(realized * 10) / 10,
      openValue: Math.round(open.reduce((a, p) => a + p.value, 0) * 10) / 10,
      openSpent: Math.round(open.reduce((a, p) => a + p.spent, 0) * 10) / 10,
      volume: Math.round(Number(volRows[0].volume)),
      marketsTraded: Number(volRows[0].n),
      settledMarkets: history.length,
      wins: history.filter((h) => h.won).length,
      bestProfit: history.length ? Math.max(...history.map((h) => h.profit)) : 0,
      worstLoss: history.length ? Math.min(...history.map((h) => h.profit)) : 0,
    },
  };
}

// ─── Public profile ───────────────────────────────────────────────────────────────

export interface PublicProfile {
  userId: number;
  name: string;
  crude: number;
  totalHexes: number;
  joined: string;
  market: {
    realized: number;
    volume: number;
    marketsTraded: number;
    settledMarkets: number;
    wins: number;
  };
  recentTrades: TradeRow[];
}

export async function getPublicProfile(userId: number): Promise<PublicProfile> {
  const { rows: users } = await pool.query(
    `SELECT id, display_name, crude, total_hexes, created_at FROM users WHERE id = $1`,
    [userId]
  );
  if (!users.length) throw new Error("No such player.");
  const u = users[0] as any;

  const { rows: payoutAgg } = await pool.query(
    `SELECT COALESCE(SUM(profit),0) AS realized, COUNT(*) AS settled,
            COUNT(*) FILTER (WHERE won) AS wins
     FROM exchange_payout WHERE user_id = $1`,
    [userId]
  );
  const { rows: volRows } = await pool.query(
    `SELECT COALESCE(SUM(ABS(cost)),0) AS volume, COUNT(DISTINCT market_id) AS n
     FROM exchange_trade WHERE user_id = $1`,
    [userId]
  );
  const { rows: tradeRows } = await pool.query(
    `SELECT t.*, r.question FROM exchange_trade t
     LEFT JOIN exchange_round r ON r.market_id = t.market_id
     WHERE t.user_id = $1 ORDER BY t.id DESC LIMIT 20`,
    [userId]
  );

  return {
    userId: u.id,
    name: u.display_name,
    crude: u.crude,
    totalHexes: u.total_hexes,
    joined: u.created_at.toISOString().slice(0, 10),
    market: {
      realized: Math.round(Number(payoutAgg[0].realized) * 10) / 10,
      volume: Math.round(Number(volRows[0].volume)),
      marketsTraded: Number(volRows[0].n),
      settledMarkets: Number(payoutAgg[0].settled),
      wins: Number(payoutAgg[0].wins),
    },
    recentTrades: (tradeRows as any[]).map((t) => ({
      id: t.id,
      user: u.display_name,
      userId: u.id,
      action: t.action,
      outcome: YES_NO[t.outcome],
      shares: Number(t.shares),
      cost: Number(t.cost),
      yesPrice: Number(t.yes_price),
      at: t.created_at.toISOString(),
      marketId: t.market_id,
      question: t.question ?? undefined,
    })),
  };
}
