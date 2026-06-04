/**
 * Integration test for the generic daily-metric store. DB-gated.
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("daily metric store (integration)", () => {
  let storage: typeof import("./storage");
  let pool: typeof import("./db").pool;
  let ensureExchangeTables: typeof import("./dataPipeline").ensureExchangeTables;

  before(async () => {
    storage = await import("./storage");
    ({ pool } = await import("./db"));
    ({ ensureExchangeTables } = await import("./dataPipeline"));
    await ensureExchangeTables();
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE daily_metric`);
  });

  it("upserts a series and reads it back oldest → newest", async () => {
    await storage.upsertMetricDays("fines", [
      { date: "2024-03-02", value: 200 },
      { date: "2024-03-01", value: 100 },
    ]);
    const series = await storage.getMetricSeries("fines");
    assert.deepEqual(series.map((p) => p.date), ["2024-03-01", "2024-03-02"]);
    assert.equal(series[1].value, 200);
  });

  it("keeps metrics separate and lists their names", async () => {
    await storage.upsertMetricDay("fines", "2024-03-01", 100);
    await storage.upsertMetricDay("dead_animals", "2024-03-01", 7);
    assert.equal((await storage.getMetricSeries("dead_animals"))[0].value, 7);
    const names = (await storage.getMetricNames()).sort();
    assert.deepEqual(names, ["dead_animals", "fines"]);
  });

  it("upsert overwrites an existing (metric, day)", async () => {
    await storage.upsertMetricDay("fines", "2024-03-01", 100);
    await storage.upsertMetricDay("fines", "2024-03-01", 999);
    const series = await storage.getMetricSeries("fines");
    assert.equal(series.length, 1);
    assert.equal(series[0].value, 999);
  });
});
