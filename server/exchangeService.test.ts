/**
 * Integration test for the live exchange: today's board opens from trailing
 * history → trades journal to the tape → yesterday's markets settle when the
 * records land. DB-gated; skips without DATABASE_URL.
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("exchange (integration)", () => {
  let ex: typeof import("./exchangeService");
  let storage: typeof import("./storage");
  let core: typeof import("@shared/core");
  let game: typeof import("./gameService");
  let db: typeof import("./db").db;
  let pool: typeof import("./db").pool;
  let schema: typeof import("@shared/schema");

  const todayPT = () =>
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }).split("T")[0];

  /** YYYY-MM-DD for `offset` days before today (PT). */
  const dayAgo = (offset: number) => {
    const d = new Date(`${todayPT()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  };

  before(async () => {
    ex = await import("./exchangeService");
    storage = await import("./storage");
    core = await import("@shared/core");
    game = await import("./gameService");
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
      `TRUNCATE game_state, game_clock, exchange_round, exchange_trade, exchange_payout,
               daily_metric, users RESTART IDENTITY CASCADE`
    );
    // 45 days of rising series ending TODAY, so the live builders have a
    // trailing window and yesterday's records read as "arrived".
    for (let i = 45; i >= 0; i--) {
      const d = dayAgo(i);
      const v = 1000 + (45 - i) * 10;
      await storage.upsertMetricDay("citations", d, v);
      await storage.upsertMetricDay("fines", d, v * 100);
      await storage.upsertMetricDay("dead_animals", d, 100 + (45 - i));
      await storage.upsertMetricDay("viol:SWEEP", d, 400 + (45 - i));
    }
  });

  it("opens today's board with YES/NO markets in 'trading' state", async () => {
    const board = await ex.getBoard();
    assert.equal(board.day, todayPT());
    assert.ok(board.markets.length >= 4, "staples are on the board");
    for (const m of board.markets) {
      assert.deepEqual(m.outcomes, ["YES", "NO"]);
      assert.ok(Math.abs(m.prices.reduce((a, b) => a + b, 0) - 1) < 1e-6);
      assert.equal(m.state, "trading");
      assert.equal(m.targetDate, board.day);
    }
  });

  it("buys and sells journal to the tape and move crude", async () => {
    const u = await makeUser(1000);
    const board = await ex.getBoard();
    const fines = board.markets.find((m) => m.id.startsWith("fines-"))!;

    const bought = await ex.buy(u.id, fines.id, 0, 50);
    assert.ok(bought.crude < 1000);
    assert.ok(bought.shares > 0);

    const pf = await ex.getPortfolio(u.id);
    assert.equal(pf.open.length, 1);
    assert.ok(pf.open[0].shares[0] > 0);
    assert.ok(pf.stats.volume > 0);

    const tape = await ex.getActivity();
    assert.equal(tape[0].user, "Xan");
    assert.equal(tape[0].action, "buy");

    const sold = await ex.sell(u.id, fines.id, 0, bought.shares / 2);
    assert.ok(sold.crude > bought.crude, "selling refunds crude");
    const tape2 = await ex.getActivity();
    assert.equal(tape2[0].action, "sell");
  });

  it("settles yesterday's market from the arrived records", async () => {
    const u = await makeUser(1000);
    const yday = dayAgo(1);
    const id = `citations-${yday}`;

    // Stand up yesterday's market directly (it opened before "today").
    let { state, config } = await game.getOrInitGame();
    state = await game.ensurePlayer(state, config, u.id);
    state = core.openMarket(state, config, {
      id,
      question: "Will the city write more than 1,200 parking tickets today?",
      outcomes: ["YES", "NO"],
      baseRates: [0.5, 0.5],
    });
    // Actual yesterday = 1440 (rising series) > line 1200 → YES.
    const shares = core.sharesForBudget(state.markets![id], 0, 100);
    state = core.buyContracts(state, config, game.pid(u.id), id, 0, shares);
    await game.saveState(state);
    await pool.query(
      `INSERT INTO exchange_round
         (market_id, market_type, target_date, line, kind, category, metric_a, question, rules, base_rate_yes)
       VALUES ($1,'citations',$2,1200,'overunder','totals','citations','q','r',0.5)`,
      [id, yday]
    );

    // Trading is closed for yesterday's paper.
    await assert.rejects(() => ex.buy(u.id, id, 0, 10), /closed/i);

    const settled = await ex.settleDue();
    const mine = settled.find((s) => s.marketId === id)!;
    assert.equal(mine.outcome, "YES");
    assert.ok(mine.actualA > 1200);

    const pf = await ex.getPortfolio(u.id);
    assert.equal(pf.history.length, 1);
    assert.equal(pf.history[0].won, true);
    assert.ok(pf.history[0].payout > 0);
    assert.ok(pf.equity.length === 1 && pf.equity[0].realized > 0);

    const profile = await ex.getPublicProfile(u.id);
    assert.equal(profile.market.settledMarkets, 1);
    assert.equal(profile.market.wins, 1);
  });
});
