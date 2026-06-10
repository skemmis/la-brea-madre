import test from "node:test";
import assert from "node:assert/strict";
import { quakeRadiusKm, quakePeakDamage, quakeDamageAt, distanceKm } from "./quakeMath";

test("radius and peak damage grow with magnitude", () => {
  assert.ok(quakeRadiusKm(2.0) > quakeRadiusKm(1.5));
  assert.ok(quakePeakDamage(3.0) > quakePeakDamage(2.0));
  assert.equal(quakePeakDamage(1.5), 4);
  assert.equal(quakePeakDamage(3.0), 25);
});

test("damage falls off with distance and dies at the felt radius", () => {
  const atEpicenter = quakeDamageAt(0, 2.5);
  const nearby = quakeDamageAt(2, 2.5);
  const fringe = quakeDamageAt(5, 2.5);
  assert.equal(atEpicenter, quakePeakDamage(2.5));
  assert.ok(nearby < atEpicenter && nearby > 0);
  assert.ok(fringe <= 1);
  assert.equal(quakeDamageAt(99, 2.5), 0);
});

test("haversine sanity: downtown to Santa Monica ≈ 20 km", () => {
  const d = distanceKm(34.05, -118.25, 34.02, -118.49);
  assert.ok(d > 19 && d < 24, String(d));
});
