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
import { CARD_BY_ID, openPack, starterBinder } from "./cards";
import { resolveBattle, type Terrain } from "./battle";
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

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function newGame(config: GameConfig, seed: number): GameState {
  const state: GameState = {
    seed,
    rng: makeRng(seed),
    tick: 0,
    players: {},
    hexes: {},
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
  for (const h of mine) {
    actions.push({ type: "assess", h3: h, price: assessedPrice(state, config, h) });
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
    for (const [h3, hx] of Object.entries(state.hexes)) {
      if (
        hx.ownerId &&
        hx.ownerId !== playerId &&
        player.crude >= Math.round(assessedPrice(state, config, h3) * config.raids.compFraction)
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
      const escrow = Math.round(assessedPrice(state, config, action.h3) * config.raids.compFraction);
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
      // Post escrow now; the battle happens at tonight's tick.
      const ask = assessedPrice(state, config, action.h3);
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
    ownedBy.get(hx.ownerId)!.push({ h3, hx, price: hx.price ?? claimPrice(config, h3) });
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

/** What the ground favors: real ticket money, real carrion, unrepaired damage. */
export function terrainOf(config: GameConfig, state: GameState, h3: string): Terrain {
  const cell = config.board[h3];
  return {
    machine: (cell?.fineRate ?? 0) >= config.raids.machineTerrainFine,
    carrion: (cell?.carrionRate ?? 0) >= config.raids.carrionTerrainRate,
    tremor: (state.hexes[h3]?.degradation ?? 0) > 0,
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
  const draw = (id: PlayerId): number[] => poolOf(id).splice(0, config.raids.battleSize);

  // Beaten cards' fates are settled after the whole night (stable indices).
  const toRest: { id: PlayerId; idx: number }[] = [];
  const toBurn = new Map<PlayerId, Set<number>>();
  const burnSet = (id: PlayerId): Set<number> => {
    let s = toBurn.get(id);
    if (!s) {
      s = new Set();
      toBurn.set(id, s);
    }
    return s;
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
    const result = resolveBattle(aHand, dHand, terrainOf(config, next, raid.h3), config.raids.battleSize);

    // Beaten cards (phoenixes excluded by the resolver's lane bookkeeping).
    for (let lane = 0; lane < result.lanes.length; lane++) {
      const r = result.lanes[lane];
      const aBeaten = r.attacker && (r.sunk || r.winner === "defender") && r.attacker.rite?.kind !== "phoenix";
      const dBeaten = r.defender && (r.sunk || r.winner === "attacker") && r.defender.rite?.kind !== "phoenix";
      if (aBeaten && aIdx[lane] !== undefined) {
        if (config.raids.burnBeaten) burnSet(raid.attackerId).add(aIdx[lane]);
        else if (config.raids.beatenRestDays > 0) toRest.push({ id: raid.attackerId, idx: aIdx[lane] });
      }
      if (dBeaten && dIdx[lane] !== undefined) {
        if (config.raids.burnBeaten) burnSet(defenderId).add(dIdx[lane]);
        else if (config.raids.beatenRestDays > 0) toRest.push({ id: defenderId, idx: dIdx[lane] });
      }
    }

    let paid: number;
    if (result.winner === "attacker") {
      // The deed falls; the loser is paid their own number (half of it).
      hx.ownerId = raid.attackerId;
      if (defender) defender.crude += raid.escrow;
      paid = raid.escrow;
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
    });
  }

  // Dawn: the beaten rest or burn.
  for (const { id, idx } of toRest) {
    const b = next.players[id]?.binder?.[idx];
    if (b) b.restUntil = next.tick + 1 + config.raids.beatenRestDays;
  }
  for (const [id, dead] of toBurn) {
    const p = next.players[id];
    if (p?.binder) p.binder = p.binder.filter((_, i) => !dead.has(i));
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
