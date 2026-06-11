import type { RngState } from "./rng";

export type PlayerId = string;

// ─── Injected inputs (NOT mutated by the core) ─────────────────────────────────

/** One cell of the static board: whether it exists + its ambient resources. */
export interface BoardHex {
  wells: number;
  /** Expected ticket $/day — the land's value, set by the shell from records. */
  fineRate?: number;
  /** Expected dead-animal reports/day — carrion terrain, from city records. */
  carrionRate?: number;
}

export interface GameConfig {
  /** Static board: which hexes exist and their ambient data. Injected input. */
  board: Record<string, BoardHex>;
  /** Players present at game start. */
  players: PlayerId[];
  resolution: number; // H3 resolution, for adjacency
  startingCrude: number; // starting bankroll, in dollars
  maxUpgrade: number;
  seasonLength?: number; // ticks until game over; undefined = endless
  costs: {
    claim: number; // floor price for worthless land
    /** Land is priced at its value: cost = max(claim, fineRate × this). */
    claimValueMult: number;
    firstClaimFree: boolean;
    upgrade: number[]; // cost to go from level i -> i+1
  };
  yield: {
    /** $ paid per $ of parking fines written in an owned hex each day. */
    finePayout: number;
    perWell: number; // small flat $ bonus per oil well (legacy flavor)
    upgradeBonus: number[]; // additive yield bonus by upgrade level
  };
  workOrders: {
    /** Orders granted per dead-animal report/day in owned territory. */
    perCarrion: number;
    /** Free order granted at the weekly tick (Mondays). */
    weeklyFree: number;
    /** Bank cap — carrion piles up only so far. */
    cap: number;
    starting: number;
  };
  assessment: {
    /** Daily property tax as a fraction of each parcel's assessed price. */
    taxRate: number;
    /** Assessments can't go below this floor. */
    minPrice: number;
  };
  quake: {
    /** Emergency shoring cost per degradation point: fraction of fair value. */
    repairFraction: number;
    /** ...but never below this floor per point. */
    repairFloorPerPoint: number;
    /** Degradation multiplies by this daily — damage heals on its own. */
    healFactor: number;
    /** At or above this degradation a parcel is CRACKED: ties no longer
     * defend it, bulwarks don't fire, and the county marks its valuation
     * down by the damage for raid pricing. */
    crackedThreshold: number;
  };
  works: {
    /** Retrofit: one-time cost as a fraction of fair value. */
    retrofitCostFraction: number;
    /** Quake damage multiplier on retrofitted parcels. */
    retrofitDamageMult: number;
    /** Dispatch a crew: flat cost, pay multiplier, and how long it stays. */
    crewCost: number;
    crewMult: number;
    crewDays: number;
  };
  market: {
    liquidity: number; // LMSR `b` — depth + bound on the maker's max loss
    payoutPerShare: number; // crude paid per winning share at resolution
  };
  raids: {
    /** When true, raids replace buyouts as the way land changes hands. */
    enabled: boolean;
    /** A winning raider pays the loser this fraction of their own asking price. */
    compFraction: number;
    /** A losing raider forfeits this fraction of the asking price to the defender. */
    stakeFraction: number;
    /** Cards drawn per side per battle. */
    battleSize: number;
    /** Binder cap — the whole standing army, defense and offense alike. */
    collectionCap: number;
    /** Cards a brand-new player starts with. */
    starterCards: number;
    /**
     * What befalls a beaten card. You declared the war: attackers' fallen
     * BURN (rares and mythics leave a fossil). Defenders' fallen are WOUNDED
     * — they rest restDays and return. Sunk lanes and reckless cards burn
     * regardless of side; poached cards change owners instead.
     */
    attackerFate: "burn" | "rest" | "none";
    defenderFate: "burn" | "rest" | "none";
    /** How long a wounded card rests. */
    restDays: number;
    /** Dashboard Saints a player can hang from the mirror. */
    saintSlots: number;
    /** A hex is BLUE terrain at or above this ticket $/day. */
    machineTerrainFine: number;
    /** A hex is WHITE terrain at or above this dead-animal rate/day. */
    carrionTerrainRate: number;
  };
  packs: {
    /** Scrip per pack — scrip is minted only by winning market settlements. */
    cost: number;
    /** Cards per pack. */
    size: number;
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
  /** Owner's self-assessed price: anyone may buy at it; tax accrues on it. */
  price?: number;
  /** Seismic retrofit: this parcel takes half quake damage, permanently. */
  retrofitted?: boolean;
  /** A dispatched work crew boosts pay until this tick index. */
  crewUntilTick?: number;
  /** @deprecated the exploit stance is gone; kept so old saves parse. */
  exploited?: boolean;
  degradation: number; // 0..100
}

export interface PlayerState {
  id: PlayerId;
  /** Bankroll in dollars. (Field name is a fossil from the oil era.) */
  crude: number;
  /** @deprecated relics/cards are gone; kept so old saves parse. */
  relics?: string[];
  /** @deprecated */
  cards?: string[];
  /** Work Orders: the action currency, earned from carrion in your territory. */
  workOrders: number;
  /** @deprecated pre-WorkOrder daily-action marker; kept for old saves. */
  actionUsedTick: number;
  /** The binder: every card owned, fighting and resting alike (raids layer). */
  binder?: BinderCard[];
  /** Oracle scrip — pack money, minted only by winning market settlements. */
  scrip?: number;
  /**
   * The fossil gallery: rares and mythics that burned. The tar preserves
   * what it kills — out of play forever, on display forever (or until the
   * forge takes payment in bone).
   */
  fossils?: Fossil[];
  /** Dashboard Saints forged from fossils — at most raids.saintSlots, forever. */
  saints?: string[];
}

export interface Fossil {
  def: string;
  /** The tick the card died — every fossil is dated. */
  tick: number;
}

/** One owned copy of a card. `def` is a catalog id (cards.ts). */
export interface BinderCard {
  def: string;
  /** Resting after a beating until this tick (beatenRestDays regimes). */
  restUntil?: number;
}

/** A raid declared today, resolving at tonight's tick. Escrow already paid. */
export interface PendingRaid {
  h3: string;
  attackerId: PlayerId;
  /** compFraction × asking price, held until the battle resolves. */
  escrow: number;
  /** stakeFraction × asking price — forfeited to the defender on a loss. */
  stake: number;
}

export interface DispatchEntry {
  h3: string;
  baseYield: number;
  finalYield: number;
  notes: string[];
}

export interface TickReport {
  tick: number;
  perPlayer: Record<
    PlayerId,
    { gained: number; ordersEarned: number; taxPaid: number; entries: DispatchEntry[] }
  >;
  /** Parcels the county took for back taxes this tick. */
  foreclosures: { h3: string; ownerId: PlayerId }[];
  /** Tonight's raids, resolved in declaration order. */
  raids?: RaidReport[];
}

/** One resolved raid — the morning bulletin's raw material. */
export interface RaidReport {
  h3: string;
  attackerId: PlayerId;
  defenderId: PlayerId;
  attackerWon: boolean;
  attackerLanes: number;
  defenderLanes: number;
  /** Cards each side actually fielded (a drained binder fights on scraps). */
  attackerCards: number;
  defenderCards: number;
  /** $ that changed hands: comp to the loser of the land, or stake to the defender. */
  paid: number;
  /** The parcel was CRACKED tonight — the walls were down. */
  cracked: boolean;
  /** Card ids destroyed (per side), wounded, stolen, and healed tonight. */
  burned: { attacker: string[]; defender: string[] };
  wounded: { attacker: string[]; defender: string[] };
  /** Cards that changed binders: [cardId, newOwnerId]. */
  poached: [string, PlayerId][];
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
  /** @deprecated sealed-bid wars are gone; kept so old saves parse. */
  contests?: Record<string, unknown>;
  /** Bumped when balances are rescaled (v2 = dollars). */
  economyVersion?: number;
  /** Raids declared today, awaiting tonight's resolution. */
  pendingRaids?: PendingRaid[];
  /** The most recent tick's dispatch — the "what happened overnight" reveal. */
  lastReport: TickReport | null;
  /** Open + resolved prediction markets, keyed by id. */
  markets: Record<string, Market>;
  /** The most recently resolved market — the prediction-game reveal. */
  lastSettlement: Settlement | null;
}

// ─── Actions ───────────────────────────────────────────────────────────────────

export type Action =
  | { type: "expand"; h3: string } // claim an adjacent unowned hex (1 order + $)
  | { type: "upgrade"; h3: string } // deepen an owned hex (1 order + $)
  | { type: "repair"; h3: string } // clear quake degradation (1 order + $ ∝ value)
  | { type: "retrofit"; h3: string } // halve future quake damage (1 order + $ ∝ value)
  | { type: "crew"; h3: string } // dispatch a work crew: +pay for a week (1 order + $)
  | { type: "assess"; h3: string; price: number } // set your parcel's price (free)
  | { type: "buyout"; h3: string } // buy any parcel at its assessed price (1 order)
  | { type: "raid"; h3: string } // challenge a deed by deck-fight tonight (1 order + escrow)
  | { type: "pass" };
