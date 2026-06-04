/**
 * Tests for the pure YES/NO market-builders. No DB — runs anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  median,
  buildOverUnderMarket,
  buildFaceoffMarket,
  eligibleTargets,
  type MetricPoint,
} from "./marketMetrics";

const isoDay = (offset: number) => {
  const d = new Date("2024-01-01T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

// Rising series: 1000, 1010, 1020, ...
const rising: MetricPoint[] = Array.from({ length: 40 }, (_, i) => ({
  date: isoDay(i),
  value: 1000 + i * 10,
}));

test("median handles odd and even counts", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([10, 20, 30, 40]), 25);
});

test("over/under: a rising series clears its trailing median (YES)", () => {
  const m = buildOverUnderMarket(rising, isoDay(30), 30)!;
  assert.equal(m.outcomeIndex, 0); // YES = over
  assert.ok(m.actualValue > m.line);
  assert.ok(m.baseRateYes > 0.3 && m.baseRateYes < 0.7);
});

test("over/under: returns null without enough trailing history", () => {
  assert.equal(buildOverUnderMarket(rising, isoDay(5), 30), null);
});

test("over/under: clamps opening odds away from 0/1", () => {
  const flat: MetricPoint[] = Array.from({ length: 35 }, (_, i) => ({
    date: isoDay(i),
    value: 500,
  }));
  const m = buildOverUnderMarket(flat, flat[flat.length - 1].date, 30)!;
  assert.ok(m.baseRateYes >= 0.05 && m.baseRateYes <= 0.95);
});

test("face-off: A consistently beating B resolves YES with high odds", () => {
  const a = rising; // 1000+
  const b: MetricPoint[] = rising.map((p) => ({ date: p.date, value: 100 })); // always lower
  const m = buildFaceoffMarket(a, b, isoDay(30), 30)!;
  assert.equal(m.outcomeIndex, 0); // YES = A > B
  assert.ok(m.actualA > m.actualB);
  assert.ok(m.baseRateYes >= 0.9);
});

test("face-off: missing B days count as zero and A still wins", () => {
  const a = rising;
  const b: MetricPoint[] = []; // no data for B at all
  const m = buildFaceoffMarket(a, b, isoDay(30), 30)!;
  assert.equal(m.actualB, 0);
  assert.equal(m.outcomeIndex, 0);
});

test("eligibleTargets skips the first `window` days", () => {
  assert.deepEqual(eligibleTargets(rising, 30).length, 10);
});
