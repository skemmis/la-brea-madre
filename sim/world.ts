/**
 * The simulated city — real LA data shapes, no IO at run time.
 *
 * A SimWorld holds per-hex daily rates (ticket $ and carrion) plus a seeded
 * RNG. Each sim day it samples events the way the live shell builds them:
 * fines with a strong day-of-week rhythm, carrion as a Poisson trickle, and
 * quakes as a magnitude-distributed point process matching the basin's real
 * frequency, run through the production damage math (server/quakeMath).
 *
 * Worlds come from the committed fixture (extracted from the live database
 * by scripts/extractSimFixture.ts) or a synthetic generator for fast tests.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import type { BoardHex, GameEvent } from "../shared/core";
import { distanceKm, quakeDamageAt } from "../server/quakeMath";

export interface SimWorld {
  board: Record<string, BoardHex>;
  fineRate: Map<string, number>; // expected ticket $/day per hex
  carrionRate: Map<string, number>; // expected dead-animal reports/day per hex
  /** Hexes sorted by fine rate, best first (bots' "map reading"). */
  byFine: string[];
  /** Hexes sorted by carrion rate, best first. */
  byCarrion: string[];
}

// ─── Seeded RNG (sim-local; the core has its own) ──────────────────────────────

export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  // Knuth for small λ (ours are all small).
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

// ─── World construction ────────────────────────────────────────────────────────

interface FixtureCell {
  h: string;
  f?: number; // fine $/day
  c?: number; // carrion/day
}

function indexWorld(cells: FixtureCell[]): SimWorld {
  const board: Record<string, BoardHex> = {};
  const fineRate = new Map<string, number>();
  const carrionRate = new Map<string, number>();
  for (const c of cells) {
    board[c.h] = { wells: 0 };
    if (c.f) fineRate.set(c.h, c.f);
    if (c.c) carrionRate.set(c.h, c.c);
  }
  const byFine = [...fineRate.keys()].sort((a, b) => fineRate.get(b)! - fineRate.get(a)!);
  const byCarrion = [...carrionRate.keys()].sort(
    (a, b) => carrionRate.get(b)! - carrionRate.get(a)!
  );
  return { board, fineRate, carrionRate, byFine, byCarrion };
}

/** The real city, from the committed fixture. */
export function loadLaWorld(): SimWorld {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(fs.readFileSync(path.join(here, "fixtures/la-board.json"), "utf8"));
  return indexWorld(raw.cells);
}

/**
 * A synthetic town for fast tests: `rings` rings of hexes around downtown,
 * with a fine-rich core, carrion-rich periphery — the real city's shape in
 * miniature.
 */
export function syntheticWorld(rings = 8, seed = 1): SimWorld {
  const rng = makeRng(seed);
  const center = latLngToCell(34.05, -118.25, 9);
  const cells: FixtureCell[] = [];
  const all = gridDisk(center, rings);
  for (const h of all) {
    const [lat, lng] = cellToLatLng(h);
    const d = distanceKm(34.05, -118.25, lat, lng);
    const core = Math.exp(-d / 1.2); // money downtown
    const edge = 1 - Math.exp(-d / 2.5); // carrion at the fringe
    cells.push({
      h,
      f: Math.round(40 + core * 3000 * (0.5 + rng())),
      c: Math.round(edge * 30 * (0.5 + rng())) / 100,
    });
  }
  return indexWorld(cells);
}

// ─── Daily event sampling ──────────────────────────────────────────────────────

// LA writes far fewer tickets on weekends; the sim keeps the rhythm.
const DOW_MULT = [0.25, 1.15, 1.2, 1.2, 1.2, 1.15, 0.45]; // Sun..Sat

export interface SimQuake {
  mag: number;
  lat: number;
  lng: number;
}

/** ~88 M1.5+ a year near the basin, magnitudes exponentially rarer with size. */
export function sampleQuakes(rng: Rng): SimQuake[] {
  const out: SimQuake[] = [];
  const n = poisson(rng, 88 / 365);
  for (let i = 0; i < n; i++) {
    const mag = Math.min(4.5, 1.5 - Math.log(Math.max(1e-9, rng())) / 2.86);
    const r = 40 * Math.sqrt(rng()); // uniform over the 40 km disk
    const theta = rng() * Math.PI * 2;
    out.push({
      mag,
      lat: 34.05 + (r * Math.sin(theta)) / 111,
      lng: -118.4 + (r * Math.cos(theta)) / 92,
    });
  }
  return out;
}

/** One day of injected events for the owned parcels (the live shell's shape). */
export function sampleEvents(
  world: SimWorld,
  ownedH3: string[],
  day: number,
  rng: Rng,
  quakes: SimQuake[]
): GameEvent[] {
  const events: GameEvent[] = [];
  const dow = day % 7;

  for (const h3 of ownedH3) {
    const fine = world.fineRate.get(h3) ?? 0;
    if (fine > 0) {
      const sampled = Math.round(fine * DOW_MULT[dow] * (0.6 + rng() * 0.8));
      if (sampled > 0) events.push({ h3, kind: "fine", magnitude: sampled });
    }
    const carrion = poisson(rng, world.carrionRate.get(h3) ?? 0);
    if (carrion > 0) events.push({ h3, kind: "deadAnimal", magnitude: carrion });
  }

  if (quakes.length) {
    for (const h3 of ownedH3) {
      const [lat, lng] = cellToLatLng(h3);
      let dmg = 0;
      for (const q of quakes) dmg += quakeDamageAt(distanceKm(q.lat, q.lng, lat, lng), q.mag);
      if (dmg > 0) events.push({ h3, kind: "quake", magnitude: dmg });
    }
  }

  return events;
}
