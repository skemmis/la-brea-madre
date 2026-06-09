/**
 * Integration test for the exchange: standing board → buy → end the day →
 * clock advances. DB-gated; skips without DATABASE_URL.
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("exchange (integration)", () => {
  let ex: typeof import("./exchangeService");
  let storage: typeof import("./storage");
  let db: typeof import("./db").db;
  let pool: typeof import("./db").pool;
  let schema: typeof import("@shared/schema");

  const isoDay = (offset: number) => {
    const d = new Date("2024-01-01T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  before(async () => {
    ex = await import("./exchangeService");
    storage = await import("./storage");
    ({ db, pool } = await import("./db"));
    schema = await import("@shared/schema");

    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: "./migrations" });
    const { ensureGameStateTable } = await import("./gameService");
    const { ensureExchangeTables } = await import("./dataPipeline");
    await ensureGameStateTable();
    await ensureExchangeTables();
    await ex.ensureExchangeRuntime();
  });

  async function makeUser(crude: number) {
    const [u] = await db
      .insert(schema.users)
      .values({ auth0Id: "auth|x", email: "x@example.com", displayName: "Xan", crude })
      .returning();
    return u;
  }

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE game_state, game_clock, exchange_round, daily_metric, users RESTART IDENTITY CASCADE`
    );
    // 40 days of rising citations + fines so the eligible target resolves YES.
    for (let i = 0; i < 40; i++) {
      await storage.upsertMetricDay("citations", isoDay(i), 1000 + i * 10);
      await storage.upsertMetricDay("fines", isoDay(i), 100000 + i * 1000);
    }
  });

  it("opens a board of YES/NO markets for the current day", async () => {
    const board = await ex.getBoard();
    assert.ok(board.day, "a day is set");
    assert.ok(board.markets.length >= 2, "fines + citations markets");
    for (const m of board.markets) {
      assert.deepEqual(m.outcomes, ["YES", "NO"]);
      assert.ok(Math.abs(m.prices.reduce((a, b) => a + b, 0) - 1) < 1e-6);
      assert.ok(m.id.endsWith(`-${board.day}`));
    }
  });

  it("buying shows up as a position and spends crude", async () => {
    const u = await makeUser(1000);
    const board = await ex.getBoard();
    const fines = board.markets.find((m) => m.id.startsWith("fines-"))!;

    const r = await ex.buy(u.id, fines.id, 0, 50); // YES on fines
    assert.ok(r.crude < 1000);
    const positions = await ex.getPositions(u.id);
    assert.equal(positions.length, 1);
    assert.ok(positions[0].shares[0] > 0);
  });

  it("ending the day settles markets and advances the clock", async () => {
    const u = await makeUser(1000);
    const board = await ex.getBoard();
    const day = board.day!;
    const fines = board.markets.find((m) => m.id.startsWith("fines-"))!;
    const afterBuy = (await ex.buy(u.id, fines.id, 0, 100)).crude; // YES (rising → wins)

    const end = await ex.endDay();
    assert.equal(end.day, day);
    assert.ok(end.results.length >= 2);
    const finesResult = end.results.find((r) => r.type === "fines")!;
    assert.equal(finesResult.outcome, "YES");
    assert.ok(finesResult.settlement!.perPlayer[String(u.id)].payout > 0);
    assert.ok(end.nextDay && end.nextDay > day, "clock advanced");

    // The winner's crude grew vs. right after betting.
    const me = await (await import("./gameService")).getPlayerView(u.id, "Xan", null);
    assert.ok(me.crude > afterBuy);

    // A fresh board now shows the next day's markets.
    const board2 = await ex.getBoard();
    assert.equal(board2.day, end.nextDay);
    assert.ok(board2.markets.every((m) => m.id.endsWith(`-${end.nextDay}`)));
  });
});
