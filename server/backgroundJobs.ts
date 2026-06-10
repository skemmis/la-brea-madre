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
import {
  runCitationPipeline,
  runCitationHistory,
  runMakeHistory,
  runNeighborhoodHistory,
  runDeadAnimalCensus,
} from "./dataPipeline";
import { rollExchangeDay, settleDue } from "./exchangeService";
import { getMetricSeries } from "./storage";

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

  // Exchange day roll just after midnight PT: yesterday's board closes by
  // definition (trading is gated on the target date); open today's slate and
  // settle anything whose records have arrived.
  cron.schedule("5 0 * * *", async () => {
    try {
      const r = await rollExchangeDay();
      console.log(`[exchange] Rolled to ${r.day}; settled ${r.settled} market(s).`);
    } catch (err) {
      console.error("[exchange] Roll error:", err);
    }
  });

  // Citation pipeline every 6 hours (live map snapshot), then settle — the
  // city's records arrive on their own schedule, not ours.
  cron.schedule("0 */6 * * *", async () => {
    try {
      console.log("[pipeline] Citation pull...");
      await runCitationPipeline(1);
      const settled = await settleDue();
      if (settled.length) console.log(`[exchange] Settled ${settled.length} market(s).`);
    } catch (err) {
      console.error("[pipeline] Error:", err);
    }
  });

  // Historical daily series for the prediction markets — refresh once a day,
  // then settle whatever the fresh series make decidable.
  cron.schedule("30 2 * * *", async () => {
    try {
      console.log("[pipeline] Market history refresh...");
      await runCitationHistory();
      await runMakeHistory();
      await runNeighborhoodHistory();
      await runDeadAnimalCensus();
      const settled = await settleDue();
      if (settled.length) console.log(`[exchange] Settled ${settled.length} market(s).`);
    } catch (err) {
      console.error("[pipeline] History error:", err);
    }
  });

  // One shot shortly after boot: if the cohort series are missing (first
  // deploy of the live floor), backfill them so today's board can open in
  // full; then roll the exchange day — which also settles any legacy
  // replay-era rounds whose outcomes were already known.
  setTimeout(async () => {
    try {
      const probe = await getMetricSeries("color:BK");
      if (probe.length < 60) {
        console.log("[exchange] Cohort series missing — backfilling history...");
        await runCitationHistory();
        await runMakeHistory();
        await runDeadAnimalCensus();
      }
      const hoodProbe = await getMetricSeries("hoodcit:VENICE");
      if (hoodProbe.length < 60) {
        console.log("[exchange] Neighborhood series missing — backfilling...");
        await runNeighborhoodHistory();
      }
      const r = await rollExchangeDay();
      console.log(`[exchange] Boot roll: day ${r.day}, settled ${r.settled}.`);
    } catch (err) {
      console.error("[exchange] Boot backfill error:", err);
    }
  }, 5_000);

  console.log("[jobs] Background jobs scheduled.");
}
