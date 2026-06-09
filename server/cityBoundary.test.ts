/**
 * Tests for the city-boundary rule. Pure — reads the committed GeoJSON,
 * no DB, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { latLngToCell, getResolution } from "h3-js";
import { pointInCity, cityCells } from "./cityBoundary";

// Landmarks inside the City of Los Angeles proper.
const INSIDE: Array<[string, number, number]> = [
  ["City Hall", 34.0537, -118.2427],
  ["La Brea Tar Pits", 34.0638, -118.3553],
  ["Venice Beach", 33.985, -118.4695],
  ["Northridge (Valley)", 34.2283, -118.5366],
  ["San Pedro (harbor)", 33.7361, -118.2922],
];

// Enclaves punched out of the boundary, and neighboring cities.
const OUTSIDE: Array<[string, number, number]> = [
  ["Santa Monica (enclave)", 34.0161, -118.496],
  ["Beverly Hills (enclave)", 34.0696, -118.4006],
  ["Culver City (enclave)", 34.0211, -118.3965],
  ["Long Beach", 33.7686, -118.1956],
  ["Santa Clarita", 34.3917, -118.5426],
  ["New York City", 40.7128, -74.006],
];

test("pointInCity: LA landmarks are in, enclaves and neighbors are out", () => {
  for (const [name, lat, lng] of INSIDE) {
    assert.equal(pointInCity(lat, lng), true, `${name} should be inside`);
  }
  for (const [name, lat, lng] of OUTSIDE) {
    assert.equal(pointInCity(lat, lng), false, `${name} should be outside`);
  }
});

test("cityCells: covers the city, excludes far-away cells, includes straddlers", () => {
  const res = 7; // coarse for speed; the logic is resolution-independent
  const cells = new Set(cityCells(res));

  assert.ok(cells.size > 100, `expected a real grid, got ${cells.size} cells`);
  for (const c of cells) assert.equal(getResolution(c), res);

  // The city core and the harbor strip are covered.
  assert.ok(cells.has(latLngToCell(34.0537, -118.2427, res)), "City Hall cell");
  assert.ok(cells.has(latLngToCell(33.7361, -118.2922, res)), "San Pedro cell");

  // Far-away cells are not.
  assert.ok(!cells.has(latLngToCell(34.3917, -118.5426, res)), "Santa Clarita cell");
  assert.ok(!cells.has(latLngToCell(33.7686, -118.1956, res)), "Long Beach cell");

  // An enclave-centered cell at this coarse resolution overlaps city land at
  // its edges, so it stays playable as a straddler — the boundary rule means
  // only its in-city activity will count.
  assert.ok(cells.has(latLngToCell(34.0696, -118.4006, res)), "Beverly Hills straddler");
});
