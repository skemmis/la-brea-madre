/**
 * Tests for the pure over/under round logic. No DB — runs anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { median, buildOverUnderRound, eligibleTargets } from "./marketRound";
import type { DailyAggregate } from "./citationAggregate";

test("median handles odd and even counts", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), 0);
});

// A 40-day series: fines climb steadily so the line + outcome are predictable.
function series(): DailyAggregate[] {
  return Array.from({ length: 40 }, (_, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    citationCount: 100 + i,
    totalFine: 1000 + i * 10, // 1000, 1010, ... strictly increasing
  }));
}

test("eligibleTargets excludes days without enough trailing history", () => {
  const t = eligibleTargets(series(), 30);
  assert.equal(t.length, 10); // 40 - 30
  assert.equal(t[0], "2024-01-31");
});

test("a strictly rising series resolves OVER (target beats its trailing median)", () => {
  const r = buildOverUnderRound(series(), "2024-01-31", 30)!;
  // Trailing days 1..30 → fines 1000..1290, median ≈ 1145; day 31 = 1300 > line.
  assert.ok(r.line >= 1140 && r.line <= 1150, `line ${r.line}`);
  assert.equal(r.outcomeIndex, 0); // OVER
  assert.deepEqual(r.outcomes, ["OVER", "UNDER"]);
  // In a rising series ~half the trailing window beats the median.
  assert.ok(r.baseRateOver > 0.3 && r.baseRateOver < 0.7, `base ${r.baseRateOver}`);
});

test("returns null when there isn't enough history before the target", () => {
  assert.equal(buildOverUnderRound(series(), "2024-01-05", 30), null);
});

test("opening odds are clamped away from 0 and 1", () => {
  // A flat series: nothing ever beats the median → overCount 0 → clamp to 0.05.
  const flat: DailyAggregate[] = Array.from({ length: 35 }, (_, i) => ({
    date: `2024-03-${String(i + 1).padStart(2, "0")}`,
    citationCount: 100,
    totalFine: 5000,
  }));
  const r = buildOverUnderRound(flat, flat[flat.length - 1].date, 30)!;
  assert.ok(r.baseRateOver >= 0.05 && r.baseRateOver <= 0.95);
});
