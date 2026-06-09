/**
 * One-time setup: generates the playable H3 grid — every cell inside the
 * City of Los Angeles boundary plus boundary straddlers (see
 * server/cityBoundary.ts) — and inserts it into the hex_cells table.
 *
 * Run with: npm run pipeline:hexes
 *
 * Note: the server also seeds the grid automatically on startup if it's
 * empty or built at a stale resolution (see server/seed.ts). This script
 * forces a (re-)seed on demand.
 */
import "dotenv/config";
import { seedHexes } from "../server/seed";

seedHexes(true)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
