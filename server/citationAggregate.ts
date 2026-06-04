/**
 * Pure cleaning logic for the citation history series. No IO, no DB — kept in
 * its own module so the filtering rules can be unit-tested anywhere.
 */
export interface DailyAggregate {
  date: string; // YYYY-MM-DD
  citationCount: number;
  totalFine: number;
}

/**
 * Turn Socrata's day-grouped citation aggregates into a trustworthy series:
 *   • drop future-dated garbage (the dataset has rows dated 2034, etc.)
 *   • drop the most recent `lagDays` days — the feed trickles in, so they're
 *     still incomplete and would understate the true daily total
 *   • drop absurdly old rows and anything with no citations
 *
 * Expects rows shaped like `{ day, total_fine, n }` (the SoQL aliases we ask
 * for). Returns a de-duplicated series sorted oldest → newest.
 */
export function cleanDailyAggregates(
  rows: Array<Record<string, unknown>>,
  opts: { today: string; lagDays?: number; minDate?: string }
): DailyAggregate[] {
  const lagDays = opts.lagDays ?? 14;
  const minDate = opts.minDate ?? "2016-01-01";
  const cutoff = new Date(`${opts.today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - lagDays);
  const newestAllowed = cutoff.toISOString().slice(0, 10);

  const byDate = new Map<string, DailyAggregate>();
  for (const row of rows) {
    const day = String(row.day ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (day < minDate || day > newestAllowed) continue;

    const totalFine = Math.round(parseFloat(String(row.total_fine ?? "")) || 0);
    const citationCount = Math.round(parseFloat(String(row.n ?? "")) || 0);
    if (citationCount <= 0 || totalFine < 0) continue;

    byDate.set(day, { date: day, citationCount, totalFine });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
