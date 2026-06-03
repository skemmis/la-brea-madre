/**
 * Scheduled background jobs:
 * - Daily tick at 11:59 PM PT: yield distribution + contest resolution
 * - Data pipeline: hourly citation pull
 */
import cron from "node-cron";
import { db } from "./db";
import { hexCells, hexAmbient, users } from "@shared/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import {
  getPendingContests,
  resolveContest,
  transferHex,
  getPlayerHexes,
  getCitationScore,
  recordTick,
  updateHexTickYield,
  getLastTick,
} from "./storage";
import { runCitationPipeline } from "./dataPipeline";

const EXPLOIT_YIELD_MULTIPLIER = 2;
const EXPLOIT_DEGRADATION_PER_TICK = 20; // 5 exploits = depleted
const UPGRADE_YIELD_BONUS = [0, 0.5, 1.0, 1.5]; // level → multiplier bonus

function ptMidnightCron() {
  // "0 59 23 * * *" in America/Los_Angeles via TZ env
  return "59 23 * * *";
}

function todayPT(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .split("T")[0];
}

// ─── Daily Tick ───────────────────────────────────────────────────────────────

export async function runDailyTick(): Promise<void> {
  const tickDate = todayPT();
  const lastTick = await getLastTick();

  if (lastTick?.tickDate === tickDate) {
    console.log(`[tick] Already ran for ${tickDate}, skipping.`);
    return;
  }

  console.log(`[tick] Running daily tick for ${tickDate}...`);
  const t = Date.now();

  // 1. Fetch all owned hexes with their ambient data
  const ownedHexes = await db
    .select({
      h3Index: hexCells.h3Index,
      ownerId: hexCells.ownerId,
      upgradeLevel: hexCells.upgradeLevel,
      isExploited: hexCells.isExploited,
      degradation: hexCells.degradation,
      baseYield: hexAmbient.baseYieldPerTick,
    })
    .from(hexCells)
    .leftJoin(hexAmbient, eq(hexCells.h3Index, hexAmbient.h3Index))
    .where(isNotNull(hexCells.ownerId));

  // 2. Get yesterday's citation scores for all hex indexes
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dayBefore = new Date(yesterday);
  dayBefore.setDate(dayBefore.getDate() - 1);

  // Group hexes by owner for batch score lookup
  const ownerHexes = new Map<number, string[]>();
  for (const hex of ownedHexes) {
    if (!hex.ownerId) continue;
    if (!ownerHexes.has(hex.ownerId)) ownerHexes.set(hex.ownerId, []);
    ownerHexes.get(hex.ownerId)!.push(hex.h3Index);
  }

  // 3. Distribute yields
  let totalYield = 0;
  const userYields = new Map<number, number>();

  for (const hex of ownedHexes) {
    if (!hex.ownerId) continue;
    if (hex.degradation >= 100) {
      await updateHexTickYield(hex.h3Index, 0);
      continue;
    }

    const base = hex.baseYield ?? 1;
    const upgradeMult = 1 + (UPGRADE_YIELD_BONUS[hex.upgradeLevel] ?? 0);
    const degradeFactor = 1 - hex.degradation / 100;
    const exploitMult = hex.isExploited ? EXPLOIT_YIELD_MULTIPLIER : 1;

    let yield_ = Math.floor(base * upgradeMult * degradeFactor * exploitMult);
    yield_ = Math.max(0, yield_);

    await updateHexTickYield(hex.h3Index, yield_);

    if (hex.isExploited) {
      await db
        .update(hexCells)
        .set({ degradation: sql`LEAST(100, degradation + ${EXPLOIT_DEGRADATION_PER_TICK})` })
        .where(eq(hexCells.h3Index, hex.h3Index));
    }

    userYields.set(hex.ownerId, (userYields.get(hex.ownerId) ?? 0) + yield_);
    totalYield += yield_;
  }

  // Batch credit users
  for (const [userId, amount] of userYields.entries()) {
    await db
      .update(users)
      .set({ crude: sql`crude + ${amount}` })
      .where(eq(users.id, userId));
  }

  // 4. Resolve pending contests
  const pendingContests = await getPendingContests();
  let contestsResolved = 0;

  for (const contest of pendingContests) {
    const windowStart = contest.windowStart;
    const windowEnd = contest.windowEnd ?? new Date();

    const challengerHexes = await getPlayerHexes(contest.challengerId);
    const defenderHexes = await getPlayerHexes(contest.defenderId);

    const [challengerScore, defenderScore] = await Promise.all([
      getCitationScore(challengerHexes, windowStart, windowEnd),
      getCitationScore(defenderHexes, windowStart, windowEnd),
    ]);

    const winnerId =
      challengerScore >= defenderScore ? contest.challengerId : contest.defenderId;

    await resolveContest(contest.id, challengerScore, defenderScore, winnerId);

    if (winnerId === contest.challengerId) {
      // Challenger wins: transfer the hex
      await transferHex(contest.h3Index, contest.defenderId, contest.challengerId);
      // Refund contest cost to challenger
      await db
        .update(users)
        .set({ crude: sql`crude + 15` })
        .where(eq(users.id, contest.challengerId));
    }
    // Defender wins: hex stays, challenger loses their staked resources

    contestsResolved++;
  }

  await recordTick(tickDate, ownedHexes.length, totalYield, contestsResolved);

  console.log(
    `[tick] Complete in ${Date.now() - t}ms — hexes: ${ownedHexes.length}, yield: ${totalYield}, contests: ${contestsResolved}`
  );
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export function startBackgroundJobs() {
  process.env.TZ = "America/Los_Angeles";

  // Daily tick at 11:59 PM PT
  cron.schedule(ptMidnightCron(), async () => {
    try {
      await runDailyTick();
    } catch (err) {
      console.error("[tick] Error:", err);
    }
  });

  // Citation pipeline every 6 hours
  cron.schedule("0 */6 * * *", async () => {
    try {
      console.log("[pipeline] Hourly citation pull...");
      await runCitationPipeline(1);
    } catch (err) {
      console.error("[pipeline] Error:", err);
    }
  });

  console.log("[jobs] Background jobs scheduled.");
}
