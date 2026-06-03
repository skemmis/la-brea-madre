/**
 * One-time setup: generates all H3 resolution-7 cells covering Los Angeles
 * and inserts them into the hex_cells table.
 *
 * Run with: npm run pipeline:hexes
 */
import "dotenv/config";
import { polygonToCells, cellToLatLng } from "h3-js";
import { db } from "../server/db";
import { hexCells } from "@shared/schema";
import { sql } from "drizzle-orm";

const H3_RESOLUTION = 7;

// Approximate LA County boundary polygon (simplified GeoJSON coordinates)
// Coords are [lng, lat] per GeoJSON convention
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

// H3 expects [lat, lng] pairs for the polygon
const H3_POLYGON: [number, number][] = LA_COUNTY_APPROX.map(([lng, lat]) => [lat, lng]);

async function main() {
  console.log("[init-hexes] Generating H3 cells for LA County at resolution", H3_RESOLUTION);

  const cells = polygonToCells(H3_POLYGON, H3_RESOLUTION);
  console.log(`[init-hexes] Generated ${cells.length} cells`);

  let inserted = 0;
  const BATCH = 500;

  for (let i = 0; i < cells.length; i += BATCH) {
    const batch = cells.slice(i, i + BATCH);
    const values = batch.map((h3Index) => ({ h3Index }));
    await db
      .insert(hexCells)
      .values(values)
      .onConflictDoNothing();
    inserted += batch.length;
    process.stdout.write(`\r[init-hexes] Inserted ${inserted}/${cells.length}`);
  }

  console.log(`\n[init-hexes] Done. ${inserted} hex cells initialized.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
