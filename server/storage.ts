/**
 * Data access layer. All DB queries live here.
 */
import { db } from "./db";
import {
  users,
  hexCells,
  hexAmbient,
  citationDaily,
  playerActions,
  contests,
  dailyTicks,
  type User,
  type HexCell,
  type HexAmbient,
  type HexWithDetails,
  type Contest,
} from "@shared/schema";
import {
  eq,
  and,
  sql,
  inArray,
  gte,
  lte,
  isNull,
  desc,
  asc,
  count,
  sum,
} from "drizzle-orm";
import { cellToParent, gridDisk } from "h3-js";

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUserById(id: number): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user ?? null;
}

export async function getUserByAuth0Id(auth0Id: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.auth0Id, auth0Id));
  return user ?? null;
}

export async function updateUserResources(
  userId: number,
  delta: number
): Promise<void> {
  await db
    .update(users)
    .set({ crude: sql`crude + ${delta}` })
    .where(eq(users.id, userId));
}

export async function updateUserHexCount(
  userId: number,
  delta: number
): Promise<void> {
  await db
    .update(users)
    .set({ totalHexes: sql`total_hexes + ${delta}` })
    .where(eq(users.id, userId));
}

export async function getLeaderboard(): Promise<
  { id: number; displayName: string; avatarUrl: string | null; crude: number; totalHexes: number }[]
> {
  return await db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      crude: users.crude,
      totalHexes: users.totalHexes,
    })
    .from(users)
    .orderBy(desc(users.totalHexes), desc(users.crude))
    .limit(50);
}

// ─── Hex Cells ────────────────────────────────────────────────────────────────

export async function getAllHexes(): Promise<HexWithDetails[]> {
  const cells = await db
    .select({
      h3Index: hexCells.h3Index,
      ownerId: hexCells.ownerId,
      claimedAt: hexCells.claimedAt,
      upgradeLevel: hexCells.upgradeLevel,
      isExploited: hexCells.isExploited,
      degradation: hexCells.degradation,
      neighborhood: hexCells.neighborhood,
      lastTickYield: hexCells.lastTickYield,
      oilWellCount: hexAmbient.oilWellCount,
      treeCount: hexAmbient.treeCount,
      baseYieldPerTick: hexAmbient.baseYieldPerTick,
      ownerName: users.displayName,
    })
    .from(hexCells)
    .leftJoin(hexAmbient, eq(hexCells.h3Index, hexAmbient.h3Index))
    .leftJoin(users, eq(hexCells.ownerId, users.id));

  return cells.map((c) => ({
    h3Index: c.h3Index,
    ownerId: c.ownerId,
    claimedAt: c.claimedAt,
    upgradeLevel: c.upgradeLevel,
    isExploited: c.isExploited,
    degradation: c.degradation,
    neighborhood: c.neighborhood,
    lastTickYield: c.lastTickYield,
    ambient: c.oilWellCount !== null
      ? {
          h3Index: c.h3Index,
          oilWellCount: c.oilWellCount ?? 0,
          treeCount: c.treeCount ?? 0,
          baseYieldPerTick: c.baseYieldPerTick ?? 1,
          updatedAt: new Date(),
        }
      : null,
    ownerName: c.ownerName ?? undefined,
  }));
}

export async function getHexByIndex(h3Index: string): Promise<HexCell | null> {
  const [hex] = await db
    .select()
    .from(hexCells)
    .where(eq(hexCells.h3Index, h3Index));
  return hex ?? null;
}

export async function getPlayerHexes(userId: number): Promise<string[]> {
  const rows = await db
    .select({ h3Index: hexCells.h3Index })
    .from(hexCells)
    .where(eq(hexCells.ownerId, userId));
  return rows.map((r) => r.h3Index);
}

export async function claimHex(
  h3Index: string,
  userId: number
): Promise<void> {
  await db
    .update(hexCells)
    .set({ ownerId: userId, claimedAt: new Date() })
    .where(eq(hexCells.h3Index, h3Index));
  await updateUserHexCount(userId, 1);
}

export async function transferHex(
  h3Index: string,
  fromUserId: number,
  toUserId: number
): Promise<void> {
  await db
    .update(hexCells)
    .set({ ownerId: toUserId, claimedAt: new Date() })
    .where(eq(hexCells.h3Index, h3Index));
  await updateUserHexCount(fromUserId, -1);
  await updateUserHexCount(toUserId, 1);
}

export async function upgradeHex(h3Index: string): Promise<void> {
  await db
    .update(hexCells)
    .set({ upgradeLevel: sql`upgrade_level + 1` })
    .where(
      and(eq(hexCells.h3Index, h3Index), sql`upgrade_level < 3`)
    );
}

export async function setHexExploited(h3Index: string, exploited: boolean): Promise<void> {
  await db
    .update(hexCells)
    .set({ isExploited: exploited })
    .where(eq(hexCells.h3Index, h3Index));
}

export async function degradeHex(h3Index: string, amount: number): Promise<void> {
  await db
    .update(hexCells)
    .set({ degradation: sql`LEAST(100, degradation + ${amount})` })
    .where(eq(hexCells.h3Index, h3Index));
}

export async function updateHexTickYield(
  h3Index: string,
  yield_: number
): Promise<void> {
  await db
    .update(hexCells)
    .set({ lastTickYield: yield_ })
    .where(eq(hexCells.h3Index, h3Index));
}

export async function getAdjacentUnownedHexes(
  userId: number
): Promise<string[]> {
  const myHexes = await getPlayerHexes(userId);
  if (myHexes.length === 0) return [];

  const neighborSet = new Set<string>();
  for (const h of myHexes) {
    const neighbors = gridDisk(h, 1).filter((n: string) => n !== h);
    for (const n of neighbors) neighborSet.add(n);
  }
  // Remove hexes the player already owns
  const candidates = [...neighborSet].filter((h) => !myHexes.includes(h));
  if (candidates.length === 0) return [];

  const rows = await db
    .select({ h3Index: hexCells.h3Index })
    .from(hexCells)
    .where(
      and(inArray(hexCells.h3Index, candidates), isNull(hexCells.ownerId))
    );
  return rows.map((r) => r.h3Index);
}

export async function isAdjacentToPlayer(
  h3Index: string,
  userId: number
): Promise<boolean> {
  const neighbors = gridDisk(h3Index, 1).filter((n: string) => n !== h3Index);
  if (neighbors.length === 0) return false;
  const rows = await db
    .select({ h3Index: hexCells.h3Index })
    .from(hexCells)
    .where(
      and(inArray(hexCells.h3Index, neighbors), eq(hexCells.ownerId, userId))
    );
  return rows.length > 0;
}

// ─── Citation Data ─────────────────────────────────────────────────────────────

export async function getCitationScore(
  h3Indexes: string[],
  from: Date,
  to: Date
): Promise<number> {
  if (h3Indexes.length === 0) return 0;
  const fromDate = from.toISOString().split("T")[0];
  const toDate = to.toISOString().split("T")[0];
  const result = await db
    .select({ total: sum(citationDaily.citationCount) })
    .from(citationDaily)
    .where(
      and(
        inArray(citationDaily.h3Index, h3Indexes),
        gte(citationDaily.date, fromDate),
        lte(citationDaily.date, toDate)
      )
    );
  return Number(result[0]?.total ?? 0);
}

export async function getCitationHotspots(
  dateStr: string,
  limit = 20
): Promise<{ h3Index: string; citationCount: number }[]> {
  return await db
    .select({ h3Index: citationDaily.h3Index, citationCount: citationDaily.citationCount })
    .from(citationDaily)
    .where(eq(citationDaily.date, dateStr))
    .orderBy(desc(citationDaily.citationCount))
    .limit(limit);
}

// ─── Player Actions ────────────────────────────────────────────────────────────

export async function getTodayAction(
  userId: number,
  tickDate: string
): Promise<{ actionType: string; h3Index: string } | null> {
  const [action] = await db
    .select({ actionType: playerActions.actionType, h3Index: playerActions.h3Index })
    .from(playerActions)
    .where(
      and(
        eq(playerActions.userId, userId),
        eq(playerActions.tickDate, tickDate)
      )
    );
  return action ?? null;
}

export async function logPlayerAction(
  userId: number,
  actionType: "claim" | "upgrade" | "exploit" | "fortify" | "raid",
  h3Index: string,
  tickDate: string,
  resourceCost: number,
  resourceGain: number,
  metadata?: object
): Promise<void> {
  await db.insert(playerActions).values({
    userId,
    actionType,
    h3Index,
    tickDate,
    resourceCost,
    resourceGain,
    metadata: metadata ? JSON.stringify(metadata) : undefined,
  });
}

// ─── Contests ─────────────────────────────────────────────────────────────────

export async function createContest(
  h3Index: string,
  challengerId: number,
  defenderId: number
): Promise<Contest> {
  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setHours(23, 59, 59, 999); // end of today PT
  const [contest] = await db
    .insert(contests)
    .values({
      h3Index,
      challengerId,
      defenderId,
      status: "pending",
      windowStart: now,
      windowEnd,
    })
    .returning();
  return contest;
}

export async function getPendingContests(): Promise<Contest[]> {
  return await db
    .select()
    .from(contests)
    .where(eq(contests.status, "pending"));
}

export async function resolveContest(
  contestId: number,
  challengerScore: number,
  defenderScore: number,
  winnerId: number
): Promise<void> {
  await db
    .update(contests)
    .set({
      status: "resolved",
      challengerScore,
      defenderScore,
      winnerId,
      resolvedAt: new Date(),
    })
    .where(eq(contests.id, contestId));
}

export async function hasPendingContest(h3Index: string): Promise<boolean> {
  const [row] = await db
    .select({ id: contests.id })
    .from(contests)
    .where(and(eq(contests.h3Index, h3Index), eq(contests.status, "pending")));
  return !!row;
}

// ─── Daily Ticks ─────────────────────────────────────────────────────────────

export async function getLastTick(): Promise<{ tickDate: string } | null> {
  const [row] = await db
    .select({ tickDate: dailyTicks.tickDate })
    .from(dailyTicks)
    .orderBy(desc(dailyTicks.ranAt))
    .limit(1);
  return row ?? null;
}

export async function recordTick(
  tickDate: string,
  cellsProcessed: number,
  totalYield: number,
  contestsResolved: number
): Promise<void> {
  await db.insert(dailyTicks).values({
    tickDate,
    cellsProcessed,
    totalYieldDistributed: totalYield,
    contestsResolved,
  });
}

// ─── Hex Ambient ──────────────────────────────────────────────────────────────

export async function upsertHexAmbient(
  h3Index: string,
  oilWellCount: number,
  treeCount: number
): Promise<void> {
  const baseYield = Math.max(1, oilWellCount * 3 + Math.floor(treeCount * 0.5));
  await db
    .insert(hexAmbient)
    .values({ h3Index, oilWellCount, treeCount, baseYieldPerTick: baseYield })
    .onConflictDoUpdate({
      target: hexAmbient.h3Index,
      set: {
        oilWellCount,
        treeCount,
        baseYieldPerTick: baseYield,
        updatedAt: new Date(),
      },
    });
}

export async function upsertCitationDaily(
  h3Index: string,
  date: string,
  citationCount: number,
  totalFine: number,
  uniqueMakes: number
): Promise<void> {
  await db
    .insert(citationDaily)
    .values({ h3Index, date, citationCount, totalFine, uniqueMakes })
    .onConflictDoNothing();
}

// ─── Hex cell bulk insert (init script) ──────────────────────────────────────

export async function upsertHexCell(h3Index: string, neighborhood?: string): Promise<void> {
  await db
    .insert(hexCells)
    .values({ h3Index, neighborhood })
    .onConflictDoNothing();
}
