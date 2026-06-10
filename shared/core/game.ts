/**
 * La Brea Madre — pure, headless, deterministic game core.
 *
 * No imports of the UI, web framework, DB, network, or system clock. All
 * randomness flows through the seeded RNG in the state; time advances only
 * via tick(); real-world data (board + events) is injected. Every function
 * returns a new state and never mutates its inputs.
 *
 * (h3-js is used purely for hex adjacency — deterministic geometry, no IO.)
 */
import { gridDisk } from "h3-js";
import { makeRng } from "./rng";
import type {
  Action,
  DispatchEntry,
  GameConfig,
  GameEvent,
  GameState,
  HexState,
  PlayerId,
  TickReport,
} from "./types";

const DEFAULT_HEX: HexState = {
  ownerId: null,
  upgradeLevel: 0,
  degradation: 0,
};

function hexState(state: GameState, h3: string): HexState {
  return state.hexes[h3] ?? { ...DEFAULT_HEX };
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function ownedHexes(state: GameState, playerId: PlayerId): string[] {
  return Object.keys(state.hexes).filter((h) => state.hexes[h].ownerId === playerId);
}

/** What a parcel costs to claim: priced at ~a month of its ticket money. */
export function claimPrice(config: GameConfig, h3: string): number {
  return Math.max(
    config.costs.claim,
    Math.round((config.board[h3]?.fineRate ?? 0) * config.costs.claimValueMult)
  );
}

function claimCost(config: GameConfig, ownedCount: number, h3: string): number {
  if (ownedCount === 0 && config.costs.firstClaimFree) return 0;
  return claimPrice(config, h3);
}

/** A parcel's current asking price (owner-set, defaulting to market value). */
export function assessedPrice(state: GameState, config: GameConfig, h3: string): number {
  return state.hexes[h3]?.price ?? claimPrice(config, h3);
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function newGame(config: GameConfig, seed: number): GameState {
  const players: GameState["players"] = {};
  for (const id of config.players) {
    players[id] = {
      id,
      crude: config.startingCrude,
      workOrders: config.workOrders.starting,
      actionUsedTick: -1,
    };
  }
  return {
    seed,
    rng: makeRng(seed),
    tick: 0,
    players,
    hexes: {},
    lastReport: null,
    markets: {},
    lastSettlement: null,
  };
}

/** Add a player to an existing game (a mid-season join). No-op if present. */
export function addPlayer(state: GameState, config: GameConfig, playerId: PlayerId): GameState {
  if (state.players[playerId]) return state;
  const next = clone(state);
  next.players[playerId] = {
    id: playerId,
    crude: config.startingCrude,
    workOrders: config.workOrders.starting,
    actionUsedTick: -1,
  };
  return next;
}

// ─── Legal actions ────────────────────────────────────────────────────────────

export function legalActions(state: GameState, config: GameConfig, playerId: PlayerId): Action[] {
  const player = state.players[playerId];
  if (!player) return [];

  const actions: Action[] = [{ type: "pass" }];
  const mine = ownedHexes(state, playerId);

  // Re-pricing your own land is free — the tax is the cost of bravado.
  for (const h of mine) {
    actions.push({ type: "assess", h3: h, price: assessedPrice(state, config, h) });
  }

  // Everything below spends a Work Order.
  if ((player.workOrders ?? 0) < 1) return actions;

  // Expand: adjacent unowned board hexes (or any board hex for the first
  // claim). Land is priced at its value — affordability is per parcel.
  if (mine.length === 0) {
    if (config.costs.firstClaimFree || player.crude >= config.costs.claim) {
      for (const h of Object.keys(config.board)) actions.push({ type: "expand", h3: h });
    }
  } else {
    const frontier = new Set<string>();
    for (const h of mine) {
      for (const n of gridDisk(h, 1)) {
        if (n !== h && config.board[n] && hexState(state, n).ownerId === null) frontier.add(n);
      }
    }
    for (const h of frontier) {
      if (player.crude >= claimPrice(config, h)) actions.push({ type: "expand", h3: h });
    }
  }

  // Upgrade: an owned hex below max level you can afford.
  for (const h of mine) {
    const hx = hexState(state, h);
    if (hx.upgradeLevel < config.maxUpgrade && player.crude >= config.costs.upgrade[hx.upgradeLevel]) {
      actions.push({ type: "upgrade", h3: h });
    }
  }

  // Repair: clear a shaken parcel's degradation (1 order + $ per point).
  for (const h of mine) {
    const hx = hexState(state, h);
    if (hx.degradation > 0 && player.crude >= hx.degradation * config.quake.repairPerPoint) {
      actions.push({ type: "repair", h3: h });
    }
  }

  // Buyout: any other player's parcel, at the owner's own asking price.
  for (const [h3, hx] of Object.entries(state.hexes)) {
    if (hx.ownerId && hx.ownerId !== playerId && player.crude >= assessedPrice(state, config, h3)) {
      actions.push({ type: "buyout", h3 });
    }
  }

  return actions;
}

function actionsEqual(a: Action, b: Action): boolean {
  // Prices are free-form — legality is about the parcel, not the number.
  if (a.type === "assess" && b.type === "assess") return a.h3 === b.h3;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Apply a single action ──────────────────────────────────────────────────

export function applyAction(
  state: GameState,
  config: GameConfig,
  playerId: PlayerId,
  action: Action
): GameState {
  const legal = legalActions(state, config, playerId);
  if (!legal.some((a) => actionsEqual(a, action))) {
    throw new Error(`Illegal action for ${playerId}: ${JSON.stringify(action)}`);
  }

  const next = clone(state);
  const player = next.players[playerId];
  const ensureHex = (h: string): HexState => (next.hexes[h] ??= { ...DEFAULT_HEX });

  switch (action.type) {
    case "pass":
      break;

    case "expand": {
      const mine = ownedHexes(next, playerId);
      const cost = claimCost(config, mine.length, action.h3);
      player.crude -= cost;
      player.workOrders -= 1;
      const hx = ensureHex(action.h3);
      hx.ownerId = playerId;
      hx.price = claimPrice(config, action.h3); // honest by default
      break;
    }

    case "upgrade": {
      const hx = ensureHex(action.h3);
      player.crude -= config.costs.upgrade[hx.upgradeLevel];
      player.workOrders -= 1;
      hx.upgradeLevel += 1;
      break;
    }

    case "assess": {
      // Free: name your price. The county taxes what you name.
      if (!(action.price >= config.assessment.minPrice)) {
        throw new Error(`Assessments start at $${config.assessment.minPrice}.`);
      }
      next.hexes[action.h3].price = Math.round(action.price);
      break;
    }

    case "buyout": {
      // The Harberger handshake: pay the owner their own number, take the deed.
      const hx = next.hexes[action.h3];
      const price = assessedPrice(next, config, action.h3);
      if (player.crude < price) throw new Error("Not enough money for that asking price.");
      const seller = next.players[hx.ownerId!];
      player.crude -= price;
      player.workOrders -= 1;
      if (seller) seller.crude += price;
      hx.ownerId = playerId;
      // The new owner inherits improvements and the price they just proved.
      break;
    }

    case "repair": {
      const hx = ensureHex(action.h3);
      player.crude -= hx.degradation * config.quake.repairPerPoint;
      player.workOrders -= 1;
      hx.degradation = 0;
      break;
    }
  }

  return next;
}

// ─── Tick: resolve one day ────────────────────────────────────────────────────

export interface TickOptions {
  /** Grant the weekly free Work Order (the shell passes true on Mondays PT). */
  weeklyFree?: boolean;
}

export function tick(
  state: GameState,
  config: GameConfig,
  events: GameEvent[],
  opts: TickOptions = {}
): GameState {
  const next = clone(state);
  const y = config.yield;
  const wo = config.workOrders;

  // Index events by hex.
  const byHex = new Map<string, GameEvent[]>();
  for (const e of events) {
    if (!byHex.has(e.h3)) byHex.set(e.h3, []);
    byHex.get(e.h3)!.push(e);
  }

  const report: TickReport = { tick: next.tick, perPlayer: {}, foreclosures: [] };
  for (const id of Object.keys(next.players)) {
    report.perPlayer[id] = { gained: 0, ordersEarned: 0, taxPaid: 0, entries: [] };
  }

  for (const [h3, hx] of Object.entries(next.hexes)) {
    if (!hx.ownerId) continue;
    const player = next.players[hx.ownerId];
    if (!player) continue;

    const wells = config.board[h3]?.wells ?? 0;
    const hexEvents = byHex.get(h3) ?? [];

    // The purse: your hexes pay what the city ticketed there ($/day), plus a
    // little oil flavor money. Real records, real dollars — no dice.
    const fineDollars = hexEvents
      .filter((e) => e.kind === "fine")
      .reduce((a, e) => a + e.magnitude, 0);
    const base = fineDollars * y.finePayout + wells * y.perWell;
    const upgradeMult = 1 + (y.upgradeBonus[hx.upgradeLevel] ?? 0);
    const degradeFactor = 1 - hx.degradation / 100;
    const notes: string[] = [];

    // The Madre stirs: quake events deposit degradation.
    const quakeDamage = hexEvents
      .filter((e) => e.kind === "quake")
      .reduce((a, e) => a + e.magnitude, 0);
    if (quakeDamage > 0) {
      hx.degradation = Math.min(100, hx.degradation + Math.round(quakeDamage));
      notes.push("the Madre stirred");
    }

    // The city dispatches you: carrion in your territory becomes Work Orders.
    const carrion = hexEvents
      .filter((e) => e.kind === "deadAnimal")
      .reduce((a, e) => a + e.magnitude, 0);
    const orders = carrion * wo.perCarrion;
    if (orders > 0) {
      player.workOrders = Math.min(wo.cap, (player.workOrders ?? 0) + orders);
      report.perPlayer[hx.ownerId].ordersEarned += orders;
      if (carrion >= 1) notes.push("the city calls — carrion pickup");
    }

    const baseYield = Math.floor(base * upgradeMult * degradeFactor);
    const finalYield = Math.max(0, baseYield);

    player.crude += finalYield;
    report.perPlayer[hx.ownerId].gained += finalYield;
    report.perPlayer[hx.ownerId].entries.push({ h3, baseYield, finalYield, notes });
  }

  // The weekly free order (Mondays, from the shell's clock).
  if (opts.weeklyFree) {
    for (const p of Object.values(next.players)) {
      p.workOrders = Math.min(wo.cap, (p.workOrders ?? 0) + wo.weeklyFree);
    }
  }

  // The county collects: daily tax on every parcel's self-assessed price.
  // Can't pay? The county takes parcels for back taxes, cheapest first.
  const rate = config.assessment.taxRate;
  for (const [id, player] of Object.entries(next.players)) {
    const owned = Object.entries(next.hexes)
      .filter(([, hx]) => hx.ownerId === id)
      .map(([h3, hx]) => ({ h3, hx, price: hx.price ?? claimPrice(config, h3) }));
    if (!owned.length) continue;

    let tax = Math.round(owned.reduce((a, o) => a + o.price, 0) * rate);
    if (player.crude >= tax) {
      player.crude -= tax;
      report.perPlayer[id].taxPaid = tax;
      continue;
    }
    // Foreclosure: forfeit lowest-priced parcels until the bill fits.
    owned.sort((a, b) => a.price - b.price);
    while (owned.length && player.crude < tax) {
      const lost = owned.shift()!;
      lost.hx.ownerId = null;
      report.foreclosures.push({ h3: lost.h3, ownerId: id });
      tax = Math.round(owned.reduce((a, o) => a + o.price, 0) * rate);
    }
    const due = Math.min(tax, Math.max(0, player.crude));
    player.crude -= due;
    report.perPlayer[id].taxPaid = due;
  }

  next.tick += 1;
  next.lastReport = report;
  return next;
}

// ─── Terminal state / scoring ──────────────────────────────────────────────────

export function isOver(state: GameState, config: GameConfig): boolean {
  return config.seasonLength !== undefined && state.tick >= config.seasonLength;
}

export interface PlayerScore {
  hexes: number;
  crude: number;
}

export function result(state: GameState): Record<PlayerId, PlayerScore> {
  const scores: Record<PlayerId, PlayerScore> = {};
  for (const id of Object.keys(state.players)) scores[id] = { hexes: 0, crude: state.players[id].crude };
  for (const hx of Object.values(state.hexes)) {
    if (hx.ownerId && scores[hx.ownerId]) scores[hx.ownerId].hexes += 1;
  }
  return scores;
}
