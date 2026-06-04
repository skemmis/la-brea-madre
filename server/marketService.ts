/**
 * Market service — the shell that runs prediction rounds on top of the pure
 * core. It picks a (hidden) historical day, prices the opening market from the
 * trailing base rate, takes trades, and settles against the revealed truth.
 *
 * The hidden answer (target day, line, actual fines, winning outcome) lives in
 * the `market_round` table and is never sent to the client until reveal.
 */
import { pool } from "./db";
import {
  getOrInitGame,
  saveState,
  ensurePlayer,
  pid,
} from "./gameService";
import { getCitationMarketDays } from "./storage";
import {
  openMarket,
  buyContracts,
  resolveMarket,
  sharesForBudget,
  marketView,
  openMarkets,
  marketPrices,
  type MarketView,
  type Settlement,
} from "@shared/core";
import {
  buildOverUnderRound,
  eligibleTargets,
  OVER_UNDER_OUTCOMES,
} from "./marketRound";

export async function ensureMarketRoundTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS market_round (
       market_id text PRIMARY KEY,
       target_date date NOT NULL,
       line integer NOT NULL,
       actual_total_fine integer NOT NULL,
       outcome_index integer NOT NULL,
       revealed boolean NOT NULL DEFAULT false,
       created_at timestamptz NOT NULL DEFAULT now()
     )`
  );
}

interface RoundRow {
  market_id: string;
  target_date: string;
  line: number;
  actual_total_fine: number;
  outcome_index: number;
  revealed: boolean;
}

async function getRound(marketId: string): Promise<RoundRow | null> {
  const { rows } = await pool.query(`SELECT * FROM market_round WHERE market_id = $1`, [marketId]);
  return (rows[0] as RoundRow) ?? null;
}

async function usedTargetDates(): Promise<Set<string>> {
  const { rows } = await pool.query(`SELECT target_date FROM market_round`);
  return new Set(rows.map((r: any) => String(r.target_date).slice(0, 10)));
}

// ─── Round lifecycle ────────────────────────────────────────────────────────────

/** Deal a new over/under market on a fresh (hidden) historical day. */
export async function openRound(): Promise<MarketView> {
  const series = await getCitationMarketDays();
  const targets = eligibleTargets(series);
  if (targets.length === 0) {
    throw new Error("Not enough citation history yet — run the history pipeline first.");
  }

  const used = await usedTargetDates();
  const fresh = targets.filter((d) => !used.has(d));
  const candidates = fresh.length ? fresh : targets; // recycle once exhausted
  const targetDate = candidates[Math.floor(Math.random() * candidates.length)];

  const round = buildOverUnderRound(series, targetDate);
  if (!round) throw new Error(`Could not build a round for ${targetDate}.`);

  const id = `fines-${targetDate}-${Math.random().toString(36).slice(2, 7)}`;
  const question = `Citywide parking fines that day — over or under $${round.line.toLocaleString()}?`;

  let { state, config } = await getOrInitGame();
  state = openMarket(state, config, {
    id,
    question,
    outcomes: round.outcomes,
    baseRates: [round.baseRateOver, 1 - round.baseRateOver],
  });
  await saveState(state);

  await pool.query(
    `INSERT INTO market_round (market_id, target_date, line, actual_total_fine, outcome_index)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, targetDate, round.line, round.actualFine, round.outcomeIndex]
  );

  return marketView(state.markets[id]);
}

/** Open markets, as the client sees them (no hidden answer). */
export async function listMarkets(): Promise<MarketView[]> {
  const { state } = await getOrInitGame();
  return openMarkets(state);
}

export interface BuyResult {
  market: MarketView;
  crude: number;
  shares: number;
  holdings: number[];
}

/** Spend `budget` crude on `outcome` of a market (price moves as you buy). */
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

export interface RevealResult {
  marketId: string;
  question: string;
  targetDate: string;
  line: number;
  actualFine: number;
  outcome: string; // winning outcome label
  settlement: Settlement | null;
}

/** Reveal the hidden day and settle every contract. */
export async function reveal(marketId: string): Promise<RevealResult> {
  const round = await getRound(marketId);
  if (!round) throw new Error("No such market.");
  if (round.revealed) throw new Error("This market is already revealed.");

  let { state, config } = await getOrInitGame();
  const market = state.markets?.[marketId];
  if (!market) throw new Error("No such market.");
  if (market.status !== "open") throw new Error("This market is already resolved.");

  state = resolveMarket(state, config, marketId, round.outcome_index);
  await saveState(state);
  await pool.query(`UPDATE market_round SET revealed = true WHERE market_id = $1`, [marketId]);

  return {
    marketId,
    question: market.question,
    targetDate: String(round.target_date).slice(0, 10),
    line: round.line,
    actualFine: round.actual_total_fine,
    outcome: OVER_UNDER_OUTCOMES[round.outcome_index],
    settlement: state.lastSettlement,
  };
}

// ─── Player view ────────────────────────────────────────────────────────────────

export interface Position {
  marketId: string;
  question: string;
  outcomes: string[];
  prices: number[];
  shares: number[];
  spent: number;
  value: number; // mark-to-market value of the position
}

/** A player's holdings across open markets. */
export async function getPositions(userId: number): Promise<Position[]> {
  const { state } = await getOrInitGame();
  const id = pid(userId);
  const out: Position[] = [];
  for (const m of Object.values(state.markets ?? {})) {
    if (m.status !== "open") continue;
    const shares = m.holdings[id];
    if (!shares) continue;
    const prices = marketPrices(m);
    const value = shares.reduce((a, s, i) => a + s * prices[i], 0);
    out.push({
      marketId: m.id,
      question: m.question,
      outcomes: m.outcomes,
      prices,
      shares,
      spent: m.spent[id] ?? 0,
      value,
    });
  }
  return out;
}
