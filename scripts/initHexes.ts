/**
 * One-time setup: generates all H3 resolution-7 cells covering Los Angeles
 * and inserts them into the hex_cells table.
 *
 * Run with: npm run pipeline:hexes
 *
 * Note: the server also seeds the grid automatically on startup if it's
 * empty (see server/seed.ts). This script forces a (re-)seed on demand.
 */
import "dotenv/config";
import { seedHexes } from "../server/seed";

seedHexes(true)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
