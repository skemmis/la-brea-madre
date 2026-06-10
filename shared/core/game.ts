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
import { relicDef, RELICS, type YieldHookCtx } from "./relics";
import type {
  Action,
  ContestResult,
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
  exploited: false,
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

function claimCost(config: GameConfig, ownedCount: number): number {
  if (ownedCount === 0 && config.costs.firstClaimFree) return 0;
  return config.costs.claim;
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function newGame(config: GameConfig, seed: number): GameState {
  const players: GameState["players"] = {};
  for (const id of config.players) {
    players[id] = {
      id,
      crude: config.startingCrude,
      relics: [],
      cards: [],
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
    relics: [],
    cards: [],
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

  // Free stance toggles (do not consume the daily action).
  for (const h of mine) {
    const hx = hexState(state, h);
    if (hx.degradation < 100) actions.push({ type: "setExploit", h3: h, on: !hx.exploited });
  }

  // Defend is always available on your own embattled hexes (no order cost).
  for (const [h3, c] of Object.entries(state.contests ?? {})) {
    if (c.defenderId === playerId && player.crude > 0) {
      actions.push({ type: "defend", h3, bid: 0 });
    }
  }

  // Everything below spends a Work Order.
  if ((player.workOrders ?? 0) < 1) return actions;

  // Expand: adjacent unowned board hexes (or any board hex for the first claim).
  const cost = claimCost(config, mine.length);
  if (player.crude >= cost) {
    if (mine.length === 0) {
      for (const h of Object.keys(config.board)) actions.push({ type: "expand", h3: h });
    } else {
      const frontier = new Set<string>();
      for (const h of mine) {
        for (const n of gridDisk(h, 1)) {
          if (n !== h && config.board[n] && hexState(state, n).ownerId === null) frontier.add(n);
        }
      }
      for (const h of frontier) actions.push({ type: "expand", h3: h });
    }
  }

  // Upgrade: an owned hex below max level you can afford.
  for (const h of mine) {
    const hx = hexState(state, h);
    if (hx.upgradeLevel < config.maxUpgrade && player.crude >= config.costs.upgrade[hx.upgradeLevel]) {
      actions.push({ type: "upgrade", h3: h });
    }
  }

  // Acquire relic: any not-yet-owned relic you can afford.
  if (player.crude >= config.costs.relic) {
    for (const id of Object.keys(RELICS)) {
      if (!player.relics.includes(id)) actions.push({ type: "acquireRelic", relicId: id });
    }
  }

  // Contest: an enemy hex on your frontier, not already embattled.
  if (player.crude >= config.combat.minBid) {
    const frontier = new Set<string>();
    for (const h of mine) {
      for (const n of gridDisk(h, 1)) {
        const owner = hexState(state, n).ownerId;
        if (n !== h && config.board[n] && owner && owner !== playerId) frontier.add(n);
      }
    }
    for (const h of frontier) {
      if (!state.contests?.[h]) actions.push({ type: "contest", h3: h, bid: 0 });
    }
  }

  return actions;
}

function actionsEqual(a: Action, b: Action): boolean {
  // Bids are free-form amounts — legality is about the target, not the size.
  if ((a.type === "contest" || a.type === "defend") && a.type === b.type) {
    return a.h3 === (b as Extract<Action, { type: "contest" | "defend" }>).h3;
  }
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

    case "setExploit": {
      const hx = ensureHex(action.h3);
      hx.exploited = action.on; // free stance — does not consume the daily action
      break;
    }

    case "expand": {
      const mine = ownedHexes(next, playerId);
      const cost = claimCost(config, mine.length);
      player.crude -= cost;
      player.workOrders -= 1;
      const hx = ensureHex(action.h3);
      hx.ownerId = playerId;
      break;
    }

    case "upgrade": {
      const hx = ensureHex(action.h3);
      player.crude -= config.costs.upgrade[hx.upgradeLevel];
      player.workOrders -= 1;
      hx.upgradeLevel += 1;
      break;
    }

    case "acquireRelic": {
      player.crude -= config.costs.relic;
      player.workOrders -= 1;
      player.relics.push(action.relicId);
      break;
    }

    case "contest": {
      // Declare war: escrow the sealed bid, spend the order. Resolves at tick.
      if (!(action.bid >= config.combat.minBid)) {
        throw new Error(`A war chest needs at least $${config.combat.minBid}.`);
      }
      if (player.crude < action.bid) throw new Error("Not enough money for that bid.");
      const target = hexState(next, action.h3);
      if (!target.ownerId || target.ownerId === playerId) {
        throw new Error("Only an enemy hex can be contested.");
      }
      player.crude -= action.bid;
      player.workOrders -= 1;
      next.contests ??= {};
      next.contests[action.h3] = {
        h3: action.h3,
        attackerId: playerId,
        defenderId: target.ownerId,
        attackerBid: action.bid,
        defenderBid: 0,
        declaredTick: next.tick,
      };
      break;
    }

    case "defend": {
      const c = next.contests?.[action.h3];
      if (!c || c.defenderId !== playerId) throw new Error("No contest to defend there.");
      if (!(action.bid > 0)) throw new Error("A defense bid must be positive.");
      if (player.crude < action.bid) throw new Error("Not enough money for that bid.");
      player.crude -= action.bid;
      c.defenderBid += action.bid; // raises accumulate
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

  const report: TickReport = { tick: next.tick, perPlayer: {}, contests: [] };
  for (const id of Object.keys(next.players)) {
    report.perPlayer[id] = { gained: 0, ordersEarned: 0, entries: [] };
  }

  for (const [h3, hx] of Object.entries(next.hexes)) {
    if (!hx.ownerId) continue;
    const player = next.players[hx.ownerId];
    if (!player) continue;

    const wells = config.board[h3]?.wells ?? 0;
    const hexEvents = byHex.get(h3) ?? [];
    const ctx: YieldHookCtx = { wells, level: hx.upgradeLevel, exploited: hx.exploited, events: hexEvents };
    const relics = player.relics.map(relicDef).filter(Boolean) as ReturnType<typeof relicDef>[];

    // The purse: your hexes pay what the city ticketed there ($/day), plus a
    // little oil flavor money. Real records, real dollars — no dice.
    const fineDollars = hexEvents
      .filter((e) => e.kind === "fine")
      .reduce((a, e) => a + e.magnitude, 0);
    const base = fineDollars * y.finePayout + wells * y.perWell;
    const upgradeMult = 1 + (y.upgradeBonus[hx.upgradeLevel] ?? 0);
    const exploitMult = hx.exploited ? y.exploitMultiplier : 1;
    const degradeFactor = 1 - hx.degradation / 100;

    let relicMult = 1;
    let relicBonus = 0;
    const notes: string[] = [];
    for (const r of relics) {
      if (r!.yieldMult) relicMult *= r!.yieldMult(ctx);
      if (r!.yieldBonus) relicBonus += r!.yieldBonus(ctx);
      const note = r!.note?.(ctx);
      if (note) notes.push(note);
    }

    const baseYield = Math.floor(base * upgradeMult * exploitMult * degradeFactor);
    const finalYield = Math.max(
      0,
      Math.floor(base * upgradeMult * exploitMult * degradeFactor * relicMult) + relicBonus
    );

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

    player.crude += finalYield;
    report.perPlayer[hx.ownerId].gained += finalYield;
    report.perPlayer[hx.ownerId].entries.push({ h3, baseYield, finalYield, notes });

    // Exploit degrades the hex (relics can soften it).
    if (hx.exploited) {
      let degradeMult = 1;
      for (const r of relics) if (r!.degradeMult) degradeMult *= r!.degradeMult();
      hx.degradation = Math.min(100, hx.degradation + y.exploitDegradePerTick * degradeMult);
    }
  }

  // The weekly free order (Mondays, from the shell's clock).
  if (opts.weeklyFree) {
    for (const p of Object.values(next.players)) {
      p.workOrders = Math.min(wo.cap, (p.workOrders ?? 0) + wo.weeklyFree);
    }
  }

  // Resolve the wars: sealed bids open at the tick. Higher purse takes the
  // hex; the defender wins ties; the loser recovers half their committed war
  // chest; the winner's is spent (the city keeps it).
  for (const c of Object.values(next.contests ?? {})) {
    const hx = next.hexes[c.h3];
    const attacker = next.players[c.attackerId];
    const defender = next.players[c.defenderId];
    // The hex changed hands or vanished since declaration: stand down, full refunds.
    if (!hx || hx.ownerId !== c.defenderId || !attacker || !defender) {
      if (attacker) attacker.crude += c.attackerBid;
      if (defender) defender.crude += c.defenderBid;
      continue;
    }
    const attackerWins = c.attackerBid > c.defenderBid;
    const winnerId = attackerWins ? c.attackerId : c.defenderId;
    if (attackerWins) {
      hx.ownerId = c.attackerId;
      hx.exploited = false; // spoils keep their upgrades, not their stance
      defender.crude += c.defenderBid * config.combat.loserRefund;
    } else {
      attacker.crude += c.attackerBid * config.combat.loserRefund;
    }
    report.contests.push({
      h3: c.h3,
      attackerId: c.attackerId,
      defenderId: c.defenderId,
      attackerBid: c.attackerBid,
      defenderBid: c.defenderBid,
      winnerId,
    });
  }
  next.contests = {};

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
