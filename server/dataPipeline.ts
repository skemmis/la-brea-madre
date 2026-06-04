/**
 * Data pipeline: pulls LA open data and indexes it into H3 cells.
 * - Parking citations from LA Socrata (4f5p-udkv)
 * - Oil wells from CalGEM (WellSTAR)
 */
import axios from "axios";
import proj4 from "proj4";
import { latLngToCell } from "h3-js";
import { db } from "./db";
import { citationDaily, hexAmbient, hexCells } from "@shared/schema";
import { upsertHexWells, upsertHexDeadAnimals, upsertCitationDaily } from "./storage";
import { eq, sql } from "drizzle-orm";

const H3_RESOLUTION = 7;
const SOCRATA_APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";

// California State Plane Zone 5 (EPSG:2229, NAD83, US survey feet) — the
// projection LA's older coordinate fields use. We reproject to WGS84.
const STATE_PLANE_5 =
  "+proj=lcc +lat_1=35.46666666666667 +lat_2=34.03333333333333 " +
  "+lat_0=33.5 +lon_0=-118 +x_0=2000000.0001016 +y_0=500000.0001016001 " +
  "+datum=NAD83 +units=us-ft +no_defs";

const LA_LAT = [33, 35] as const;
const LA_LNG = [-119.5, -117] as const;

function inLA(lat: number, lng: number): boolean {
  return lat >= LA_LAT[0] && lat <= LA_LAT[1] && lng >= LA_LNG[0] && lng <= LA_LNG[1];
}

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
    }

    // Replace today's snapshot (idempotent re-runs).
    await db.delete(citationDaily).where(eq(citationDaily.date, storeDate));

    for (const [h3Index, data] of cellMap.entries()) {
      await upsertCitationDaily(h3Index, storeDate, data.count, data.totalFine, data.makes.size);
      results.processed++;
    }
  } catch (err) {
    console.error("Citation pipeline error:", err);
    results.errors++;
  }

  return results;
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

  for (const [h3Index, wellCount] of cellWellCounts.entries()) {
    await upsertHexWells(h3Index, wellCount);
    results.indexed++;
  }

  return results;
}

// ─── Dead Animal Reports (MyLA311 Cases 2026) ──────────────────────────────────

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
      $select: "geolocation__latitude__s,geolocation__longitude__s",
      $order: "createddate DESC",
      $limit: "50000",
    };
    if (SOCRATA_APP_TOKEN) params["$$app_token"] = SOCRATA_APP_TOKEN;

    const response = await axios.get<any[]>(url, { params, timeout: 60000 });
    results.fetched = response.data?.length ?? 0;

    for (const row of response.data) {
      const coord = parseCoord(row.geolocation__latitude__s, row.geolocation__longitude__s);
      if (!coord) continue;
      const [lat, lng] = coord;
      if (!inLA(lat, lng)) continue;
      const h3 = latLngToCell(lat, lng, H3_RESOLUTION);
      if (!knownHexSet.has(h3)) continue;
      cellCounts.set(h3, (cellCounts.get(h3) ?? 0) + 1);
    }
  } catch (err) {
    console.error("Dead animal census error:", err);
    results.errors++;
  }

  for (const [h3Index, count] of cellCounts.entries()) {
    await upsertHexDeadAnimals(h3Index, count);
    results.indexed++;
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

  const [citations, wells, deadAnimals] = await Promise.allSettled([
    runCitationPipeline(2),
    runOilWellsCensus(),
    runDeadAnimalCensus(),
  ]);

  console.log(
    `[pipeline] Done in ${Date.now() - t}ms — citations:`,
    citations.status === "fulfilled" ? citations.value : citations.reason,
    "| wells:",
    wells.status === "fulfilled" ? wells.value : wells.reason,
    "| deadAnimals:",
    deadAnimals.status === "fulfilled" ? deadAnimals.value : deadAnimals.reason
  );
}
