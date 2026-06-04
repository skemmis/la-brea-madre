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
import { relicDef, RELICS, type YieldHookCtx } from "./relics";
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
    players[id] = { id, crude: config.startingCrude, relics: [], actionUsedTick: -1 };
  }
  return { seed, rng: makeRng(seed), tick: 0, players, hexes: {}, lastReport: null };
}

/** Add a player to an existing game (a mid-season join). No-op if present. */
export function addPlayer(state: GameState, config: GameConfig, playerId: PlayerId): GameState {
  if (state.players[playerId]) return state;
  const next = clone(state);
  next.players[playerId] = {
    id: playerId,
    crude: config.startingCrude,
    relics: [],
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

  // The one daily action (expand / upgrade / acquire relic).
  if (player.actionUsedTick === state.tick) return actions;

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

  return actions;
}

function actionsEqual(a: Action, b: Action): boolean {
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
      player.actionUsedTick = next.tick;
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
      const hx = ensureHex(action.h3);
      hx.ownerId = playerId;
      player.actionUsedTick = next.tick;
      break;
    }

    case "upgrade": {
      const hx = ensureHex(action.h3);
      player.crude -= config.costs.upgrade[hx.upgradeLevel];
      hx.upgradeLevel += 1;
      player.actionUsedTick = next.tick;
      break;
    }

    case "acquireRelic": {
      player.crude -= config.costs.relic;
      player.relics.push(action.relicId);
      player.actionUsedTick = next.tick;
      break;
    }
  }

  return next;
}

// ─── Tick: resolve one day ────────────────────────────────────────────────────

export function tick(state: GameState, config: GameConfig, events: GameEvent[]): GameState {
  const next = clone(state);
  const y = config.yield;

  // Index events by hex.
  const byHex = new Map<string, GameEvent[]>();
  for (const e of events) {
    if (!byHex.has(e.h3)) byHex.set(e.h3, []);
    byHex.get(e.h3)!.push(e);
  }

  const report: TickReport = { tick: next.tick, perPlayer: {} };
  for (const id of Object.keys(next.players)) report.perPlayer[id] = { gained: 0, entries: [] };

  for (const [h3, hx] of Object.entries(next.hexes)) {
    if (!hx.ownerId) continue;
    const player = next.players[hx.ownerId];
    if (!player) continue;

    const wells = config.board[h3]?.wells ?? 0;
    const hexEvents = byHex.get(h3) ?? [];
    const ctx: YieldHookCtx = { wells, level: hx.upgradeLevel, exploited: hx.exploited, events: hexEvents };
    const relics = player.relics.map(relicDef).filter(Boolean) as ReturnType<typeof relicDef>[];

    const base = wells * y.perWell;
    const upgradeMult = 1 + (y.upgradeBonus[hx.upgradeLevel] ?? 0);
    const exploitMult = hx.exploited ? y.exploitMultiplier : 1;
    const degradeFactor = 1 - hx.degradation / 100;

    // The daily "dice": a random swing, nudged upward by real citation activity.
    const citationMag = hexEvents.filter((e) => e.kind === "citation").reduce((a, e) => a + e.magnitude, 0);
    const citationKick = Math.min(y.citationInfluenceCap, citationMag * y.citationInfluence);
    const swing = (nextFloat(next.rng) - 0.5) * 2 * y.volatility;
    const weatherMult = Math.max(0, 1 + swing + citationKick);

    let relicMult = 1;
    let relicBonus = 0;
    const notes: string[] = [];
    for (const r of relics) {
      if (r!.yieldMult) relicMult *= r!.yieldMult(ctx);
      if (r!.yieldBonus) relicBonus += r!.yieldBonus(ctx);
      const note = r!.note?.(ctx);
      if (note) notes.push(note);
    }

    if (weatherMult > 1.12) notes.push("busy streets");
    else if (weatherMult < 0.88) notes.push("quiet day");

    const baseYield = Math.floor(base * upgradeMult * exploitMult * degradeFactor);
    const finalYield = Math.max(
      0,
      Math.floor(base * upgradeMult * exploitMult * degradeFactor * weatherMult * relicMult) + relicBonus
    );

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
