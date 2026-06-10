import test from "node:test";
import assert from "node:assert/strict";
import { quakeRadiusKm, quakePeakDamage, quakeDamageAt, distanceKm } from "./quakeMath";

test("radius and peak damage grow with magnitude", () => {
  assert.ok(quakeRadiusKm(2.0) > quakeRadiusKm(1.5));
  assert.ok(quakePeakDamage(3.0) > quakePeakDamage(2.0));
  assert.equal(quakePeakDamage(1.5), 6);
  assert.equal(quakePeakDamage(3.0), 38);
});

test("damage falls off with distance and dies at the felt radius", () => {
  const atEpicenter = quakeDamageAt(0, 2.5);
  const nearby = quakeDamageAt(3, 2.5);
  const rim = quakeDamageAt(quakeRadiusKm(2.5) - 0.1, 2.5);
  assert.equal(atEpicenter, quakePeakDamage(2.5));
  assert.ok(nearby < atEpicenter && nearby > 0);
  assert.ok(rim <= 4, String(rim));
  assert.equal(quakeDamageAt(99, 2.5), 0);
});

test("haversine sanity: downtown to Santa Monica ≈ 20 km", () => {
  const d = distanceKm(34.05, -118.25, 34.02, -118.49);
  assert.ok(d > 19 && d < 24, String(d));
});
