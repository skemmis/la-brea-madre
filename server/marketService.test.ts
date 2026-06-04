/**
 * Integration test for the prediction-market round flow: deal → buy → reveal.
 * DB-gated; skips when no DATABASE_URL (CI provides a throwaway Postgres).
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("market service (integration)", () => {
  let ms: typeof import("./marketService");
  let storage: typeof import("./storage");
  let db: typeof import("./db").db;
  let pool: typeof import("./db").pool;
  let schema: typeof import("@shared/schema");

  before(async () => {
    ms = await import("./marketService");
    storage = await import("./storage");
    ({ db, pool } = await import("./db"));
    schema = await import("@shared/schema");

    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: "./migrations" });
    const { ensureGameStateTable } = await import("./gameService");
    const { ensureMarketDataTable } = await import("./dataPipeline");
    await ensureGameStateTable();
    await ensureMarketDataTable();
    await ms.ensureMarketRoundTable();
  });

  async function makeUser(crude: number) {
    const [u] = await db
      .insert(schema.users)
      .values({ auth0Id: "auth|p", email: "p@example.com", displayName: "Pat", crude })
      .returning();
    return u;
  }

  const isoDay = (offset: number) => {
    const d = new Date("2024-01-01T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  beforeEach(async () => {
    await pool.query(`TRUNCATE game_state, market_round, citation_market_daily, users RESTART IDENTITY CASCADE`);
    // 40 days of rising fines so any eligible target resolves OVER (its value
    // always tops its lower trailing window).
    for (let i = 0; i < 40; i++) {
      await storage.upsertCitationMarketDay(isoDay(i), 100 + i, 1000 + i * 10);
    }
  });

  it("deals a market with two priced outcomes", async () => {
    const market = await ms.openRound();
    assert.equal(market.outcomes.length, 2);
    assert.equal(market.status, "open");
    const sum = market.prices.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, "prices sum to 1");
  });

  it("buying spends crude, moves the price, and shows up as a position", async () => {
    const u = await makeUser(1000);
    const market = await ms.openRound();
    const beforeOver = market.prices[0];

    const result = await ms.buy(u.id, market.id, 0, 50); // 50 crude on OVER
    assert.ok(result.crude < 1000, "crude spent");
    assert.ok(result.shares > 0);
    assert.ok(result.market.prices[0] > beforeOver, "OVER price rose");

    const positions = await ms.getPositions(u.id);
    assert.equal(positions.length, 1);
    assert.ok(positions[0].shares[0] > 0);
  });

  it("revealing settles the market and pays the winning side", async () => {
    const u = await makeUser(1000);
    const market = await ms.openRound();
    const buy = await ms.buy(u.id, market.id, 0, 100); // bet OVER (the rising series wins OVER)
    const crudeAfterBuy = buy.crude;

    const reveal = await ms.reveal(market.id);
    assert.equal(reveal.outcome, "OVER");
    assert.ok(reveal.actualFine > reveal.line);
    assert.equal(reveal.settlement!.perPlayer[String(u.id)].payout > 0, true);

    // Winner ends with more crude than right after betting.
    const me = await (await import("./gameService")).getPlayerView(u.id, "Pat", null);
    assert.ok(me.crude > crudeAfterBuy, "payout credited");

    // No open markets, and a second reveal is rejected.
    assert.deepEqual(await ms.listMarkets(), []);
    await assert.rejects(() => ms.reveal(market.id));
  });

  it("refuses to deal when there isn't enough history", async () => {
    await pool.query(`TRUNCATE citation_market_daily`);
    for (let i = 0; i < 5; i++) {
      await storage.upsertCitationMarketDay(`2024-05-0${i + 1}`, 100, 5000);
    }
    await assert.rejects(() => ms.openRound());
  });
});
