/**
 * Scheduled background jobs:
 * - Daily tick at 11:59 PM PT: advance the core world one day.
 * - Data pipeline: periodic citation pull.
 *
 * The tick itself is pure game logic (shared/core); this file only handles
 * scheduling, per-day idempotency, and persistence via gameService.
 */
import cron from "node-cron";
import { recordTick, getLastTick } from "./storage";
import { runTick } from "./gameService";
import { runCitationPipeline } from "./dataPipeline";

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

  const { totalYield, cells } = await runTick();
  await recordTick(tickDate, cells, totalYield, 0);

  console.log(
    `[tick] Complete in ${Date.now() - t}ms — hexes: ${cells}, yield: ${totalYield}`
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
