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
import { makeRng, nextFloat } from "./rng";
import { CARD_BY_ID, openPack, starterBinder, type CardDef } from "./cards";
import { resolveBattle, type Terrain } from "./battle";
import { SAINT_BY_ID, hasSaint, type BattleMods } from "./saints";
import type {
  Action,
  BinderCard,
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

/** Repair cost: degradation × value-scaled rate — prime land costs to fix. */
export function repairCost(config: GameConfig, h3: string, degradation: number): number {
  const perPoint = Math.max(
    config.quake.repairFloorPerPoint,
    claimPrice(config, h3) * config.quake.repairFraction
  );
  return Math.round(degradation * perPoint);
}

/** A parcel's current asking price (owner-set, defaulting to market value). */
export function assessedPrice(state: GameState, config: GameConfig, h3: string): number {
  return state.hexes[h3]?.price ?? claimPrice(config, h3);
}

/** Is the parcel CRACKED — walls down, the Madre's window open? */
export function isCracked(state: GameState, config: GameConfig, h3: string): boolean {
  return (state.hexes[h3]?.degradation ?? 0) >= config.quake.crackedThreshold;
}

/**
 * What the county says the parcel is worth FOR RAID PRICING: book value
 * marked down by the damage. (Tax stays on the full book — the county does
 * not forgive the books.)
 */
export function raidValue(state: GameState, config: GameConfig, h3: string): number {
  const deg = state.hexes[h3]?.degradation ?? 0;
  return Math.max(
    config.assessment.minPrice,
    Math.round(claimPrice(config, h3) * (1 - deg / 100))
  );
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function newGame(config: GameConfig, seed: number): GameState {
  const state: GameState = {
    seed,
    rng: makeRng(seed),
    tick: 0,
    players: {},
    hexes: {},
    economyVersion: 2, // born in dollars — the shell's x10 migration must skip us
    lastReport: null,
    markets: {},
    lastSettlement: null,
  };
  for (const id of config.players) {
    state.players[id] = {
      id,
      crude: config.startingCrude,
      workOrders: config.workOrders.starting,
      actionUsedTick: -1,
      ...(config.raids.enabled
        ? {
            binder: starterBinder(state.rng, config.raids.starterCards).map((def) => ({ def })),
            scrip: 0,
          }
        : {}),
    };
  }
  return state;
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
    ...(config.raids.enabled
      ? {
          binder: starterBinder(next.rng, config.raids.starterCards).map((def) => ({ def })),
          scrip: 0,
        }
      : {}),
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
  // (Buyout era only: under raids, the county sets every valuation itself.)
  if (!config.raids.enabled) {
    for (const h of mine) {
      actions.push({ type: "assess", h3: h, price: assessedPrice(state, config, h) });
    }
  }

  // Everything below spends a Work Order.
  if ((player.workOrders ?? 0) < 1) return actions;

  // Expand: adjacent unowned board hexes (or any unowned board hex for the
  // first claim). Land is priced at its value — affordability is per parcel.
  if (mine.length === 0) {
    for (const h of Object.keys(config.board)) {
      if (hexState(state, h).ownerId === null && player.crude >= claimCost(config, 0, h)) {
        actions.push({ type: "expand", h3: h });
      }
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

  // Repair: clear a shaken parcel's degradation (1 order + $ scaled to value).
  for (const h of mine) {
    const hx = hexState(state, h);
    if (hx.degradation > 0 && player.crude >= repairCost(config, h, hx.degradation)) {
      actions.push({ type: "repair", h3: h });
    }
  }

  // Retrofit: bolt a parcel down against the Madre (one-time, value-priced).
  for (const h of mine) {
    const hx = hexState(state, h);
    if (!hx.retrofitted && player.crude >= Math.round(claimPrice(config, h) * config.works.retrofitCostFraction)) {
      actions.push({ type: "retrofit", h3: h });
    }
  }

  // Dispatch a crew: a week of boosted pay on one parcel.
  for (const h of mine) {
    const hx = hexState(state, h);
    if ((hx.crewUntilTick ?? 0) <= state.tick && player.crude >= config.works.crewCost) {
      actions.push({ type: "crew", h3: h });
    }
  }

  if (config.raids.enabled) {
    // Raid: challenge any other player's deed to tonight's deck-fight.
    // Everything prices off the county valuation — the ledger, not the owner.
    for (const [h3, hx] of Object.entries(state.hexes)) {
      if (
        hx.ownerId &&
        hx.ownerId !== playerId &&
        player.crude >= Math.round(raidValue(state, config, h3) * config.raids.compFraction)
      ) {
        actions.push({ type: "raid", h3 });
      }
    }
  } else {
    // Buyout: any other player's parcel, at the owner's own asking price.
    for (const [h3, hx] of Object.entries(state.hexes)) {
      if (hx.ownerId && hx.ownerId !== playerId && player.crude >= assessedPrice(state, config, h3)) {
        actions.push({ type: "buyout", h3 });
      }
    }
  }

  return actions;
}

// ─── Apply a single action ──────────────────────────────────────────────────

/**
 * Validate one proposed action directly — the same rules legalActions encodes,
 * without enumerating every move on the board. Throws with a reason if the
 * action is illegal; returns quietly if it may be applied.
 */
export function assertLegal(
  state: GameState,
  config: GameConfig,
  playerId: PlayerId,
  action: Action
): void {
  const player = state.players[playerId];
  if (!player) throw new Error(`No such player: ${playerId}`);
  const deny = (why: string): never => {
    throw new Error(`Illegal action for ${playerId}: ${why}`);
  };

  if (action.type === "pass") return;

  if (action.type === "assess") {
    // Free: name your price. The county taxes what you name.
    if (config.raids.enabled) deny("the county sets valuations now — the ledger is not a suggestion box");
    if (hexState(state, action.h3).ownerId !== playerId) deny("you can only assess your own parcel");
    if (!(action.price >= config.assessment.minPrice)) {
      deny(`assessments start at $${config.assessment.minPrice}`);
    }
    return;
  }

  // Everything below spends a Work Order.
  if ((player.workOrders ?? 0) < 1) deny("no Work Orders left");

  switch (action.type) {
    case "expand": {
      if (!config.board[action.h3]) deny("that parcel is off the county sheet");
      if (hexState(state, action.h3).ownerId !== null) deny("that parcel is already deeded");
      const mine = ownedHexes(state, playerId);
      if (mine.length > 0) {
        const touches = gridDisk(action.h3, 1).some(
          (n) => n !== action.h3 && state.hexes[n]?.ownerId === playerId
        );
        if (!touches) deny("expansion must touch your territory");
      }
      if (player.crude < claimCost(config, mine.length, action.h3)) deny("not enough money");
      return;
    }
    case "upgrade": {
      const hx = hexState(state, action.h3);
      if (hx.ownerId !== playerId) deny("not your parcel");
      if (hx.upgradeLevel >= config.maxUpgrade) deny("already at max upgrade");
      if (player.crude < config.costs.upgrade[hx.upgradeLevel]) deny("not enough money");
      return;
    }
    case "repair": {
      const hx = hexState(state, action.h3);
      if (hx.ownerId !== playerId) deny("not your parcel");
      if (!(hx.degradation > 0)) deny("nothing to repair");
      if (player.crude < repairCost(config, action.h3, hx.degradation)) deny("not enough money");
      return;
    }
    case "retrofit": {
      const hx = hexState(state, action.h3);
      if (hx.ownerId !== playerId) deny("not your parcel");
      if (hx.retrofitted) deny("already retrofitted");
      if (player.crude < Math.round(claimPrice(config, action.h3) * config.works.retrofitCostFraction))
        deny("not enough money");
      return;
    }
    case "crew": {
      const hx = hexState(state, action.h3);
      if (hx.ownerId !== playerId) deny("not your parcel");
      if ((hx.crewUntilTick ?? 0) > state.tick) deny("a crew is already on site");
      if (player.crude < config.works.crewCost) deny("not enough money");
      return;
    }
    case "buyout": {
      if (config.raids.enabled) deny("deeds change hands by raid now — the buyout window is closed");
      const hx = state.hexes[action.h3];
      if (!hx?.ownerId) deny("nothing deeded there");
      if (hx.ownerId === playerId) deny("you already own that parcel");
      if (player.crude < assessedPrice(state, config, action.h3)) {
        deny("not enough money for that asking price");
      }
      return;
    }
    case "raid": {
      if (!config.raids.enabled) deny("raids are not open in this game");
      const hx = state.hexes[action.h3];
      if (!hx?.ownerId) deny("nothing deeded there");
      if (hx.ownerId === playerId) deny("you already own that parcel");
      const escrow = Math.round(raidValue(state, config, action.h3) * config.raids.compFraction);
      if (player.crude < escrow) deny("not enough money to post the raid escrow");
      return;
    }
  }
}

/** The mutation body — callers must have passed assertLegal first. */
function applyLegalAction(
  state: GameState,
  config: GameConfig,
  playerId: PlayerId,
  action: Action
): void {
  const player = state.players[playerId];
  const ensureHex = (h: string): HexState => (state.hexes[h] ??= { ...DEFAULT_HEX });

  switch (action.type) {
    case "pass":
      break;

    case "expand": {
      const mine = ownedHexes(state, playerId);
      const cost = claimCost(config, mine.length, action.h3);
      player.crude -= cost;
      player.workOrders -= 1;
      const hx = ensureHex(action.h3);
      hx.ownerId = playerId;
      // Buyout era: a default honest asking price. Raid era: the county's call.
      if (!config.raids.enabled) hx.price = claimPrice(config, action.h3);
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
      state.hexes[action.h3].price = Math.round(action.price);
      break;
    }

    case "buyout": {
      // The Harberger handshake: pay the owner their own number, take the deed.
      const hx = state.hexes[action.h3];
      const price = assessedPrice(state, config, action.h3);
      const seller = state.players[hx.ownerId!];
      player.crude -= price;
      player.workOrders -= 1;
      if (seller) seller.crude += price;
      hx.ownerId = playerId;
      // The new owner inherits improvements and the price they just proved.
      break;
    }

    case "repair": {
      const hx = ensureHex(action.h3);
      player.crude -= repairCost(config, action.h3, hx.degradation);
      player.workOrders -= 1;
      hx.degradation = 0;
      break;
    }

    case "retrofit": {
      const hx = ensureHex(action.h3);
      player.crude -= Math.round(claimPrice(config, action.h3) * config.works.retrofitCostFraction);
      player.workOrders -= 1;
      hx.retrofitted = true;
      break;
    }

    case "crew": {
      const hx = ensureHex(action.h3);
      player.crude -= config.works.crewCost;
      player.workOrders -= 1;
      hx.crewUntilTick = state.tick + config.works.crewDays;
      break;
    }

    case "raid": {
      // Post escrow now; the battle happens at tonight's tick. The county
      // marks damaged land down — a cracked jewel is a discount jewel.
      const ask = raidValue(state, config, action.h3);
      const escrow = Math.round(ask * config.raids.compFraction);
      player.crude -= escrow;
      player.workOrders -= 1;
      state.pendingRaids ??= [];
      state.pendingRaids.push({
        h3: action.h3,
        attackerId: playerId,
        escrow,
        stake: Math.round(ask * config.raids.stakeFraction),
      });
      break;
    }
  }
}

export function applyAction(
  state: GameState,
  config: GameConfig,
  playerId: PlayerId,
  action: Action
): GameState {
  assertLegal(state, config, playerId, action);
  const next = clone(state);
  applyLegalAction(next, config, playerId, action);
  return next;
}

/**
 * In-place variant for bulk drivers (the sim's hundred-bot days): identical
 * rules and results, but MUTATES the given state instead of cloning it.
 * Validation happens before any mutation, so a throw leaves state untouched.
 */
export function applyActionMut(
  state: GameState,
  config: GameConfig,
  playerId: PlayerId,
  action: Action
): void {
  assertLegal(state, config, playerId, action);
  applyLegalAction(state, config, playerId, action);
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

  // The city patches itself: degradation fades a little every dawn.
  for (const hx of Object.values(next.hexes)) {
    if (hx.degradation > 0) hx.degradation = Math.floor(hx.degradation * config.quake.healFactor);
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
    const crewMult = (hx.crewUntilTick ?? 0) > next.tick ? config.works.crewMult : 1;
    const degradeFactor = 1 - hx.degradation / 100;
    const notes: string[] = [];
    if (crewMult > 1) notes.push("crew on site");

    // The Madre stirs: quake events deposit degradation.
    const quakeDamage = hexEvents
      .filter((e) => e.kind === "quake")
      .reduce((a, e) => a + e.magnitude, 0);
    if (quakeDamage > 0) {
      const mult = hx.retrofitted ? config.works.retrofitDamageMult : 1;
      hx.degradation = Math.min(100, hx.degradation + Math.round(quakeDamage * mult));
      notes.push(hx.retrofitted ? "the Madre stirred — the bolts held" : "the Madre stirred");
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
    const finalYield = Math.max(0, Math.floor(base * upgradeMult * crewMult * degradeFactor));

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
  const ownedBy = new Map<PlayerId, { h3: string; hx: HexState; price: number }[]>();
  for (const [h3, hx] of Object.entries(next.hexes)) {
    if (!hx.ownerId) continue;
    if (!ownedBy.has(hx.ownerId)) ownedBy.set(hx.ownerId, []);
    // Raid era: tax accrues on the county valuation — there is no dodging it.
    const price = config.raids.enabled ? claimPrice(config, h3) : (hx.price ?? claimPrice(config, h3));
    ownedBy.get(hx.ownerId)!.push({ h3, hx, price });
  }
  for (const [id, player] of Object.entries(next.players)) {
    const owned = ownedBy.get(id);
    if (!owned?.length) continue;

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

  // The night's raids: every challenged deed is decided by deck-fight.
  if (config.raids.enabled) resolveNightRaids(next, config, report);

  next.tick += 1;
  next.lastReport = report;
  return next;
}

// ─── Raids: the deck-fight layer ──────────────────────────────────────────────

/** What the ground favors: the three strata, read off the real city. */
export function terrainOf(config: GameConfig, state: GameState, h3: string): Terrain {
  const cell = config.board[h3];
  return {
    // The under: tar wells, or ground the Madre has already broken.
    black: (cell?.wells ?? 0) > 0 || (state.hexes[h3]?.degradation ?? 0) > 0,
    // The middle: a real ticket corridor.
    blue: (cell?.fineRate ?? 0) >= config.raids.machineTerrainFine,
    // The upper: the dead-animal fringe.
    white: (cell?.carrionRate ?? 0) >= config.raids.carrionTerrainRate,
  };
}

/**
 * Resolve tonight's raids in declaration order. Each player has ONE shuffled
 * binder for the whole night — every battle they fight (attacking or
 * defending) draws from it without replacement. Run out, and the late
 * battles are fought on scraps. This is the finite-army rule: a wide empire
 * can fully defend collectionCap/battleSize fronts, and no more.
 */
function resolveNightRaids(next: GameState, config: GameConfig, report: TickReport): void {
  const raids = next.pendingRaids ?? [];
  if (!raids.length) return;
  next.pendingRaids = [];
  report.raids = [];

  // Each player's night pool: rested binder indices, shuffled once.
  const pools = new Map<PlayerId, number[]>();
  const poolOf = (id: PlayerId): number[] => {
    let pool = pools.get(id);
    if (!pool) {
      const binder = next.players[id]?.binder ?? [];
      pool = [];
      for (let i = 0; i < binder.length; i++) {
        if ((binder[i].restUntil ?? 0) <= next.tick) pool.push(i);
      }
      // Fisher–Yates on the game's own RNG — the draw is the dice.
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(nextFloat(next.rng) * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      pools.set(id, pool);
    }
    return pool;
  };
  // Draw, then arrange light-to-heavy: weight decides who opens and who
  // closes the night. (Stable on ties, so equal weights keep draw order.)
  const draw = (id: PlayerId): number[] => {
    const idx = poolOf(id).splice(0, config.raids.battleSize);
    const binder = next.players[id]?.binder ?? [];
    return idx
      .map((i, order) => ({ i, order, w: CARD_BY_ID[binder[i]?.def ?? ""]?.weight ?? 9 }))
      .sort((x, y) => x.w - y.w || x.order - y.order)
      .map((x) => x.i);
  };

  // What each side carries in from the rearview mirror.
  const modsOf = (id: PlayerId): BattleMods => {
    const p = next.players[id];
    return {
      saints: (p?.saints ?? []).map((s) => SAINT_BY_ID[s]).filter(Boolean),
      fossils: p?.fossils?.length ?? 0,
    };
  };

  // Fates are queued all night and settled at dawn (stable binder indices).
  // Priority per beaten card: poach > sink/reckless burn > side fate.
  const toRest: { id: PlayerId; idx: number }[] = [];
  const toBurn = new Map<PlayerId, Set<number>>();
  const toPoach: { fromId: PlayerId; idx: number; toId: PlayerId }[] = [];
  const toHeal = new Map<PlayerId, number>(); // medic charges per player
  const burnSet = (id: PlayerId): Set<number> => {
    let s = toBurn.get(id);
    if (!s) {
      s = new Set();
      toBurn.set(id, s);
    }
    return s;
  };
  const burn = (id: PlayerId, idx: number): string[] => {
    burnSet(id).add(idx);
    const def = next.players[id]?.binder?.[idx]?.def;
    return def ? [def] : [];
  };

  for (const raid of raids) {
    const attacker = next.players[raid.attackerId];
    if (!attacker) continue;
    const hx = next.hexes[raid.h3];
    const defenderId = hx?.ownerId;
    if (!defenderId || defenderId === raid.attackerId) {
      // Moot by nightfall (foreclosed, or won by this raider's earlier raid).
      attacker.crude += raid.escrow;
      continue;
    }
    const defender = next.players[defenderId];

    const aIdx = draw(raid.attackerId);
    const dIdx = draw(defenderId);
    const aHand = aIdx.map((i) => CARD_BY_ID[attacker.binder![i].def]).filter(Boolean);
    const dHand = dIdx.map((i) => CARD_BY_ID[defender?.binder?.[i]?.def ?? ""]).filter(Boolean);
    const aMods = modsOf(raid.attackerId);
    const dMods = modsOf(defenderId);
    const cracked = isCracked(next, config, raid.h3);
    const result = resolveBattle(aHand, dHand, terrainOf(config, next, raid.h3), config.raids.battleSize, {
      attacker: aMods,
      defender: dMods,
      cracked,
    });

    // Fates, lane by lane (phoenixes excluded — they always walk away).
    const burned = { attacker: [] as string[], defender: [] as string[] };
    const woundedReport = { attacker: [] as string[], defender: [] as string[] };
    const poached: [string, PlayerId][] = [];
    const settleSide = (
      side: "attacker" | "defender",
      lane: number,
      r: (typeof result.lanes)[number]
    ): void => {
      const me = side === "attacker" ? raid.attackerId : defenderId;
      const card = side === "attacker" ? r.attacker : r.defender;
      const idx = (side === "attacker" ? aIdx : dIdx)[lane];
      const foe = side === "attacker" ? r.defender : r.attacker;
      const foeWarded = side === "attacker" ? r.defenderWarded : r.attackerWarded;
      const myWarded = side === "attacker" ? r.attackerWarded : r.defenderWarded;
      const foeId = side === "attacker" ? defenderId : raid.attackerId;
      if (!card || idx === undefined) return;
      if (card.rite?.kind === "phoenix" && !myWarded) return; // it walks away

      const beaten = r.sunk || (r.winner !== "none" && r.winner !== side);
      const recklessFired = card.rite?.kind === "reckless" && !myWarded;
      if (beaten) {
        // The poacher's claim comes first: the winner steals what it beat.
        if (!r.sunk && foe?.rite?.kind === "poach" && !foeWarded) {
          toPoach.push({ fromId: me, idx, toId: foeId });
          poached.push([card.id, foeId]);
        } else if (r.sunk || recklessFired) {
          burned[side].push(...burn(me, idx)); // the tar keeps what it takes
        } else {
          const fate = side === "attacker" ? config.raids.attackerFate : config.raids.defenderFate;
          if (fate === "burn") burned[side].push(...burn(me, idx));
          else if (fate === "rest") {
            toRest.push({ id: me, idx });
            woundedReport[side].push(card.id);
          }
        }
      } else {
        // Survivors' rites: the reckless burn anyway; the medics make rounds.
        const mods = side === "attacker" ? aMods : dMods;
        const wonLane = r.winner === side;
        if (recklessFired) {
          // THE JUMPER CABLES: a reckless card that won its lane comes back.
          if (wonLane && hasSaint(mods, "jumper")) {
            // dead by its own nature; back by lunch
          } else {
            burned[side].push(...burn(me, idx));
          }
        } else if (card.rite?.kind === "medic" && !myWarded) {
          toHeal.set(me, (toHeal.get(me) ?? 0) + 1);
        }
      }
    };
    for (let lane = 0; lane < result.lanes.length; lane++) {
      settleSide("attacker", lane, result.lanes[lane]);
      settleSide("defender", lane, result.lanes[lane]);
    }

    let paid: number;
    if (result.winner === "attacker") {
      // The deed falls; the loser is paid their own number (half of it).
      hx.ownerId = raid.attackerId;
      if (defender) defender.crude += raid.escrow;
      paid = raid.escrow;
    } else if (hasSaint(aMods, "lostCause")) {
      // PATRON OF LOST CAUSES: the stake comes home anyway.
      attacker.crude += raid.escrow;
      paid = 0;
    } else {
      // The walls held: the stake stays with the defender, the rest comes home.
      if (defender) defender.crude += raid.stake;
      attacker.crude += raid.escrow - raid.stake;
      paid = raid.stake;
    }

    report.raids.push({
      h3: raid.h3,
      attackerId: raid.attackerId,
      defenderId,
      attackerWon: result.winner === "attacker",
      attackerLanes: result.attackerLanes,
      defenderLanes: result.defenderLanes,
      attackerCards: aHand.length,
      defenderCards: dHand.length,
      paid,
      cracked,
      burned,
      wounded: woundedReport,
      poached,
    });
  }

  // ── Dawn: wounds, theft, ash, and the medics' rounds ──
  for (const { id, idx } of toRest) {
    const b = next.players[id]?.binder?.[idx];
    if (b) b.restUntil = next.tick + 1 + config.raids.restDays;
  }
  // Stolen cards change binders, arriving wounded. A full binder can't hold
  // the prize — the poacher keeps it as a trophy fossil instead.
  for (const { fromId, idx, toId } of toPoach) {
    const card = next.players[fromId]?.binder?.[idx];
    if (!card) continue;
    burnSet(fromId).add(idx); // leaves the old binder either way
    const thief = next.players[toId];
    if (!thief) continue;
    thief.binder ??= [];
    if (thief.binder.length < config.raids.collectionCap) {
      thief.binder.push({ def: card.def, restUntil: next.tick + 1 + config.raids.restDays });
    } else {
      (thief.fossils ??= []).push({ def: card.def, tick: next.tick });
    }
  }
  // The dead leave the binder; rares and mythics leave a fossil behind.
  for (const [id, dead] of toBurn) {
    const p = next.players[id];
    if (!p?.binder) continue;
    const stolen = new Set(
      toPoach.filter((m) => m.fromId === id).map((m) => m.idx)
    );
    for (const idx of dead) {
      if (stolen.has(idx)) continue; // poached, not killed — no fossil
      const def = CARD_BY_ID[p.binder[idx]?.def ?? ""];
      if (def && (def.rarity === "rare" || def.rarity === "mythic")) {
        (p.fossils ??= []).push({ def: def.id, tick: next.tick });
      }
    }
    p.binder = p.binder.filter((_, i) => !dead.has(i));
  }
  // Medics heal the longest-suffering wounded card per charge.
  for (const [id, charges] of toHeal) {
    const binder = next.players[id]?.binder;
    if (!binder) continue;
    for (let c = 0; c < charges; c++) {
      let pick = -1;
      for (let i = 0; i < binder.length; i++) {
        const until = binder[i].restUntil ?? 0;
        if (until > next.tick && (pick === -1 || until > (binder[pick].restUntil ?? 0))) pick = i;
      }
      if (pick === -1) break;
      delete binder[pick].restUntil;
    }
  }
}

/**
 * Rip a pack: spend scrip, add `packs.size` cards to the binder (mutating).
 * Scrip is minted only by the Oracle — winning settlements pay it out.
 */
export function buyPackMut(state: GameState, config: GameConfig, playerId: PlayerId): string[] {
  const player = state.players[playerId];
  if (!player) throw new Error(`No such player: ${playerId}`);
  if ((player.scrip ?? 0) < config.packs.cost) throw new Error("Not enough scrip.");
  player.binder ??= [];
  if (player.binder.length + config.packs.size > config.raids.collectionCap) {
    throw new Error("No room in the binder — cut cards first.");
  }
  player.scrip = (player.scrip ?? 0) - config.packs.cost;
  const pulls = openPack(state.rng, config.packs.size);
  for (const def of pulls) player.binder.push({ def });
  return pulls;
}

/** Cut a card from the binder (mutating) — making room is free, regret isn't. */
export function cutCardMut(state: GameState, playerId: PlayerId, index: number): BinderCard {
  const binder = state.players[playerId]?.binder;
  if (!binder || index < 0 || index >= binder.length) throw new Error("No such card.");
  return binder.splice(index, 1)[0];
}

/**
 * Forge a Dashboard Saint at the fossil gallery (mutating): the tar takes
 * payment in bone — oldest fossils first — and something else comes back.
 * Saints are forever: no unforging, at most `saintSlots` on the mirror.
 */
export function forgeSaintMut(
  state: GameState,
  config: GameConfig,
  playerId: PlayerId,
  saintId: string
): void {
  const player = state.players[playerId];
  if (!player) throw new Error(`No such player: ${playerId}`);
  const saint = SAINT_BY_ID[saintId];
  if (!saint) throw new Error(`No such saint: ${saintId}`);
  player.saints ??= [];
  if (player.saints.includes(saintId)) throw new Error("That saint already rides with you.");
  if (player.saints.length >= config.raids.saintSlots) {
    throw new Error("The mirror is full — three saints is a congregation, four is a fight.");
  }
  if ((player.fossils?.length ?? 0) < saint.fossilCost) {
    throw new Error(`The forge wants ${saint.fossilCost} fossils.`);
  }
  player.fossils!.splice(0, saint.fossilCost);
  player.saints.push(saintId);
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
