/**
 * Exchange service — the standing prediction-market board.
 *
 * Runs on a hidden clock set in the real past: the in-game "today" is a real
 * historical LA day. Each day a board of YES/NO markets opens (one per market
 * type, priced from the trailing history); players hold positions; "End the
 * day" settles every market from that day's real numbers and advances the
 * clock to the next day.
 *
 * The pure LMSR engine (shared/core) prices and settles; this shell decides
 * which markets exist, when they resolve, and against what real data.
 */
import { pool } from "./db";
import { getOrInitGame, saveState, ensurePlayer, pid } from "./gameService";
import { getMetricSeries } from "./storage";
import {
  openMarket,
  buyContracts,
  resolveMarket,
  sharesForBudget,
  marketView,
  marketPrices,
  type MarketView,
  type Settlement,
} from "@shared/core";
import {
  buildOverUnderMarket,
  buildFaceoffMarket,
  type MetricPoint,
} from "./marketMetrics";

const CLOCK_ID = "singleton";
const WINDOW = 30; // trailing days used to set the line + odds
const CALENDAR_METRIC = "citations"; // the always-present metric that defines the day grid

// ─── Market type registry ───────────────────────────────────────────────────────

interface MarketType {
  id: string;
  kind: "overunder" | "faceoff";
  metric?: string; // overunder
  metricA?: string; // faceoff
  metricB?: string;
  question: (ctx: { line: number }) => string;
}

const MARKET_TYPES: MarketType[] = [
  {
    id: "fines",
    kind: "overunder",
    metric: "fines",
    question: ({ line }) => `Will the city collect more than $${line.toLocaleString()} in parking fines today?`,
  },
  {
    id: "citations",
    kind: "overunder",
    metric: "citations",
    question: ({ line }) => `Will the city write more than ${line.toLocaleString()} parking tickets today?`,
  },
  {
    id: "dead_animals",
    kind: "overunder",
    metric: "dead_animals",
    question: ({ line }) => `Will more than ${line.toLocaleString()} dead animals be reported to the city today?`,
  },
  {
    id: "make_faceoff",
    kind: "faceoff",
    metricA: "make:TOYT",
    metricB: "make:HOND",
    question: () => `Will more Toyotas than Hondas be ticketed today?`,
  },
];

const YES_NO = ["YES", "NO"];

// ─── Runtime tables ──────────────────────────────────────────────────────────────

export async function ensureExchangeRuntime(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS game_clock (id text PRIMARY KEY, current_day text NOT NULL)`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS exchange_round (
       market_id text PRIMARY KEY,
       market_type text NOT NULL,
       target_date text NOT NULL,
       outcome_index integer NOT NULL,
       line integer,
       actual_a integer,
       actual_b integer,
       settled boolean NOT NULL DEFAULT false
     )`
  );
}

// ─── Clock ───────────────────────────────────────────────────────────────────────

async function calendar(): Promise<string[]> {
  return (await getMetricSeries(CALENDAR_METRIC)).map((p) => p.date);
}

async function setCurrentDay(day: string): Promise<void> {
  await pool.query(
    `INSERT INTO game_clock (id, current_day) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET current_day = $2`,
    [CLOCK_ID, day]
  );
}

/** The in-game "today" (a real historical day), initialised on first use. */
async function currentDay(cal?: string[]): Promise<string | null> {
  const days = cal ?? (await calendar());
  if (days.length <= WINDOW) return null; // not enough history yet
  const firstEligible = days[WINDOW];

  const { rows } = await pool.query(`SELECT current_day FROM game_clock WHERE id = $1`, [CLOCK_ID]);
  let day: string | null = rows[0]?.current_day ?? null;
  if (!day || !days.includes(day)) {
    day = firstEligible;
    await setCurrentDay(day);
  }
  return day;
}

// ─── Market construction ──────────────────────────────────────────────────────────

interface BuiltMarket {
  id: string;
  type: string;
  question: string;
  baseRateYes: number;
  outcomeIndex: number;
  line: number;
  actualA: number;
  actualB: number;
}

async function buildMarketFor(type: MarketType, day: string): Promise<BuiltMarket | null> {
  const id = `${type.id}-${day}`;
  if (type.kind === "overunder") {
    const series = await getMetricSeries(type.metric!);
    const m = buildOverUnderMarket(series as MetricPoint[], day, WINDOW);
    if (!m) return null;
    return {
      id,
      type: type.id,
      question: type.question({ line: m.line }),
      baseRateYes: m.baseRateYes,
      outcomeIndex: m.outcomeIndex,
      line: m.line,
      actualA: m.actualValue,
      actualB: 0,
    };
  }
  const a = await getMetricSeries(type.metricA!);
  const b = await getMetricSeries(type.metricB!);
  const m = buildFaceoffMarket(a as MetricPoint[], b as MetricPoint[], day, WINDOW);
  if (!m) return null;
  return {
    id,
    type: type.id,
    question: type.question({ line: 0 }),
    baseRateYes: m.baseRateYes,
    outcomeIndex: m.outcomeIndex,
    line: 0,
    actualA: m.actualA,
    actualB: m.actualB,
  };
}

/** Ensure today's markets exist in state (idempotent); persist any new ones. */
async function ensureTodaysMarkets(day: string): Promise<void> {
  let { state, config } = await getOrInitGame();
  let dirty = false;

  for (const type of MARKET_TYPES) {
    const id = `${type.id}-${day}`;
    if (state.markets?.[id]) continue; // already on the board

    const built = await buildMarketFor(type, day);
    if (!built) continue; // no data for this type yet

    state = openMarket(state, config, {
      id,
      question: built.question,
      outcomes: YES_NO,
      baseRates: [built.baseRateYes, 1 - built.baseRateYes],
    });
    dirty = true;

    await pool.query(
      `INSERT INTO exchange_round (market_id, market_type, target_date, outcome_index, line, actual_a, actual_b)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (market_id) DO NOTHING`,
      [id, built.type, day, built.outcomeIndex, built.line, built.actualA, built.actualB]
    );
  }

  if (dirty) await saveState(state);
}

// ─── Public API ────────────────────────────────────────────────────────────────────

export interface BoardView {
  day: string | null;
  markets: MarketView[];
  empty?: string; // reason, when there's nothing to show
}

export async function getBoard(): Promise<BoardView> {
  const day = await currentDay();
  if (!day) return { day: null, markets: [], empty: "Not enough citation history yet — run the pipeline." };

  await ensureTodaysMarkets(day);
  const { state } = await getOrInitGame();
  const markets = Object.values(state.markets ?? {})
    .filter((m) => m.status === "open" && m.id.endsWith(`-${day}`))
    .map(marketView);
  return { day, markets };
}

export interface ExchangePosition {
  marketId: string;
  question: string;
  outcomes: string[];
  prices: number[];
  shares: number[];
  spent: number;
  value: number;
}

export async function getPositions(userId: number): Promise<ExchangePosition[]> {
  const { state } = await getOrInitGame();
  const id = pid(userId);
  const out: ExchangePosition[] = [];
  for (const m of Object.values(state.markets ?? {})) {
    if (m.status !== "open") continue;
    const shares = m.holdings[id];
    if (!shares) continue;
    const prices = marketPrices(m);
    out.push({
      marketId: m.id,
      question: m.question,
      outcomes: m.outcomes,
      prices,
      shares,
      spent: m.spent[id] ?? 0,
      value: shares.reduce((a, s, i) => a + s * prices[i], 0),
    });
  }
  return out;
}

export interface BuyResult {
  market: MarketView;
  crude: number;
  shares: number;
  holdings: number[];
}

export async function buy(
  userId: number,
  marketId: string,
  outcome: number,
  budget: number
): Promise<BuyResult> {
  if (!(budget > 0)) throw new Error("Stake must be positive.");
  let { state, config } = await getOrInitGame();
  state = await ensurePlayer(state, config, userId);
  const market = state.markets?.[marketId];
  if (!market || market.status !== "open") throw new Error("That market isn't open.");

  const shares = sharesForBudget(market, outcome, budget);
  state = buyContracts(state, config, pid(userId), marketId, outcome, shares);
  await saveState(state);

  const m = state.markets[marketId];
  return {
    market: marketView(m),
    crude: state.players[pid(userId)].crude,
    shares,
    holdings: m.holdings[pid(userId)] ?? new Array(m.outcomes.length).fill(0),
  };
}

export interface DayResult {
  marketId: string;
  type: string;
  question: string;
  outcome: string; // winning label
  line: number;
  actualA: number;
  actualB: number;
  settlement: Settlement | null;
}

export interface EndDayResult {
  day: string;
  results: DayResult[];
  nextDay: string | null;
}

/** Settle every market for the current day and advance the clock. */
export async function endDay(): Promise<EndDayResult> {
  const cal = await calendar();
  const day = await currentDay(cal);
  if (!day) throw new Error("No active day to settle.");

  const { rows } = await pool.query(
    `SELECT * FROM exchange_round WHERE target_date = $1 AND settled = false`,
    [day]
  );

  let { state, config } = await getOrInitGame();
  const results: DayResult[] = [];

  for (const r of rows as any[]) {
    const market = state.markets?.[r.market_id];
    if (!market || market.status !== "open") continue;
    state = resolveMarket(state, config, r.market_id, r.outcome_index);
    await pool.query(`UPDATE exchange_round SET settled = true WHERE market_id = $1`, [r.market_id]);
    results.push({
      marketId: r.market_id,
      type: r.market_type,
      question: market.question,
      outcome: market.outcomes[r.outcome_index],
      line: r.line ?? 0,
      actualA: r.actual_a ?? 0,
      actualB: r.actual_b ?? 0,
      settlement: state.lastSettlement,
    });
  }
  await saveState(state);

  // Advance the clock to the next available day (clamped at the latest).
  const idx = cal.indexOf(day);
  const nextDay = idx >= 0 && idx + 1 < cal.length ? cal[idx + 1] : null;
  if (nextDay) await setCurrentDay(nextDay);

  return { day, results, nextDay };
}
