/**
 * Integration test for the citation history store. DB-gated: skips cleanly
 * when no DATABASE_URL is set (CI provides a throwaway Postgres).
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("citation market store (integration)", () => {
  let storage: typeof import("./storage");
  let pool: typeof import("./db").pool;
  let ensureMarketDataTable: typeof import("./dataPipeline").ensureMarketDataTable;

  before(async () => {
    storage = await import("./storage");
    ({ pool } = await import("./db"));
    ({ ensureMarketDataTable } = await import("./dataPipeline"));
    await ensureMarketDataTable();
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE citation_market_daily`);
  });

  it("upserts daily rows and reads them back oldest → newest", async () => {
    await storage.upsertCitationMarketDay("2024-03-02", 200, 12345);
    await storage.upsertCitationMarketDay("2024-03-01", 180, 9999);

    const days = await storage.getCitationMarketDays();
    assert.deepEqual(days.map((d) => d.date), ["2024-03-01", "2024-03-02"]);
    assert.equal(days[1].totalFine, 12345);
  });

  it("upsert overwrites an existing day", async () => {
    await storage.upsertCitationMarketDay("2024-03-01", 180, 9999);
    await storage.upsertCitationMarketDay("2024-03-01", 999, 55555);

    const days = await storage.getCitationMarketDays();
    assert.equal(days.length, 1);
    assert.equal(days[0].citationCount, 999);
    assert.equal(days[0].totalFine, 55555);
  });
});
