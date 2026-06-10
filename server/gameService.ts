/**
 * Game service — the thin shell around the pure core.
 *
 * Responsibilities (and ONLY these):
 *   • Load the static board (which hexes exist + ambient wells) from the DB.
 *   • Build per-tick GameEvents from the live pipeline data (citations, carrion).
 *   • Load / persist the canonical GameState document (the source of truth).
 *   • Call the core (applyAction / tick) and project state back for the UI.
 *
 * All game rules, randomness, and balance live in shared/core. This file
 * contains no game logic — it only adapts the outside world to the core.
 */
import { pool, db } from "./db";
import { hexCells, hexAmbient, citationDaily, users } from "@shared/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  newGame,
  addPlayer,
  applyAction,
  legalActions,
  tick as coreTick,
  defaultConfig,
  type Action,
  type BoardHex,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerId,
} from "@shared/core";
import { getPipelineMeta } from "./storage";

const SINGLETON = "singleton";

function todayPT(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .split("T")[0];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// A DB user.id (number) maps to a core PlayerId (its string form).
export const pid = (userId: number): PlayerId => String(userId);

// ─── Persistence (single jsonb document) ────────────────────────────────────────

export async function ensureGameStateTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS game_state (
       id text PRIMARY KEY,
       state jsonb NOT NULL,
       updated_at timestamptz NOT NULL DEFAULT now()
     )`
  );
}

async function loadRawState(): Promise<GameState | null> {
  const { rows } = await pool.query(
    `SELECT state FROM game_state WHERE id = $1`,
    [SINGLETON]
  );
  return (rows[0]?.state as GameState) ?? null;
}

export async function saveState(state: GameState): Promise<void> {
  await pool.query(
    `INSERT INTO game_state (id, state, updated_at)
       VALUES ($1, $2, now())
     ON CONFLICT (id) DO UPDATE SET state = $2, updated_at = now()`,
    [SINGLETON, JSON.stringify(state)]
  );
}

// ─── Board + config (injected reference, rebuilt from the DB) ────────────────────

async function buildBoard(): Promise<Record<string, BoardHex>> {
  const rows = await db
    .select({ h3: hexCells.h3Index, wells: hexAmbient.oilWellCount })
    .from(hexCells)
    .leftJoin(hexAmbient, eq(hexCells.h3Index, hexAmbient.h3Index));
  const board: Record<string, BoardHex> = {};
  for (const r of rows) board[r.h3] = { wells: r.wells ?? 0 };
  return board;
}

function buildConfig(board: Record<string, BoardHex>, players: PlayerId[]): GameConfig {
  return defaultConfig(board, players);
}

// ─── First-run import: seed GameState from the current DB ownership ──────────────

async function initStateFromDb(config: GameConfig): Promise<GameState> {
  const seed = Math.floor(Math.random() * 2 ** 31);
  let state = newGame({ ...config, players: [] }, seed);

  // Players + their crude (the DB column was the old source of truth).
  const allUsers = await db
    .select({ id: users.id, crude: users.crude })
    .from(users);
  for (const u of allUsers) {
    state = addPlayer(state, config, pid(u.id));
    state.players[pid(u.id)].crude = u.crude;
  }

  // Existing territory.
  const owned = await db
    .select({
      h3: hexCells.h3Index,
      ownerId: hexCells.ownerId,
      upgradeLevel: hexCells.upgradeLevel,
      isExploited: hexCells.isExploited,
      degradation: hexCells.degradation,
    })
    .from(hexCells)
    .where(isNotNull(hexCells.ownerId));
  for (const h of owned) {
    if (h.ownerId == null) continue;
    state.hexes[h.h3] = {
      ownerId: pid(h.ownerId),
      upgradeLevel: h.upgradeLevel,
      exploited: h.isExploited,
      degradation: h.degradation,
    };
  }

  return state;
}

/** Load the canonical state, creating + importing it on first run. */
export async function getOrInitGame(): Promise<{ state: GameState; config: GameConfig }> {
  const board = await buildBoard();
  let state = await loadRawState();
  if (!state) {
    const config = buildConfig(board, []);
    state = await initStateFromDb(config);
    await saveState(state);
  }
  const config = buildConfig(board, Object.keys(state.players));

  // Hydrate older saves: contests map, Work Order balances, and the one-shot
  // currency rescale (crude → dollars, ×10) including the cached users column.
  let dirty = false;
  if (!state.contests) {
    state.contests = {};
    dirty = true;
  }
  for (const p of Object.values(state.players)) {
    if (p.workOrders === undefined) {
      p.workOrders = 1;
      dirty = true;
    }
  }
  if ((state.economyVersion ?? 1) < 2) {
    for (const p of Object.values(state.players)) p.crude = Math.round(p.crude * 10);
    state.economyVersion = 2;
    await pool.query(`UPDATE users SET crude = crude * 10`);
    dirty = true;
    console.log("[game] Economy v2: balances rescaled to dollars (×10).");
  }
  if (dirty) await saveState(state);

  return { state, config };
}

/** Ensure a logged-in user exists as a core player; persist if newly added. */
export async function ensurePlayer(
  state: GameState,
  config: GameConfig,
  userId: number
): Promise<GameState> {
  const id = pid(userId);
  if (state.players[id]) return state;
  const next = addPlayer(state, config, id);
  await saveState(next);
  return next;
}

// ─── Events (live pipeline data → injected GameEvents) ──────────────────────────

async function buildEvents(ownedH3: string[]): Promise<GameEvent[]> {
  if (ownedH3.length === 0) return [];
  const meta = await getPipelineMeta();
  const citWindow = Math.max(1, meta["citation_window_days"] ?? 1);
  const daWindow = Math.max(1, meta["dead_animal_window_days"] ?? 1);

  const cits = await db
    .select({ h3: citationDaily.h3Index, fine: citationDaily.totalFine })
    .from(citationDaily)
    .where(and(eq(citationDaily.date, todayPT()), inArray(citationDaily.h3Index, ownedH3)));

  const das = await db
    .select({ h3: hexAmbient.h3Index, dead: hexAmbient.deadAnimalCount })
    .from(hexAmbient)
    .where(inArray(hexAmbient.h3Index, ownedH3));

  const events: GameEvent[] = [];
  for (const c of cits) {
    // The purse: ticket dollars written in the hex, per day over the window.
    if (c.fine > 0) {
      events.push({ h3: c.h3, kind: "fine", magnitude: Math.round(c.fine / citWindow) });
    }
  }
  for (const d of das) {
    if (d.dead > 0) events.push({ h3: d.h3, kind: "deadAnimal", magnitude: d.dead / daWindow });
  }
  return events;
}

// ─── Public API used by routes / jobs ───────────────────────────────────────────

const ownedByPlayer = (state: GameState, id: PlayerId): string[] =>
  Object.keys(state.hexes).filter((h) => state.hexes[h].ownerId === id);

export interface ActionResult {
  ok: true;
  crude: number;
  workOrders: number;
}

/** Whether a user is out of Work Orders (the action currency). */
export async function outOfOrders(userId: number): Promise<boolean> {
  const { state } = await getOrInitGame();
  const p = state.players[pid(userId)];
  return !!p && (p.workOrders ?? 0) < 1;
}

/** Apply one core action for a user. Throws Error (message) on illegal moves. */
export async function doAction(userId: number, action: Action): Promise<ActionResult> {
  let { state, config } = await getOrInitGame();
  state = await ensurePlayer(state, config, userId);
  const id = pid(userId);

  const next = applyAction(state, config, id, action);
  await saveState(next);
  return { ok: true, crude: next.players[id].crude, workOrders: next.players[id].workOrders ?? 0 };
}

/** Whether a user can still take their daily action this tick. */
export async function getPlayerView(
  userId: number,
  displayName: string,
  avatarUrl: string | null
) {
  let { state, config } = await getOrInitGame();
  state = await ensurePlayer(state, config, userId);
  const id = pid(userId);
  const player = state.players[id];
  const hexIndexes = ownedByPlayer(state, id);

  return {
    id: userId,
    displayName,
    avatarUrl,
    crude: player.crude,
    totalHexes: hexIndexes.length,
    relics: player.relics,
    hexIndexes,
    workOrders: Math.floor(player.workOrders ?? 0),
    tickDate: todayPT(),
  };
}

/** Unowned hexes the player may expand into (for map highlighting). */
export async function getAdjacent(userId: number): Promise<string[]> {
  const { state, config } = await getOrInitGame();
  const id = pid(userId);
  if (!state.players[id] || ownedByPlayer(state, id).length === 0) return [];
  return legalActions(state, config, id)
    .filter((a): a is Extract<Action, { type: "expand" }> => a.type === "expand")
    .map((a) => a.h3);
}

/** The player's most recent overnight dispatch (the daily reveal). */
export async function getDispatch(userId: number) {
  const { state } = await getOrInitGame();
  const id = pid(userId);
  const report = state.lastReport;
  if (!report) return { tick: 0, gained: 0, entries: [] };
  const mine = report.perPlayer[id] ?? { gained: 0, entries: [] };
  return { tick: report.tick, gained: mine.gained, entries: mine.entries };
}

export interface MapHex {
  h3Index: string;
  ownerId: number | null;
  upgradeLevel: number;
  isExploited: boolean;
  degradation: number;
  lastTickYield: number;
  citationToday: number;
  fineDollarsPerDay: number;
  deadAnimalPerMonth: number;
  ownerName?: string;
  neighborhood: string | null;
  ambient: {
    oilWellCount: number;
    treeCount: number;
    deadAnimalCount: number;
    baseYieldPerTick: number;
  } | null;
  pendingContest: boolean;
}

/** Project board + ambient + live metrics + core ownership into the map payload. */
export async function projectMap(): Promise<MapHex[]> {
  const { state } = await getOrInitGame();
  const today = todayPT();
  const meta = await getPipelineMeta();
  const citWindow = Math.max(1, meta["citation_window_days"] ?? 1);
  const daWindow = Math.max(1, meta["dead_animal_window_days"] ?? 1);

  const rows = await db
    .select({
      h3Index: hexCells.h3Index,
      neighborhood: hexCells.neighborhood,
      oilWellCount: hexAmbient.oilWellCount,
      treeCount: hexAmbient.treeCount,
      deadAnimalCount: hexAmbient.deadAnimalCount,
      baseYieldPerTick: hexAmbient.baseYieldPerTick,
      citationToday: citationDaily.citationCount,
      totalFineToday: citationDaily.totalFine,
    })
    .from(hexCells)
    .leftJoin(hexAmbient, eq(hexCells.h3Index, hexAmbient.h3Index))
    .leftJoin(
      citationDaily,
      and(eq(hexCells.h3Index, citationDaily.h3Index), eq(citationDaily.date, today))
    );

  // Owner display names, keyed by core PlayerId.
  const userRows = await db.select({ id: users.id, displayName: users.displayName }).from(users);
  const names: Record<string, string> = {};
  for (const u of userRows) names[pid(u.id)] = u.displayName;

  const lastYield: Record<string, number> = {};
  if (state.lastReport) {
    for (const p of Object.values(state.lastReport.perPlayer)) {
      for (const e of p.entries) lastYield[e.h3] = e.finalYield;
    }
  }

  return rows.map((c) => {
    const hx = state.hexes[c.h3Index];
    const ownerId = hx?.ownerId ? Number(hx.ownerId) : null;
    return {
      h3Index: c.h3Index,
      ownerId,
      upgradeLevel: hx?.upgradeLevel ?? 0,
      isExploited: hx?.exploited ?? false,
      degradation: hx?.degradation ?? 0,
      lastTickYield: lastYield[c.h3Index] ?? 0,
      citationToday: c.citationToday ?? 0,
      fineDollarsPerDay: Math.round((c.totalFineToday ?? 0) / citWindow),
      // Monthly rate: res-9 cells are small enough that a daily rate rounds
      // to 0.0 for almost every cell.
      deadAnimalPerMonth: round1(((c.deadAnimalCount ?? 0) / daWindow) * 30),
      ownerName: hx?.ownerId ? names[hx.ownerId] : undefined,
      neighborhood: c.neighborhood,
      ambient:
        c.oilWellCount !== null
          ? {
              oilWellCount: c.oilWellCount ?? 0,
              treeCount: c.treeCount ?? 0,
              deadAnimalCount: c.deadAnimalCount ?? 0,
              baseYieldPerTick: c.baseYieldPerTick ?? 1,
            }
          : null,
      pendingContest: !!state.contests?.[c.h3Index],
    };
  });
}

export async function getLeaderboard() {
  const { state } = await getOrInitGame();
  const userRows = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users);

  return userRows
    .map((u) => {
      const p = state.players[pid(u.id)];
      return {
        id: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        crude: p?.crude ?? 0,
        totalHexes: ownedByPlayer(state, pid(u.id)).length,
      };
    })
    .sort((a, b) => b.totalHexes - a.totalHexes || b.crude - a.crude)
    .slice(0, 50);
}

export async function getStats() {
  const { state, config } = await getOrInitGame();
  return {
    users: Object.keys(state.players).length,
    hexes: Object.keys(config.board).length,
    ownedHexes: Object.values(state.hexes).filter((h) => h.ownerId).length,
    pendingContests: 0,
    tick: state.tick,
  };
}

/** Advance the world one day: build live events, run the core tick, persist. */
export async function runTick(): Promise<{ totalYield: number; cells: number }> {
  const { state, config } = await getOrInitGame();
  const owned = Object.keys(state.hexes).filter((h) => state.hexes[h].ownerId);
  const events = await buildEvents(owned);
  // The weekly free Work Order arrives with Monday's tick.
  const weeklyFree = new Date(`${todayPT()}T12:00:00Z`).getUTCDay() === 1;
  const next = coreTick(state, config, events, { weeklyFree });
  await saveState(next);

  let totalYield = 0;
  if (next.lastReport) {
    for (const p of Object.values(next.lastReport.perPlayer)) totalYield += p.gained;
  }
  return { totalYield, cells: owned.length };
}
