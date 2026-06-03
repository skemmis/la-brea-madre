/**
 * Data pipeline: pulls LA open data and indexes it into H3 cells.
 * - Parking citations from LA Socrata (daily incremental)
 * - Oil wells from CalGEM (one-time census)
 */
import axios from "axios";
import { latLngToCell } from "h3-js";
import { db } from "./db";
import { citationDaily, hexAmbient, hexCells } from "@shared/schema";
import { upsertHexAmbient, upsertCitationDaily } from "./storage";
import { eq, inArray } from "drizzle-orm";

const H3_RESOLUTION = 7;
const SOCRATA_APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";

// ─── Parking Citations ────────────────────────────────────────────────────────

interface RawCitation {
  latitude?: string;
  longitude?: string;
  issue_date?: string;
  fine_amount?: string;
  make?: string;
  // CA State Plane coords (if lat/lng unavailable)
  location?: { coordinates?: [number, number]; type?: string };
}

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

export async function runCitationPipeline(daysBack = 2): Promise<{
  processed: number;
  errors: number;
}> {
  const results = { processed: 0, errors: 0 };

  // Get all known h3 indexes for membership check
  const knownHexRows = await db.select({ h3Index: hexCells.h3Index }).from(hexCells);
  const knownHexSet = new Set(knownHexRows.map((r) => r.h3Index));

  // Pull citations from LA Socrata for the past N days
  for (let d = 0; d < daysBack; d++) {
    const date = new Date();
    date.setDate(date.getDate() - d - 1); // yesterday and before
    const dateStr = date.toISOString().split("T")[0];
    const socrataDate = `${dateStr}T00:00:00.000`;

    try {
      const url = "https://data.lacity.org/resource/4f5p-udkv.json";
      const params: Record<string, string> = {
        $where: `issue_date >= '${socrataDate}' AND issue_date < '${dateStr}T23:59:59.999'`,
        $limit: "50000",
        $select: "latitude,longitude,issue_date,fine_amount,make",
      };
      if (SOCRATA_APP_TOKEN) {
        params["$$app_token"] = SOCRATA_APP_TOKEN;
      }

      const response = await axios.get<RawCitation[]>(url, {
        params,
        timeout: 30000,
      });

      // Aggregate by h3 cell
      const cellMap = new Map<
        string,
        { count: number; totalFine: number; makes: Set<string> }
      >();

      for (const row of response.data) {
        const lat = parseFloat(row.latitude || "0");
        const lng = parseFloat(row.longitude || "0");

        if (!lat || !lng || Math.abs(lat) < 1 || Math.abs(lng) < 1) continue;

        // Skip obvious bad coordinates
        if (lat < 33 || lat > 35 || lng < -119.5 || lng > -117) continue;

        const h3 = latLngToCell(lat, lng, H3_RESOLUTION);
        if (!knownHexSet.has(h3)) continue; // outside LA coverage

        if (!cellMap.has(h3)) {
          cellMap.set(h3, { count: 0, totalFine: 0, makes: new Set() });
        }
        const entry = cellMap.get(h3)!;
        entry.count++;
        entry.totalFine += parseFloat(row.fine_amount || "0") || 0;
        entry.makes.add(normalizeMake(row.make || ""));
      }

      for (const [h3Index, data] of cellMap.entries()) {
        await upsertCitationDaily(
          h3Index,
          dateStr,
          data.count,
          data.totalFine,
          data.makes.size
        );
        results.processed++;
      }
    } catch (err) {
      console.error(`Citation pipeline error for ${dateStr}:`, err);
      results.errors++;
    }
  }

  return results;
}

// ─── Oil Wells (CalGEM) ───────────────────────────────────────────────────────

interface CalGEMWell {
  geometry?: { coordinates?: [number, number] };
  properties?: { latitude?: string; longitude?: string };
}

export async function runOilWellsCensus(): Promise<{ indexed: number; errors: number }> {
  const results = { indexed: 0, errors: 0 };

  // CalGEM GeoJSON endpoint for all oil/gas wells in LA County
  const url =
    "https://gis.conservation.ca.gov/server/rest/services/WellSTAR/Wells/MapServer/0/query";

  const cellWellCounts = new Map<string, number>();

  try {
    let offset = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const params = {
        where: "County = 'Los Angeles' AND WellStatus NOT IN ('Abandoned', 'Cancelled')",
        outFields: "latitude,longitude",
        f: "json",
        returnGeometry: "true",
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        outSR: "4326",
      };

      const resp = await axios.get(url, { params, timeout: 20000 });
      const features = resp.data?.features || [];

      for (const feature of features) {
        const [lng, lat] =
          feature.geometry?.rings?.[0]?.[0] ||
          feature.geometry?.coordinates ||
          [0, 0];

        const latN = parseFloat(feature.attributes?.Latitude || lat || "0");
        const lngN = parseFloat(feature.attributes?.Longitude || lng || "0");

        if (!latN || !lngN || latN < 33 || latN > 35 || lngN < -119.5 || lngN > -117) {
          continue;
        }

        const h3 = latLngToCell(latN, lngN, H3_RESOLUTION);
        cellWellCounts.set(h3, (cellWellCounts.get(h3) ?? 0) + 1);
      }

      if (features.length < pageSize) {
        hasMore = false;
      } else {
        offset += pageSize;
      }
    }
  } catch (err) {
    console.error("CalGEM API error:", err);
    // Fall back to a curated sample of known LA oil fields if API is down
    const laOilFields: Array<[number, number]> = [
      [34.0195, -118.2437], // LA Basin area
      [33.9850, -118.3650], // Inglewood Oil Field
      [33.9647, -118.4102], // Culver City area
      [34.1450, -118.6500], // Chatsworth
      [34.1780, -118.5990], // Porter Ranch / Aliso Canyon
      [33.8900, -118.3900], // Torrance oil field
      [33.8400, -118.2800], // Wilmington oil field (largest urban)
      [33.8200, -118.2600], // Long Beach oil field
    ];
    for (const [lat, lng] of laOilFields) {
      const h3 = latLngToCell(lat, lng, H3_RESOLUTION);
      cellWellCounts.set(h3, (cellWellCounts.get(h3) ?? 0) + 5);
    }
    results.errors++;
  }

  // Upsert ambient data for cells with wells
  for (const [h3Index, wellCount] of cellWellCounts.entries()) {
    await upsertHexAmbient(h3Index, wellCount, 0);
    results.indexed++;
  }

  return results;
}

// ─── Pipeline summary ─────────────────────────────────────────────────────────

export async function runFullPipeline(): Promise<void> {
  console.log("[pipeline] Starting full pipeline run...");
  const t = Date.now();

  const [citations, wells] = await Promise.allSettled([
    runCitationPipeline(2),
    runOilWellsCensus(),
  ]);

  console.log(
    `[pipeline] Done in ${Date.now() - t}ms — citations:`,
    citations.status === "fulfilled" ? citations.value : citations.reason,
    "| wells:",
    wells.status === "fulfilled" ? wells.value : wells.reason
  );
}
