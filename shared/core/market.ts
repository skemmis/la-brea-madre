/**
 * Prediction markets — a pure, deterministic LMSR market maker.
 *
 * The first surface of the game: ask a question about real LA data, let players
 * buy YES/NO (or N-way) contracts at a price that *is* the implied probability,
 * then settle each share at 1 crude (win) or 0 (lose). Prices move as an
 * automated market maker (Hanson's LMSR): the more of an outcome you buy, the
 * pricier it gets, so conviction is self-limiting and the maker's worst-case
 * loss is bounded by b·ln(n).
 *
 * No RNG, no clock, no IO — price and cost are exact functions of the shares
 * outstanding. The shell injects the question + base-rate odds (from history)
 * and, later, the resolving outcome (from the revealed real data).
 */
import { cardEffects } from "./cards";
import type {
  GameConfig,
  GameState,
  Market,
  MarketSpec,
  PlayerId,
  Settlement,
} from "./types";

const EPS = 1e-9;

function clone<T>(v: T): T {
  return structuredClone(v);
}

// ─── LMSR math (numerically stable) ─────────────────────────────────────────────

/** log(Σ exp(x_i)), shifted by the max to avoid overflow. */
function logSumExp(xs: number[]): number {
  const m = Math.max(...xs);
  let s = 0;
  for (const x of xs) s += Math.exp(x - m);
  return m + Math.log(s);
}

/** Cost function C(q) = b · log(Σ exp(q_i / b)). */
function cost(q: number[], b: number): number {
  return b * logSumExp(q.map((x) => x / b));
}

/** Outcome prices p_i = softmax(q / b) — each in (0,1), summing to 1. */
export function marketPrices(market: Market): number[] {
  const z = market.q.map((x) => x / market.b);
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m));
  const sum = e.reduce((a, c) => a + c, 0);
  return e.map((x) => x / sum);
}

/** Crude cost to buy `shares` (>0) of `outcome` at the current price curve. */
export function quoteCost(market: Market, outcome: number, shares: number): number {
  const q2 = market.q.slice();
  q2[outcome] += shares;
  return cost(q2, market.b) - cost(market.q, market.b);
}

/**
 * How many shares of `outcome` a given crude `budget` buys (closed form).
 * Lets the UI offer "spend N crude" while the engine speaks in shares.
 */
export function sharesForBudget(market: Market, outcome: number, budget: number): number {
  const z = market.q.map((x) => x / market.b);
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m)); // e^m cancels below
  const sumE = e.reduce((a, c) => a + c, 0);
  const ek = e[outcome];
  const rest = sumE - ek;
  const num = sumE * Math.exp(budget / market.b) - rest;
  return market.b * Math.log(num / ek);
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────────

/** Seed shares so the opening prices equal the given base rates. */
function seedShares(baseRates: number[], b: number): number[] {
  const total = baseRates.reduce((a, c) => a + c, 0) || 1;
  return baseRates.map((r) => b * Math.log(Math.max(EPS, r / total)));
}

/** Open a market priced to its historical base rate. */
export function openMarket(state: GameState, config: GameConfig, spec: MarketSpec): GameState {
  if (spec.outcomes.length !== spec.baseRates.length || spec.outcomes.length < 2) {
    throw new Error(`Market ${spec.id} needs matching outcomes/baseRates (>=2).`);
  }
  const next = clone(state);
  next.markets ??= {};
  if (next.markets[spec.id]) throw new Error(`Market ${spec.id} already exists.`);

  const b = config.market.liquidity;
  next.markets[spec.id] = {
    id: spec.id,
    question: spec.question,
    outcomes: spec.outcomes.slice(),
    b,
    q: seedShares(spec.baseRates, b),
    status: "open",
    resolvedOutcome: null,
    holdings: {},
    spent: {},
  };
  return next;
}

/** Buy `shares` (>0) of an outcome, paying the LMSR cost in crude. */
export function buyContracts(
  state: GameState,
  _config: GameConfig,
  playerId: PlayerId,
  marketId: string,
  outcome: number,
  shares: number
): GameState {
  const market = state.markets?.[marketId];
  if (!market) throw new Error(`No such market: ${marketId}`);
  if (market.status !== "open") throw new Error(`Market ${marketId} is closed.`);
  if (outcome < 0 || outcome >= market.outcomes.length) throw new Error(`Bad outcome ${outcome}.`);
  if (!(shares > 0)) throw new Error(`Share count must be positive.`);
  const player = state.players[playerId];
  if (!player) throw new Error(`No such player: ${playerId}`);

  const price = quoteCost(market, outcome, shares);
  if (player.crude < price) {
    throw new Error(`Not enough crude (need ${price.toFixed(2)}, have ${player.crude}).`);
  }

  const next = clone(state);
  const m = next.markets[marketId];
  const p = next.players[playerId];
  p.crude -= price;
  m.q[outcome] += shares;
  m.holdings[playerId] ??= new Array(m.outcomes.length).fill(0);
  m.holdings[playerId][outcome] += shares;
  m.spent[playerId] = (m.spent[playerId] ?? 0) + price;
  return next;
}

/** Resolve a market: pay each share of the winning outcome `payoutPerShare`. */
export function resolveMarket(
  state: GameState,
  config: GameConfig,
  marketId: string,
  winningOutcome: number
): GameState {
  const market = state.markets?.[marketId];
  if (!market) throw new Error(`No such market: ${marketId}`);
  if (market.status !== "open") throw new Error(`Market ${marketId} already resolved.`);
  if (winningOutcome < 0 || winningOutcome >= market.outcomes.length) {
    throw new Error(`Bad winning outcome ${winningOutcome}.`);
  }

  const next = clone(state);
  const m = next.markets[marketId];
  const payoutPerShare = config.market.payoutPerShare;
  const settlement: Settlement = {
    marketId,
    question: m.question,
    outcome: m.outcomes[winningOutcome],
    perPlayer: {},
  };

  for (const [pid, held] of Object.entries(m.holdings)) {
    const shares = held[winningOutcome] ?? 0;
    const spent = m.spent[pid] ?? 0;

    // Deck-building cards modify the payout: a multiplier on winnings, plus a
    // refund on a net loss (the player's owned cards, applied passively).
    const fx = cardEffects(next.players[pid]?.cards ?? []);
    let payout = shares * payoutPerShare * fx.payoutMult;
    if (payout < spent && fx.loserRefund > 0) {
      payout += (spent - payout) * fx.loserRefund;
    }

    if (next.players[pid]) next.players[pid].crude += payout;
    settlement.perPlayer[pid] = { shares, spent, payout, profit: payout - spent };
  }

  m.status = "resolved";
  m.resolvedOutcome = winningOutcome;
  next.lastSettlement = settlement;
  return next;
}

// ─── Read helpers (for projecting to the UI) ────────────────────────────────────

export interface MarketView {
  id: string;
  question: string;
  outcomes: string[];
  prices: number[];
  status: Market["status"];
  resolvedOutcome: number | null;
}

export function marketView(market: Market): MarketView {
  return {
    id: market.id,
    question: market.question,
    outcomes: market.outcomes,
    prices: marketPrices(market),
    status: market.status,
    resolvedOutcome: market.resolvedOutcome,
  };
}

export function openMarkets(state: GameState): MarketView[] {
  return Object.values(state.markets ?? {})
    .filter((m) => m.status === "open")
    .map(marketView);
}
