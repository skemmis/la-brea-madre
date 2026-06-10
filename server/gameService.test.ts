/**
 * Integration tests for the game service — the shell that wires the core to
 * the database. These exercise real Postgres (via DATABASE_URL); when no
 * database is configured they are skipped, so `npm test` still runs the pure
 * core tests anywhere. CI provides a throwaway Postgres so these always run.
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { latLngToCell, gridDisk } from "h3-js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("gameService (integration)", () => {
  // Loaded dynamically so importing this file never touches the DB when skipped.
  let gs: typeof import("./gameService");
  let db: typeof import("./db").db;
  let pool: typeof import("./db").pool;
  let schema: typeof import("@shared/schema");
  let eq: typeof import("drizzle-orm").eq;

  const CENTER = latLngToCell(34.05, -118.24, 7);
  const RING = gridDisk(CENTER, 1);

  before(async () => {
    gs = await import("./gameService");
    ({ db, pool } = await import("./db"));
    schema = await import("@shared/schema");
    ({ eq } = await import("drizzle-orm"));

    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: "./migrations" });
    await gs.ensureGameStateTable();
  });

  beforeEach(async () => {
    // Isolate every test: wipe state + reseed a tiny board.
    await pool.query(
      `TRUNCATE game_state, daily_ticks, citation_daily, hex_cells, hex_ambient, users RESTART IDENTITY CASCADE`
    );
    await db.insert(schema.hexCells).values(RING.map((h) => ({ h3Index: h })));
    await db
      .insert(schema.hexAmbient)
      .values({ h3Index: CENTER, oilWellCount: 2, baseYieldPerTick: 6 });
  });

  async function makeUser(displayName: string, crude: number) {
    const [u] = await db
      .insert(schema.users)
      .values({
        auth0Id: `auth|${displayName}`,
        email: `${displayName}@example.com`,
        displayName,
        crude,
      })
      .returning();
    return u;
  }

  it("imports existing DB ownership + crude on first run", async () => {
    const u = await makeUser("Ada", 123);
    await db
      .update(schema.hexCells)
      .set({ ownerId: u.id, upgradeLevel: 1 })
      .where(eq(schema.hexCells.h3Index, CENTER));

    const view = await gs.getPlayerView(u.id, "Ada", null);
    assert.equal(view.crude, 1230, "imported balances rescale to dollars (×10)");
    assert.deepEqual(view.hexIndexes, [CENTER]);

    const map = await gs.projectMap();
    const cell = map.find((m) => m.h3Index === CENTER)!;
    assert.equal(cell.ownerId, u.id);
    assert.equal(cell.upgradeLevel, 1);
    assert.equal(cell.ownerName, "Ada");
  });

  it("claims spend Work Orders; the first hex is free money-wise", async () => {
    const u = await makeUser("Bo", 50);

    await gs.doAction(u.id, { type: "expand", h3: CENTER });

    const view = await gs.getPlayerView(u.id, "Bo", null);
    assert.equal(view.crude, 500, "first claim is free (and $-rescaled)");
    assert.deepEqual(view.hexIndexes, [CENTER]);
    assert.equal(view.workOrders, 1, "one of two starting orders spent");
    assert.equal(await gs.outOfOrders(u.id), false);

    // A second order is available; the third action runs dry.
    const next = RING.find((h) => h !== CENTER)!;
    await gs.doAction(u.id, { type: "expand", h3: next });
    assert.equal(await gs.outOfOrders(u.id), true);
    const third = RING.find((h) => h !== CENTER && h !== next)!;
    await assert.rejects(() => gs.doAction(u.id, { type: "expand", h3: third }));
  });

  it("runTick pays ticket dollars and records a dispatch", async () => {
    const u = await makeUser("Cy", 50);
    await gs.doAction(u.id, { type: "expand", h3: CENTER });

    // The city wrote $730 of tickets in the hex today.
    await db.insert(schema.citationDaily).values({
      h3Index: CENTER,
      date: new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
      citationCount: 10,
      totalFine: 730,
    });

    const result = await gs.runTick();
    assert.ok(result.totalYield >= 730, "tick should pay the hex's ticket dollars");

    const view = await gs.getPlayerView(u.id, "Cy", null);
    assert.ok(view.crude > 500, "owner's money should grow after the tick");

    const dispatch = await gs.getDispatch(u.id);
    assert.equal(dispatch.entries.length, 1);
    assert.equal(dispatch.entries[0].h3, CENTER);
  });

  it("projectMap reflects core ownership, not stale DB columns", async () => {
    const u = await makeUser("Di", 50);
    await gs.doAction(u.id, { type: "expand", h3: CENTER });

    const map = await gs.projectMap();
    const owned = map.find((m) => m.h3Index === CENTER)!;
    assert.equal(owned.ownerId, u.id);
    const unowned = map.find((m) => m.h3Index !== CENTER)!;
    assert.equal(unowned.ownerId, null);
  });
});
