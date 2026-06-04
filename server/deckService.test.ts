/**
 * Integration test for the deck service: opening packs and reading the
 * collection. DB-gated; skips when no DATABASE_URL.
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("deck service (integration)", () => {
  let ds: typeof import("./deckService");
  let db: typeof import("./db").db;
  let pool: typeof import("./db").pool;
  let schema: typeof import("@shared/schema");

  before(async () => {
    ds = await import("./deckService");
    ({ db, pool } = await import("./db"));
    schema = await import("@shared/schema");

    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: "./migrations" });
    const { ensureGameStateTable } = await import("./gameService");
    await ensureGameStateTable();
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE game_state, users RESTART IDENTITY CASCADE`);
  });

  async function makeUser(crude: number) {
    const [u] = await db
      .insert(schema.users)
      .values({ auth0Id: "auth|d", email: "d@example.com", displayName: "Dee", crude })
      .returning();
    return u;
  }

  it("opens a pack: spends crude, grants cards, grows the collection", async () => {
    const u = await makeUser(100);
    const result = await ds.openPackFor(u.id);

    assert.equal(result.drawn.length, 3);
    assert.ok(result.crude < 100, "crude spent");
    assert.equal(result.collection.length, 3, "first pack is all new");
    // Drawn cards carry their display data.
    assert.ok(result.drawn[0].name && result.drawn[0].rarity);
  });

  it("reports the collection, combined effects, and catalog ownership", async () => {
    const u = await makeUser(100);
    await ds.openPackFor(u.id);

    const view = await ds.getCollection(u.id);
    assert.equal(view.owned.length, 3);
    assert.ok(view.catalog.length >= 6);
    assert.equal(view.catalog.filter((c) => c.owned).length, 3);
    assert.ok(view.effects.payoutMult >= 1);
    assert.equal(typeof view.packCost, "number");
  });

  it("refuses to open a pack without enough crude", async () => {
    const u = await makeUser(0);
    await assert.rejects(() => ds.openPackFor(u.id));
  });
});
