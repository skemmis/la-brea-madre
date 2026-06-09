/**
 * Database bootstrap run at server startup (and reusable by scripts):
 *   1. runMigrations()  — applies the SQL migrations in ./migrations
 *   2. seedHexes()      — populates the H3 hex grid if it's empty or stale
 *
 * The grid is the City of Los Angeles proper (see server/cityBoundary.ts):
 * every res-9 cell with its centroid in the city, plus boundary straddlers.
 * If the stored grid was built at a different resolution, it's wiped and
 * regridded automatically — along with the per-hex data keyed by the old
 * cell ids — so a deploy that changes H3_RESOLUTION migrates itself.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getResolution } from "h3-js";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { hexCells, hexAmbient, citationDaily } from "@shared/schema";
import { cityCells, H3_RESOLUTION } from "./cityBoundary";

export async function runMigrations(): Promise<void> {
  console.log("[migrate] Applying database migrations...");
  await migrate(db, { migrationsFolder: "./migrations" });
  console.log("[migrate] Migrations up to date.");
}

/**
 * Insert the city hex grid. Skips work if a grid at the current resolution
 * already exists (idempotent); a `force` or a resolution change regrids.
 */
export async function seedHexes(force = false): Promise<number> {
  const existing = await db
    .select({ h3Index: hexCells.h3Index })
    .from(hexCells)
    .limit(1);

  if (existing.length > 0) {
    const stale = getResolution(existing[0].h3Index) !== H3_RESOLUTION;
    if (!force && !stale) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(hexCells);
      console.log(`[seed] hex_cells already has ${count} res-${H3_RESOLUTION} cells, skipping.`);
      return count;
    }
    console.log(
      `[seed] Regridding (${stale ? `stale resolution → ${H3_RESOLUTION}` : "forced"}): ` +
        `clearing hex_cells + per-hex data...`
    );
    await db.delete(citationDaily);
    await db.delete(hexAmbient);
    await db.delete(hexCells);
  }

  const cells = cityCells(H3_RESOLUTION);
  console.log(`[seed] Generating ${cells.length} res-${H3_RESOLUTION} cells for the City of LA...`);

  const BATCH = 500;
  for (let i = 0; i < cells.length; i += BATCH) {
    const values = cells.slice(i, i + BATCH).map((h3Index) => ({ h3Index }));
    await db.insert(hexCells).values(values).onConflictDoNothing();
  }

  console.log(`[seed] Done. ${cells.length} hex cells initialized.`);
  return cells.length;
}
