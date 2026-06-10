/**
 * The City of Los Angeles boundary as a game rule.
 *
 * Loads the committed Census TIGER boundary (client/public/geo) once and
 * exposes:
 *   • pointInCity(lat, lng) — is this point inside the city proper? The
 *     even-odd ring test naturally excludes the 11 enclaves (Beverly Hills,
 *     Santa Monica, Culver City, …) punched out of the polygon.
 *   • cityCells(res)        — the playable H3 grid: every cell whose centroid
 *     is in the city, plus boundary "straddlers" — neighbors that overlap the
 *     city at any vertex. Straddlers are playable, but because the pipeline
 *     filters events through pointInCity, only their in-city activity counts.
 *
 * H3_RESOLUTION lives here so the grid and the pipelines can never disagree.
 */
import fs from "fs";
import path from "path";
import { polygonToCells, gridDisk, cellToBoundary, cellToLatLng } from "h3-js";

export const H3_RESOLUTION = 9; // ~460 m hexes — city-block scale

const BOUNDARY_CANDIDATES = [
  "client/public/geo/la-city-boundary.geojson", // dev / tests (repo root cwd)
  "dist/public/geo/la-city-boundary.geojson", // production build
];

type Ring = [number, number][]; // [lng, lat] per GeoJSON

let ringsCache: Ring[] | null = null;

function rings(): Ring[] {
  if (ringsCache) return ringsCache;
  for (const rel of BOUNDARY_CANDIDATES) {
    const p = path.resolve(process.cwd(), rel);
    if (fs.existsSync(p)) {
      const geo = JSON.parse(fs.readFileSync(p, "utf8"));
      ringsCache = geo.features[0].geometry.coordinates as Ring[];
      return ringsCache;
    }
  }
  throw new Error("la-city-boundary.geojson not found (looked in client/public and dist/public)");
}

let bboxCache: [number, number, number, number] | null = null; // minLng, minLat, maxLng, maxLat

function bbox(): [number, number, number, number] {
  if (!bboxCache) {
    let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
    for (const [lng, lat] of rings()[0]) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    bboxCache = [minLng, minLat, maxLng, maxLat];
  }
  return bboxCache;
}

// ─── Land test ────────────────────────────────────────────────────────────────
// The legal boundary runs out into Santa Monica Bay; the LA Times
// neighborhood polygons stop at the shoreline. "In the boundary AND in a
// neighborhood" is the playable-land test the hex grid uses.

const LAND_CANDIDATES = [
  "client/public/geo/la-city-land.geojson",
  "dist/public/geo/la-city-land.geojson",
];

interface LandPoly {
  rings: Ring[];
  bbox: [number, number, number, number];
}

let landCache: LandPoly[] | null | undefined;

function landPolys(): LandPoly[] | null {
  if (landCache !== undefined) return landCache ?? null;
  landCache = null;
  for (const rel of LAND_CANDIDATES) {
    const p = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(p)) continue;
    const geo = JSON.parse(fs.readFileSync(p, "utf8"));
    landCache = geo.features.map((f: any) => {
      const rings = f.geometry.coordinates as Ring[];
      let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
      for (const [lng, lat] of rings[0]) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      return { rings, bbox: [minLng, minLat, maxLng, maxLat] };
    });
    break;
  }
  return landCache ?? null;
}

function inRings(lat: number, lng: number, rs: Ring[]): boolean {
  let inside = false;
  for (const ring of rs) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** On the city's land (in some neighborhood). True when the land file is absent. */
export function pointOnCityLand(lat: number, lng: number): boolean {
  const polys = landPolys();
  if (!polys) return true; // fail open: no land data, fall back to boundary-only
  for (const p of polys) {
    const [minLng, minLat, maxLng, maxLat] = p.bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    if (inRings(lat, lng, p.rings)) return true;
  }
  return false;
}

/** The full playable test: inside the legal boundary AND on city land. */
export function pointPlayable(lat: number, lng: number): boolean {
  return pointInCity(lat, lng) && pointOnCityLand(lat, lng);
}

/** Inside the City of LA proper (enclaves excluded), via even-odd ray casting. */
export function pointInCity(lat: number, lng: number): boolean {
  // Cheap reject first — the full test walks ~8k boundary vertices, and the
  // pipelines push tens of thousands of county-wide points through here.
  const [minLng, minLat, maxLng, maxLat] = bbox();
  if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false;

  let inside = false;
  for (const ring of rings()) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * The playable grid at `res`: centroid-inside cells plus boundary straddlers.
 * A neighbor cell straddles if its center or any boundary vertex falls in the
 * city — close enough at block scale, and errs toward including edge cells.
 */
export function cityCells(res: number = H3_RESOLUTION): string[] {
  const [outer, ...holes] = rings();
  const toLatLng = (r: Ring) => r.map(([lng, lat]) => [lat, lng] as [number, number]);
  const core = polygonToCells([toLatLng(outer), ...holes.map(toLatLng)], res);

  const cells = new Set(core);
  for (const cell of core) {
    for (const n of gridDisk(cell, 1)) {
      if (cells.has(n)) continue;
      const probes = [cellToLatLng(n), ...cellToBoundary(n)];
      if (probes.some(([lat, lng]) => pointInCity(lat, lng))) cells.add(n);
    }
  }
  // The boundary alone admits open water (the city's legal limit runs into
  // Santa Monica Bay) — keep only cells that touch actual city land.
  return [...cells].filter((cell) =>
    [cellToLatLng(cell), ...cellToBoundary(cell)].some(([lat, lng]) =>
      pointPlayable(lat, lng)
    )
  );
}

/** Is this cell on the playable grid? (center or any vertex on city land) */
export function cellPlayable(cell: string): boolean {
  return [cellToLatLng(cell), ...cellToBoundary(cell)].some(([lat, lng]) =>
    pointPlayable(lat, lng)
  );
}
