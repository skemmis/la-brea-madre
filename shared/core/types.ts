import type { RngState } from "./rng";

export type PlayerId = string;

// ─── Injected inputs (NOT mutated by the core) ─────────────────────────────────

/** One cell of the static board: whether it exists + its ambient resources. */
export interface BoardHex {
  wells: number;
}

export interface GameConfig {
  /** Static board: which hexes exist and their ambient data. Injected input. */
  board: Record<string, BoardHex>;
  /** Players present at game start. */
  players: PlayerId[];
  resolution: number; // H3 resolution, for adjacency
  startingCrude: number;
  maxUpgrade: number;
  seasonLength?: number; // ticks until game over; undefined = endless
  costs: {
    claim: number;
    firstClaimFree: boolean;
    upgrade: number[]; // cost to go from level i -> i+1
    relic: number;
  };
  yield: {
    perWell: number;
    upgradeBonus: number[]; // additive yield bonus by upgrade level
    exploitMultiplier: number;
    exploitDegradePerTick: number;
    volatility: number; // ± random daily swing (the "dice")
    citationInfluence: number; // extra upside per citation/day on a hex
    citationInfluenceCap: number;
  };
  market: {
    liquidity: number; // LMSR `b` — depth + bound on the maker's max loss
    payoutPerShare: number; // crude paid per winning share at resolution
  };
}

/**
 * A real-world event for one tick, injected by an adapter (live API,
 * historical replay, or synthetic generator). The core never fetches these.
 */
export interface GameEvent {
  h3: string;
  kind: string; // "citation" | "deadAnimal" | ...
  magnitude: number; // e.g. per-day rate
}

// ─── Mutable game state (plain, serializable) ──────────────────────────────────

export interface HexState {
  ownerId: PlayerId | null;
  upgradeLevel: number;
  exploited: boolean;
  degradation: number; // 0..100
}

export interface PlayerState {
  id: PlayerId;
  crude: number;
  relics: string[];
  actionUsedTick: number; // tick index of last daily action (-1 = none)
}

export interface DispatchEntry {
  h3: string;
  baseYield: number;
  finalYield: number;
  notes: string[];
}

export interface TickReport {
  tick: number;
  perPlayer: Record<PlayerId, { gained: number; entries: DispatchEntry[] }>;
}

// ─── Prediction markets (the first surface) ────────────────────────────────────

/**
 * An LMSR (Logarithmic Market Scoring Rule) prediction market. The maker holds
 * `q` outstanding shares per outcome; price is a deterministic function of `q`,
 * so the whole thing is pure and replayable. Buying shifts `q` (and the price);
 * at resolution, each share of the winning outcome pays `payoutPerShare`.
 */
export interface Market {
  id: string;
  question: string;
  outcomes: string[];
  b: number; // liquidity parameter (depth + bounds the maker's max loss)
  q: number[]; // shares outstanding per outcome
  status: "open" | "resolved";
  resolvedOutcome: number | null;
  holdings: Record<PlayerId, number[]>; // shares held per outcome, per player
  spent: Record<PlayerId, number>; // crude cost basis per player
}

/** What a shell injects to open a market: the question + its base-rate odds. */
export interface MarketSpec {
  id: string;
  question: string;
  outcomes: string[];
  baseRates: number[]; // opening probabilities (from historical data)
}

export interface SettlementEntry {
  shares: number; // shares held of the winning outcome
  spent: number; // total crude spent across all outcomes in this market
  payout: number; // crude paid out
  profit: number; // payout - spent
}

/** The "card flip": a resolved market's payouts — the prediction-game dispatch. */
export interface Settlement {
  marketId: string;
  question: string;
  outcome: string; // the winning outcome's label
  perPlayer: Record<PlayerId, SettlementEntry>;
}

export interface GameState {
  seed: number;
  rng: RngState;
  tick: number;
  players: Record<PlayerId, PlayerState>;
  /** Sparse: only hexes that differ from the default (unowned/pristine). */
  hexes: Record<string, HexState>;
  /** The most recent tick's dispatch — the "what happened overnight" reveal. */
  lastReport: TickReport | null;
  /** Open + resolved prediction markets, keyed by id. */
  markets: Record<string, Market>;
  /** The most recently resolved market — the prediction-game reveal. */
  lastSettlement: Settlement | null;
}

// ─── Actions ───────────────────────────────────────────────────────────────────

export type Action =
  | { type: "expand"; h3: string } // claim an adjacent unowned hex
  | { type: "upgrade"; h3: string } // deepen an owned hex
  | { type: "acquireRelic"; relicId: string } // power up self (universal effect)
  | { type: "setExploit"; h3: string; on: boolean } // free stance, not the daily action
  | { type: "pass" };
