/**
 * Data pipeline: pulls LA open data and indexes it into H3 cells.
 * - Parking citations from LA Socrata (4f5p-udkv)
 * - Oil wells from CalGEM (WellSTAR)
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import proj4 from "proj4";
import { latLngToCell } from "h3-js";
import { db, pool } from "./db";
import { citationDaily, hexAmbient, hexCells } from "@shared/schema";
import {
  upsertHexWells,
  upsertHexDeadAnimals,
  upsertCitationDaily,
  upsertCitationMarketDay,
  upsertMetricDays,
  setPipelineMeta,
} from "./storage";
import { eq, sql } from "drizzle-orm";
import { pointInCity, H3_RESOLUTION } from "./cityBoundary";
import { MAKE_LABELS, COLOR_LABELS, VIOLATIONS, HOODS } from "./exchangeBoard";

const SOCRATA_APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";

// California State Plane Zone 5 (EPSG:2229, NAD83, US survey feet) — the
// projection LA's older coordinate fields use. We reproject to WGS84.
const STATE_PLANE_5 =
  "+proj=lcc +lat_1=35.46666666666667 +lat_2=34.03333333333333 " +
  "+lat_0=33.5 +lon_0=-118 +x_0=2000000.0001016 +y_0=500000.0001016001 " +
  "+datum=NAD83 +units=us-ft +no_defs";

// Only events inside the City of LA proper count toward the game — even in
// hexes that straddle the boundary, the out-of-city share is dropped here.
const inLA = pointInCity;

/**
 * Parse a coordinate pair that may be either WGS84 decimal degrees or
 * CA State Plane Zone 5 (feet). Returns [lat, lng] in WGS84, or null.
 */
function parseCoord(latRaw: unknown, lngRaw: unknown): [number, number] | null {
  const lat = parseFloat(String(latRaw ?? ""));
  const lng = parseFloat(String(lngRaw ?? ""));
  if (!isFinite(lat) || !isFinite(lng) || lat === 0 || lng === 0) return null;

  // Already WGS84?
  if (lat >= 32 && lat <= 36 && lng >= -120 && lng <= -116) return [lat, lng];

  // Looks like State Plane feet (large magnitudes) → reproject.
  if (Math.abs(lat) > 1000 && Math.abs(lng) > 1000) {
    // Field convention: "lat" carries northing (y), "lng" carries easting (x).
    const [outLng, outLat] = proj4(STATE_PLANE_5, "WGS84", [lng, lat]);
    if (outLat >= 32 && outLat <= 36 && outLng >= -120 && outLng <= -116) {
      return [outLat, outLng];
    }
  }
  return null;
}

function todayPT(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .split("T")[0];
}

// Number of days spanned by a set of record timestamps (min 1), used to
// turn raw counts into per-day averages.
function spanDays(minT: number, maxT: number): number {
  if (!isFinite(minT) || !isFinite(maxT) || maxT <= minT) return 1;
  return Math.max(1, Math.round((maxT - minT) / 86_400_000));
}

// ─── Parking Citations ────────────────────────────────────────────────────────

// Color/make normalization: filthy codes → clean labels
const MAKE_MAP: Record<string, string> = {
  TOYT: "Toyota", HOND: "Honda", FORD: "Ford", CHEV: "Chevrolet",
  NISS: "Nissan", BMW: "BMW", MERZ: "Mercedes", AUDI: "Audi",
  LEXS: "Lexus", DODG: "Dodge", JEEP: "Jeep", KIA: "Kia",
  HYUN: "Hyundai", VOLK: "Volkswagen", ACUR: "Acura", INFI: "Infiniti",
};

function normalizeMake(raw: string): string {
  const upper = (raw || "").toUpperCase().trim().slice(0, 4);
  return MAKE_MAP[upper] || raw?.toUpperCase().trim() || "UNKNOWN";
}

/**
 * Pulls the most recent valid citations and aggregates them per hex,
 * stored under today's date so the live map reflects current "activity".
 *
 * Note: the dataset contains garbage future-dated rows (e.g. 2034) and its
 * real data lags, so we pull the most recent rows up to now rather than
 * querying a specific recent day.
 */
export async function runCitationPipeline(_daysBack = 2): Promise<{
  fetched: number;
  processed: number;
  errors: number;
}> {
  const results = { fetched: 0, processed: 0, errors: 0 };

  const knownHexRows = await db.select({ h3Index: hexCells.h3Index }).from(hexCells);
  const knownHexSet = new Set(knownHexRows.map((r) => r.h3Index));

  const storeDate = todayPT();
  // Exclude far-future garbage dates: only rows dated before tomorrow.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 1);
  const cutoffStr = `${cutoff.toISOString().split("T")[0]}T00:00:00.000`;

  try {
    const url = "https://data.lacity.org/resource/4f5p-udkv.json";
    const params: Record<string, string> = {
      $where: `loc_lat IS NOT NULL AND issue_date < '${cutoffStr}'`,
      $order: "issue_date DESC",
      $limit: "50000",
      $select: "loc_lat,loc_long,fine_amount,make,issue_date",
    };
    if (SOCRATA_APP_TOKEN) params["$$app_token"] = SOCRATA_APP_TOKEN;

    const response = await axios.get<any[]>(url, { params, timeout: 60000 });
    results.fetched = response.data?.length ?? 0;

    const cellMap = new Map<
      string,
      { count: number; totalFine: number; makes: Set<string> }
    >();
    let minT = Infinity;
    let maxT = -Infinity;

    for (const row of response.data) {
      const coord = parseCoord(row.loc_lat, row.loc_long);
      if (!coord) continue;
      const [lat, lng] = coord;
      if (!inLA(lat, lng)) continue;

      const h3 = latLngToCell(lat, lng, H3_RESOLUTION);
      if (!knownHexSet.has(h3)) continue;

      if (!cellMap.has(h3)) {
        cellMap.set(h3, { count: 0, totalFine: 0, makes: new Set() });
      }
      const entry = cellMap.get(h3)!;
      entry.count++;
      entry.totalFine += parseFloat(row.fine_amount || "0") || 0;
      entry.makes.add(normalizeMake(row.make || ""));

      const t = Date.parse(row.issue_date || "");
      if (!Number.isNaN(t)) {
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
      }
    }

    // Replace today's snapshot (idempotent re-runs).
    await db.delete(citationDaily).where(eq(citationDaily.date, storeDate));

    for (const [h3Index, data] of cellMap.entries()) {
      await upsertCitationDaily(h3Index, storeDate, data.count, data.totalFine, data.makes.size);
      results.processed++;
    }

    await setPipelineMeta("citation_window_days", spanDays(minT, maxT));
  } catch (err) {
    console.error("Citation pipeline error:", err);
    results.errors++;
  }

  return results;
}

// ─── Citation history (daily series for prediction markets) ────────────────────

export { cleanDailyAggregates, type DailyAggregate } from "./citationAggregate";
import { cleanDailyAggregates, cleanDailyCounts } from "./citationAggregate";

/**
 * Pull citywide per-day citation totals (count + summed fines), grouped
 * server-side by Socrata, and upsert the cleaned series. This is the
 * historical record the markets are priced and resolved against.
 */
export async function runCitationHistory(days = 1200): Promise<{
  fetched: number;
  stored: number;
  errors: number;
}> {
  const results = { fetched: 0, stored: 0, errors: 0 };
  const today = todayPT();

  // Exclude far-future garbage dates server-side too.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const futureCutoff = `${tomorrow.toISOString().split("T")[0]}T00:00:00.000`;

  try {
    const url = "https://data.lacity.org/resource/4f5p-udkv.json";
    const params: Record<string, string> = {
      $select: "date_trunc_ymd(issue_date) AS day, sum(fine_amount) AS total_fine, count(1) AS n",
      $where: `issue_date < '${futureCutoff}' AND issue_date > '2016-01-01T00:00:00.000' AND fine_amount IS NOT NULL`,
      $group: "date_trunc_ymd(issue_date)",
      $order: "day DESC",
      $limit: String(days),
    };
    if (SOCRATA_APP_TOKEN) params["$$app_token"] = SOCRATA_APP_TOKEN;

    const resp = await axios.get<any[]>(url, { params, timeout: 60000 });
    results.fetched = resp.data?.length ?? 0;

    const cleaned = cleanDailyAggregates(resp.data ?? [], { today });
    for (const d of cleaned) {
      await upsertCitationMarketDay(d.date, d.citationCount, d.totalFine);
      results.stored++;
    }
    // Feed the prediction exchange's generic metric series.
    await upsertMetricDays("fines", cleaned.map((d) => ({ date: d.date, value: d.totalFine })));
    await upsertMetricDays("citations", cleaned.map((d) => ({ date: d.date, value: d.citationCount })));
  } catch (err) {
    console.error("Citation history error:", err);
    results.errors++;
  }

  return results;
}

// ─── Make face-off history (Toyota vs Honda daily ticket counts) ───────────────

/**
 * Per-day ticket counts for two car makes, feeding the "more Toyotas than
 * Hondas?" face-off market. Same citation dataset and date range as the
 * history above, so the two series align perfectly with the exchange calendar.
 */
export async function runMakeHistory(days = 1200): Promise<{
  fetched: number;
  stored: number;
  errors: number;
}> {
  const results = { fetched: 0, stored: 0, errors: 0 };
  const today = todayPT();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const futureCutoff = `${tomorrow.toISOString().split("T")[0]}T00:00:00.000`;
  const url = "https://data.lacity.org/resource/4f5p-udkv.json";

  // One grouped pull per cohort dimension; each row set fans out into one
  // daily_metric series per cohort value (make:TOYT, color:BK, viol:SWEEP).
  const pulls: {
    field: string;
    metricFor: (v: string) => string | null;
    values: string[];
  }[] = [
    {
      field: "make",
      values: Object.keys(MAKE_LABELS),
      metricFor: (v) => `make:${v}`,
    },
    {
      field: "color",
      values: Object.keys(COLOR_LABELS),
      metricFor: (v) => `color:${v}`,
    },
    {
      field: "violation_description",
      values: Object.values(VIOLATIONS).map((v) => v.socrata),
      metricFor: (v) => {
        const key = Object.entries(VIOLATIONS).find(([, def]) => def.socrata === v)?.[0];
        return key ? `viol:${key}` : null;
      },
    },
  ];

  for (const pull of pulls) {
    try {
      const list = pull.values.map((v) => `'${v.replace(/'/g, "''")}'`).join(",");
      const params: Record<string, string> = {
        $select: `date_trunc_ymd(issue_date) AS day, ${pull.field} AS k, count(1) AS n`,
        $where:
          `issue_date < '${futureCutoff}' AND issue_date > '2016-01-01T00:00:00.000'` +
          ` AND ${pull.field} in (${list})`,
        $group: `date_trunc_ymd(issue_date), ${pull.field}`,
        $order: "day DESC",
        $limit: String(days * pull.values.length),
      };
      if (SOCRATA_APP_TOKEN) params["$$app_token"] = SOCRATA_APP_TOKEN;

      const resp = await axios.get<any[]>(url, { params, timeout: 120000 });
      const rows = resp.data ?? [];
      results.fetched += rows.length;

      for (const value of pull.values) {
        const metric = pull.metricFor(value);
        if (!metric) continue;
        const cleaned = cleanDailyCounts(rows.filter((r) => r.k === value), { today });
        await upsertMetricDays(metric, cleaned);
        results.stored += cleaned.length;
      }
    } catch (err) {
      console.error(`Cohort history error (${pull.field}):`, err);
      results.errors++;
    }
  }

  return results;
}

// ─── Neighborhood series (district markets) ────────────────────────────────────

/** WGS84 bbox of a named LA Times neighborhood from la-city-land.geojson. */
function hoodBbox(name: string): [number, number, number, number] | null {
  const candidates = [
    "client/public/geo/la-city-land.geojson",
    "dist/public/geo/la-city-land.geojson",
  ];
  for (const rel of candidates) {
    const p = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(p)) continue;
    const geo = JSON.parse(fs.readFileSync(p, "utf8"));
    let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
    let found = false;
    for (const f of geo.features) {
      if (f.properties?.name !== name) continue;
      found = true;
      for (const ring of f.geometry.coordinates) {
        for (const [lng, lat] of ring) {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
    return found ? [minLng, minLat, maxLng, maxLat] : null;
  }
  return null;
}

/**
 * Per-neighborhood daily series for the district markets:
 *   hoodcit:<KEY> — citations/day inside the district's bounds (one grouped
 *                   Socrata query per district, bbox in State Plane feet)
 *   hoodda:<KEY>  — dead-animal reports/day, binned locally from one pull.
 * Bboxes, not exact polygons — a consistent, cheap stand-in that prices and
 * settles identically.
 */
export async function runNeighborhoodHistory(days = 420): Promise<{
  fetched: number;
  stored: number;
  errors: number;
}> {
  const results = { fetched: 0, stored: 0, errors: 0 };
  const today = todayPT();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const futureCutoff = `${tomorrow.toISOString().split("T")[0]}T00:00:00.000`;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = `${since.toISOString().split("T")[0]}T00:00:00.000`;

  const hoods = HOODS.map((h) => ({ ...h, bbox: hoodBbox(h.name) })).filter(
    (h): h is (typeof HOODS)[number] & { bbox: [number, number, number, number] } => !!h.bbox
  );

  // Citations: one grouped query per district. The current dataset stores
  // loc_lat/loc_long as WGS84 degrees in text columns — cast and compare.
  for (const h of hoods) {
    try {
      const [minLng, minLat, maxLng, maxLat] = h.bbox;
      const params: Record<string, string> = {
        $select: "date_trunc_ymd(issue_date) AS day, count(1) AS n",
        $where:
          `issue_date < '${futureCutoff}' AND issue_date > '${sinceIso}'` +
          ` AND loc_long::number between ${minLng.toFixed(5)} and ${maxLng.toFixed(5)}` +
          ` AND loc_lat::number between ${minLat.toFixed(5)} and ${maxLat.toFixed(5)}`,
        $group: "date_trunc_ymd(issue_date)",
        $order: "day DESC",
        $limit: String(days + 10),
      };
      if (SOCRATA_APP_TOKEN) params["$$app_token"] = SOCRATA_APP_TOKEN;

      const resp = await axios.get<any[]>("https://data.lacity.org/resource/4f5p-udkv.json", {
        params,
        timeout: 120000,
      });
      const cleaned = cleanDailyCounts(resp.data ?? [], { today });
      await upsertMetricDays(`hoodcit:${h.key}`, cleaned);
      results.fetched += (resp.data ?? []).length;
      results.stored += cleaned.length;
    } catch (err) {
      console.error(`Neighborhood citations error (${h.name}):`, err);
      results.errors++;
    }
  }

  // Dead animals: one pull of all rows, binned locally into district bboxes.
  try {
    const params: Record<string, string> = {
      $where: `lower(type) like '%animal%' AND createddate < '${futureCutoff}' AND createddate > '${sinceIso}'`,
      $select: "geolocation__latitude__s,geolocation__longitude__s,createddate",
      $limit: "50000",
    };
    if (SOCRATA_APP_TOKEN) params["$$app_token"] = SOCRATA_APP_TOKEN;
    const resp = await axios.get<any[]>("https://data.lacity.org/resource/2cy6-i7zn.json", {
      params,
      timeout: 120000,
    });
    const rows = resp.data ?? [];
    results.fetched += rows.length;

    const counts = new Map<string, Map<string, number>>(); // key → date → n
    for (const row of rows) {
      const coord = parseCoord(row.geolocation__latitude__s, row.geolocation__longitude__s);
      const day = String(row.createddate ?? "").slice(0, 10);
      if (!coord || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const [lat, lng] = coord;
      for (const h of hoods) {
        const [minLng, minLat, maxLng, maxLat] = h.bbox;
        if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
        let m = counts.get(h.key);
        if (!m) counts.set(h.key, (m = new Map()));
        m.set(day, (m.get(day) ?? 0) + 1);
      }
    }
    // Days with zero reports are real zeros for these sparse series — fill
    // the calendar so lines and odds aren't built from busy days only.
    for (const h of hoods) {
      const m = counts.get(h.key) ?? new Map<string, number>();
      const series: { date: string; value: number }[] = [];
      for (let i = days; i >= 1; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const day = d.toISOString().slice(0, 10);
        if (day >= today) continue;
        series.push({ date: day, value: m.get(day) ?? 0 });
      }
      await upsertMetricDays(`hoodda:${h.key}`, series);
      results.stored += series.length;
    }
  } catch (err) {
    console.error("Neighborhood dead-animal error:", err);
    results.errors++;
  }

  return results;
}

/** Create the prediction-market data table if it doesn't exist yet. */
export async function ensureMarketDataTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS citation_market_daily (
       date date PRIMARY KEY,
       citation_count integer NOT NULL DEFAULT 0,
       total_fine integer NOT NULL DEFAULT 0,
       updated_at timestamptz NOT NULL DEFAULT now()
     )`
  );
}

/** Create the generic daily-metric table for the prediction exchange. */
export async function ensureExchangeTables(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS daily_metric (
       metric text NOT NULL,
       date date NOT NULL,
       value integer NOT NULL DEFAULT 0,
       updated_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (metric, date)
     )`
  );
}

// ─── Oil Wells (CalGEM) ───────────────────────────────────────────────────────

export async function runOilWellsCensus(): Promise<{
  fetched: number;
  indexed: number;
  errors: number;
}> {
  const results = { fetched: 0, indexed: 0, errors: 0 };
  const url =
    "https://gis.conservation.ca.gov/server/rest/services/WellSTAR/Wells/MapServer/0/query";

  const cellWellCounts = new Map<string, number>();

  try {
    let offset = 0;
    const pageSize = 2000;
    let hasMore = true;

    while (hasMore) {
      const params = {
        where: "CountyName = 'Los Angeles' AND WellStatus = 'Active'",
        outFields: "Latitude,Longitude,WellStatus",
        f: "json",
        returnGeometry: "true",
        outSR: "4326",
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
      };

      const resp = await axios.get<any>(url, { params, timeout: 30000 });
      if (resp.data?.error) {
        throw new Error(`CalGEM API error: ${JSON.stringify(resp.data.error)}`);
      }

      const features = resp.data?.features || [];
      results.fetched += features.length;

      for (const feature of features) {
        const a = feature.attributes || {};
        const g = feature.geometry || {};
        const coord = parseCoord(a.Latitude ?? g.y, a.Longitude ?? g.x);
        if (!coord) continue;
        const [lat, lng] = coord;
        if (!inLA(lat, lng)) continue;
        const h3 = latLngToCell(lat, lng, H3_RESOLUTION);
        cellWellCounts.set(h3, (cellWellCounts.get(h3) ?? 0) + 1);
      }

      if (features.length === 0 || (!resp.data?.exceededTransferLimit && features.length < pageSize)) {
        hasMore = false;
      } else {
        offset += features.length;
      }
    }
  } catch (err) {
    console.error("CalGEM API error:", err);
    // Fall back to a curated sample of known LA oil fields if the API fails.
    const laOilFields: Array<[number, number]> = [
      [34.0195, -118.2437], [33.9850, -118.3650], [33.9647, -118.4102],
      [34.1450, -118.6500], [34.1780, -118.5990], [33.8900, -118.3900],
      [33.8400, -118.2800], [33.8200, -118.2600],
    ];
    for (const [lat, lng] of laOilFields) {
      const h3 = latLngToCell(lat, lng, H3_RESOLUTION);
      cellWellCounts.set(h3, (cellWellCounts.get(h3) ?? 0) + 5);
    }
    results.errors++;
  }

  // When the live census succeeded, it's authoritative: clear stale oil
  // counts first so cells that no longer have active wells drop to zero.
  // (Skip on fallback so we don't wipe real data on a transient API failure.)
  if (results.errors === 0) {
    await db.update(hexAmbient).set({ oilWellCount: 0, baseYieldPerTick: 1, updatedAt: new Date() });
  }

  for (const [h3Index, wellCount] of cellWellCounts.entries()) {
    await upsertHexWells(h3Index, wellCount);
    results.indexed++;
  }

  return results;
}

// ─── Dead Animal Reports (MyLA311 Cases 2026) ──────────────────────────────────

/** The PT calendar day before todayPT(), as YYYY-MM-DD. */
export function yesterdayPT(): string {
  const t = new Date(`${todayPT()}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

// Exact report locations for one day's dead-animal pickups — the carrion
// layer's glowing dots. Fetched straight from MyLA311 and cached in memory;
// display-only, nothing touches the DB. (Experimental.)
const carrionPointsCache = new Map<
  string,
  { at: number; points: { lng: number; lat: number }[] }
>();

export async function fetchDeadAnimalPoints(
  date: string
): Promise<{ lng: number; lat: number }[]> {
  const hit = carrionPointsCache.get(date);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.points;

  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDay = next.toISOString().slice(0, 10);

  const url = "https://data.lacity.org/resource/2cy6-i7zn.json";
  const params: Record<string, string> = {
    $select: "geolocation__latitude__s,geolocation__longitude__s",
    $where:
      `lower(type) like '%animal%'` +
      ` AND createddate >= '${date}T00:00:00'` +
      ` AND createddate < '${nextDay}T00:00:00'`,
    $limit: "5000",
  };
  if (SOCRATA_APP_TOKEN) params["$$app_token"] = SOCRATA_APP_TOKEN;

  const resp = await axios.get<any[]>(url, { params, timeout: 30000 });
  const points: { lng: number; lat: number }[] = [];
  for (const row of resp.data ?? []) {
    const coord = parseCoord(row.geolocation__latitude__s, row.geolocation__longitude__s);
    if (!coord) continue;
    const [lat, lng] = coord;
    if (!inLA(lat, lng)) continue;
    points.push({ lng: +lng.toFixed(5), lat: +lat.toFixed(5) });
  }
  carrionPointsCache.set(date, { at: Date.now(), points });
  return points;
}

export async function runDeadAnimalCensus(): Promise<{
  fetched: number;
  indexed: number;
  errors: number;
}> {
  const results = { fetched: 0, indexed: 0, errors: 0 };

  const knownHexRows = await db.select({ h3Index: hexCells.h3Index }).from(hexCells);
  const knownHexSet = new Set(knownHexRows.map((r) => r.h3Index));

  const cellCounts = new Map<string, number>();

  try {
    const url = "https://data.lacity.org/resource/2cy6-i7zn.json";
    const params: Record<string, string> = {
      // The request-type field is `type`; dead-animal pickups contain "animal".
      $where: "lower(type) like '%animal%'",
      $select: "geolocation__latitude__s,geolocation__longitude__s,createddate",
      $order: "createddate DESC",
      $limit: "50000",
    };
    if (SOCRATA_APP_TOKEN) params["$$app_token"] = SOCRATA_APP_TOKEN;

    const response = await axios.get<any[]>(url, { params, timeout: 60000 });
    results.fetched = response.data?.length ?? 0;

    let minT = Infinity;
    let maxT = -Infinity;
    for (const row of response.data) {
      const coord = parseCoord(row.geolocation__latitude__s, row.geolocation__longitude__s);
      if (!coord) continue;
      const [lat, lng] = coord;
      if (!inLA(lat, lng)) continue;
      const h3 = latLngToCell(lat, lng, H3_RESOLUTION);
      if (!knownHexSet.has(h3)) continue;
      cellCounts.set(h3, (cellCounts.get(h3) ?? 0) + 1);

      const t = Date.parse(row.createddate || "");
      if (!Number.isNaN(t)) {
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
      }
    }

    await setPipelineMeta("dead_animal_window_days", spanDays(minT, maxT));
  } catch (err) {
    console.error("Dead animal census error:", err);
    results.errors++;
  }

  for (const [h3Index, count] of cellCounts.entries()) {
    await upsertHexDeadAnimals(h3Index, count);
    results.indexed++;
  }

  // Citywide per-day dead-animal counts for the prediction exchange. A separate
  // server-side aggregate (independent of the spatial census above) so the
  // "dead_animals" over/under market has a clean daily series to price against.
  try {
    const today = todayPT();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const futureCutoff = `${tomorrow.toISOString().split("T")[0]}T00:00:00.000`;

    const url = "https://data.lacity.org/resource/2cy6-i7zn.json";
    const params: Record<string, string> = {
      $select: "date_trunc_ymd(createddate) AS day, count(1) AS n",
      $where: `lower(type) like '%animal%' AND createddate < '${futureCutoff}'`,
      $group: "date_trunc_ymd(createddate)",
      $order: "day DESC",
      $limit: "1200",
    };
    if (SOCRATA_APP_TOKEN) params["$$app_token"] = SOCRATA_APP_TOKEN;

    const resp = await axios.get<any[]>(url, { params, timeout: 60000 });
    const cleaned = cleanDailyCounts(resp.data ?? [], { today });
    await upsertMetricDays("dead_animals", cleaned);
  } catch (err) {
    console.error("Dead animal history error:", err);
    results.errors++;
  }

  return results;
}

// ─── Diagnostics ───────────────────────────────────────────────────────────────

/**
 * Pokes both source APIs and reports what they actually return, plus what's
 * currently in the DB. Used to debug why the pipeline isn't populating data.
 */
export async function runDiagnostics(): Promise<Record<string, unknown>> {
  const out: Record<string, any> = { db: {}, citations: {}, wells: {} };

  try {
    const [amb] = await db.select({ c: sql<number>`count(*)::int` }).from(hexAmbient);
    const [ambWells] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(hexAmbient)
      .where(sql`oil_well_count > 0`);
    const [cit] = await db.select({ c: sql<number>`count(*)::int` }).from(citationDaily);
    out.db = {
      hexAmbientRows: amb.c,
      hexAmbientWithWells: ambWells.c,
      citationDailyRows: cit.c,
    };
  } catch (e: any) {
    out.db.error = e?.message ?? String(e);
  }

  try {
    const resp = await axios.get<any[]>("https://data.lacity.org/resource/4f5p-udkv.json", {
      params: {
        $select: "issue_date,loc_lat,loc_long",
        $where: "loc_lat IS NOT NULL AND issue_date < '2027-01-01T00:00:00.000'",
        $order: "issue_date DESC",
        $limit: "3",
      },
      timeout: 30000,
    });
    const rows = resp.data || [];
    out.citations = {
      rowsReturned: rows.length,
      latestIssueDate: rows[0]?.issue_date,
      sample: rows.map((r) => ({ loc_lat: r.loc_lat, loc_long: r.loc_long })),
    };
  } catch (e: any) {
    out.citations.error = e?.response?.status ? `HTTP ${e.response.status}` : e?.message ?? String(e);
  }

  try {
    const resp = await axios.get<any>(
      "https://gis.conservation.ca.gov/server/rest/services/WellSTAR/Wells/MapServer/0/query",
      {
        params: {
          where: "CountyName = 'Los Angeles'",
          outFields: "Latitude,Longitude,WellStatus",
          returnCountOnly: "true",
          f: "json",
        },
        timeout: 20000,
      }
    );
    out.wells = { ok: !resp.data?.error, apiError: resp.data?.error, laWellCount: resp.data?.count };
  } catch (e: any) {
    out.wells = { ok: false, error: e?.response?.status ? `HTTP ${e.response.status}` : e?.message ?? String(e) };
  }

  // Distinct LA well statuses (to choose the active/producing filter).
  try {
    const resp = await axios.get<any>(
      "https://gis.conservation.ca.gov/server/rest/services/WellSTAR/Wells/MapServer/0/query",
      {
        params: {
          where: "CountyName = 'Los Angeles'",
          outFields: "WellStatus",
          returnDistinctValues: "true",
          returnGeometry: "false",
          f: "json",
        },
        timeout: 20000,
      }
    );
    out.wellStatuses = (resp.data?.features || []).map((f: any) => f.attributes?.WellStatus);
  } catch (e: any) {
    out.wellStatuses = { error: e?.message ?? String(e) };
  }

  // Dead-animal requests (MyLA311 Cases 2026): confirm fields + exact type string.
  try {
    const base = "https://data.lacity.org/resource/2cy6-i7zn.json";
    const sample = await axios.get<any[]>(base, { params: { $limit: "1" }, timeout: 30000 });
    out.deadAnimals = {
      fields: sample.data?.[0] ? Object.keys(sample.data[0]) : [],
      sampleRow: sample.data?.[0],
    };
    try {
      const grp = await axios.get<any[]>(base, {
        params: {
          $select: "requesttype, count(1) as n",
          $where: "lower(requesttype) like '%animal%'",
          $group: "requesttype",
          $limit: "20",
        },
        timeout: 30000,
      });
      (out.deadAnimals as any).animalTypes = grp.data;
    } catch (e2: any) {
      (out.deadAnimals as any).animalTypesError = e2?.response?.status
        ? `HTTP ${e2.response.status}`
        : e2?.message ?? String(e2);
    }
  } catch (e: any) {
    out.deadAnimals = {
      error: e?.response?.status ? `HTTP ${e.response.status}` : e?.message ?? String(e),
    };
  }

  return out;
}

// ─── Pipeline summary ─────────────────────────────────────────────────────────

export async function runFullPipeline(): Promise<void> {
  console.log("[pipeline] Starting full pipeline run...");
  const t = Date.now();

  const [citations, history, makes, wells, deadAnimals] = await Promise.allSettled([
    runCitationPipeline(2),
    runCitationHistory(),
    runMakeHistory(),
    runOilWellsCensus(),
    runDeadAnimalCensus(),
  ]);

  console.log(
    `[pipeline] Done in ${Date.now() - t}ms — citations:`,
    citations.status === "fulfilled" ? citations.value : citations.reason,
    "| history:",
    history.status === "fulfilled" ? history.value : history.reason,
    "| makes:",
    makes.status === "fulfilled" ? makes.value : makes.reason,
    "| wells:",
    wells.status === "fulfilled" ? wells.value : wells.reason,
    "| deadAnimals:",
    deadAnimals.status === "fulfilled" ? deadAnimals.value : deadAnimals.reason
  );
}
