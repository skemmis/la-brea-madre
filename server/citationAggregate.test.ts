/**
 * Tests for the pure citation-history cleaning. No DB — runs anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cleanDailyAggregates } from "./citationAggregate";

const TODAY = "2026-06-04";
// lagDays defaults to 14 → newest allowed day is 2026-05-21.

test("parses day/fine/count and sorts oldest → newest", () => {
  const out = cleanDailyAggregates(
    [
      { day: "2024-03-02T00:00:00.000", total_fine: "12345.0", n: "200" },
      { day: "2024-03-01T00:00:00.000", total_fine: "9999.6", n: "180" },
    ],
    { today: TODAY }
  );
  assert.deepEqual(out.map((d) => d.date), ["2024-03-01", "2024-03-02"]);
  assert.equal(out[0].totalFine, 10000); // rounded
  assert.equal(out[1].citationCount, 200);
});

test("drops future-dated garbage rows", () => {
  const out = cleanDailyAggregates(
    [{ day: "2034-08-01T00:00:00.000", total_fine: "5000", n: "50" }],
    { today: TODAY }
  );
  assert.equal(out.length, 0);
});

test("drops the most recent (incomplete) lag window", () => {
  const out = cleanDailyAggregates(
    [
      { day: "2026-06-03T00:00:00.000", total_fine: "5000", n: "50" }, // inside lag
      { day: "2026-05-21T00:00:00.000", total_fine: "5000", n: "50" }, // boundary, kept
    ],
    { today: TODAY }
  );
  assert.deepEqual(out.map((d) => d.date), ["2026-05-21"]);
});

test("drops absurdly old rows and empty days", () => {
  const out = cleanDailyAggregates(
    [
      { day: "2009-01-01T00:00:00.000", total_fine: "5000", n: "50" }, // too old
      { day: "2024-01-01T00:00:00.000", total_fine: "0", n: "0" }, // no citations
      { day: "not-a-date", total_fine: "5000", n: "50" }, // malformed
    ],
    { today: TODAY }
  );
  assert.equal(out.length, 0);
});

test("de-duplicates a repeated day (last value wins)", () => {
  const out = cleanDailyAggregates(
    [
      { day: "2024-03-01T00:00:00.000", total_fine: "100", n: "10" },
      { day: "2024-03-01T00:00:00.000", total_fine: "200", n: "20" },
    ],
    { today: TODAY }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].totalFine, 200);
});
