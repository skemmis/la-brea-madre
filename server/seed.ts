/**
 * Database bootstrap run at server startup (and reusable by scripts):
 *   1. runMigrations()  — applies the SQL migrations in ./migrations
 *   2. seedHexes()      — populates the H3 hex grid for LA if it's empty
 *
 * This lets a fresh deploy (e.g. Railway) come up with a ready database
 * without anyone running manual db:push / pipeline:hexes commands.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { polygonToCells } from "h3-js";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { hexCells } from "@shared/schema";

const H3_RESOLUTION = 7;

// Approximate LA County boundary polygon ([lng, lat] per GeoJSON convention).
const LA_COUNTY_APPROX: [number, number][] = [
  [-118.9448, 34.8233],
  [-118.6500, 34.8233],
  [-118.1500, 34.8000],
  [-117.6462, 34.6500],
  [-117.6462, 34.0300],
  [-118.1200, 33.7033],
  [-118.6000, 33.7033],
  [-119.1200, 33.9000],
  [-119.1200, 34.3000],
  [-118.9448, 34.8233],
];

// H3 expects [lat, lng] pairs for the polygon.
const H3_POLYGON: [number, number][] = LA_COUNTY_APPROX.map(([lng, lat]) => [lat, lng]);

export async function runMigrations(): Promise<void> {
  console.log("[migrate] Applying database migrations...");
  await migrate(db, { migrationsFolder: "./migrations" });
  console.log("[migrate] Migrations up to date.");
}

/**
 * Insert the LA hex grid. Skips work if cells already exist (idempotent),
 * unless `force` is set.
 */
export async function seedHexes(force = false): Promise<number> {
  if (!force) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(hexCells);
    if (count > 0) {
      console.log(`[seed] hex_cells already has ${count} cells, skipping.`);
      return count;
    }
  }

  const cells = polygonToCells(H3_POLYGON, H3_RESOLUTION);
  console.log(`[seed] Generating ${cells.length} H3 cells for LA County...`);

  const BATCH = 500;
  for (let i = 0; i < cells.length; i += BATCH) {
    const values = cells.slice(i, i + BATCH).map((h3Index) => ({ h3Index }));
    await db.insert(hexCells).values(values).onConflictDoNothing();
  }

  console.log(`[seed] Done. ${cells.length} hex cells initialized.`);
  return cells.length;
}
