/**
 * Snapshot the live board's per-hex daily rates into the committed sim
 * fixture (sim/fixtures/la-board.json), so the testing grounds run against
 * the real city's shape with no database. Re-run whenever the pipelines have
 * fresher data: npx tsx scripts/extractSimFixture.ts
 */
import "dotenv/config";
import fs from "fs";
import { db } from "../server/db";
import { hexCells, hexAmbient, citationDaily } from "../shared/schema";
import { getPipelineMeta } from "../server/storage";
import { and, eq } from "drizzle-orm";

(async () => {
  const meta = await getPipelineMeta();
  const citWindow = Math.max(1, meta["citation_window_days"] ?? 1);
  const daWindow = Math.max(1, meta["dead_animal_window_days"] ?? 1);
  const today = new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .split("T")[0];

  const rows = await db
    .select({
      h3: hexCells.h3Index,
      fine: citationDaily.totalFine,
      dead: hexAmbient.deadAnimalCount,
    })
    .from(hexCells)
    .leftJoin(hexAmbient, eq(hexCells.h3Index, hexAmbient.h3Index))
    .leftJoin(
      citationDaily,
      and(eq(hexCells.h3Index, citationDaily.h3Index), eq(citationDaily.date, today))
    );

  const cells = rows.map((r) => {
    const cell: { h: string; f?: number; c?: number } = { h: r.h3 };
    const f = Math.round((r.fine ?? 0) / citWindow);
    const c = Math.round(((r.dead ?? 0) / daWindow) * 1000) / 1000;
    if (f > 0) cell.f = f;
    if (c > 0) cell.c = c;
    return cell;
  });

  fs.writeFileSync(
    "sim/fixtures/la-board.json",
    JSON.stringify({ extracted: today, citWindow, daWindow, cells })
  );
  const withF = cells.filter((c) => c.f).length;
  const withC = cells.filter((c) => c.c).length;
  console.log(`wrote sim/fixtures/la-board.json — ${cells.length} cells, ${withF} with fine $, ${withC} with carrion`);
  process.exit(0);
})();
