/**
 * The Parking Pulse — yesterday's citations, replayed as today.
 *
 * A birdfeeder livestream of LA's parking enforcement: we pick the freshest
 * day that actually has dense, clean, geolocated data (the dataset lags ~2
 * days and its tail is sparse junk), and serve that day's tickets as a
 * compact, time-sorted stream. The client blooms each one on the map at the
 * moment of day it was written — on LA's clock — so 8:50am yesterday lights
 * up at 8:50am today.
 *
 * No game effect; this is an ambient art piece. The shape kept here (time,
 * place, fine, violation family) is also exactly what a sound layer would
 * want, so the musical second pass won't need to re-plumb.
 */
import axios from "axios";

const DATASET = "https://data.lacity.org/resource/4f5p-udkv.json";
const SOCRATA_APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";
const UA = "la-brea-madre/pulse (skemmis@gmail.com)";

// A day is "dense enough" to replay if it has at least this many geolocated
// tickets — filters out the dataset's sparse, error-riddled recent tail.
const DENSE_MIN = 4000;
const CACHE_MS = 6 * 60 * 60 * 1000; // re-pick the donor day every 6h

// ─── Violation families: the palette of the pulse ─────────────────────────────
// Color by what the ticket is FOR. Ordered rules — first match wins — so
// "NO PARK/STREET CLEAN" reads as street cleaning, not as a no-parking zone.

export interface Family {
  key: string;
  label: string;
  color: string; // on the cream sheet, period inks
}

export const FAMILIES: Family[] = [
  { key: "street_clean", label: "STREET CLEANING", color: "#3c6e50" }, // pine
  { key: "meter", label: "EXPIRED METER", color: "#b8860b" }, // brass
  { key: "permit", label: "PERMIT & PREFERENTIAL", color: "#5a6aa0" }, // slate
  { key: "plates", label: "PLATES & REGISTRATION", color: "#86548a" }, // plum
  { key: "overtime", label: "OVERTIME & TIME LIMIT", color: "#b5742e" }, // burnt orange
  { key: "forbidden", label: "RED & FORBIDDEN ZONES", color: "#a6543c" }, // brick
  { key: "sundry", label: "SUNDRY VIOLATIONS", color: "#6b5a3e" }, // sepia
];
const FAMILY_INDEX: Record<string, number> = Object.fromEntries(
  FAMILIES.map((f, i) => [f.key, i])
);

const RULES: [string, string[]][] = [
  ["street_clean", ["STREET CLEAN", "ST CLN", "ST CLEAN", "8069"]],
  ["meter", ["METER"]],
  ["overtime", ["OVER TIME", "OVERTIME", "TIME LIMIT", "72HR", "72 HR", "EXCEED 72"]],
  ["permit", ["PREFERENTIAL", "PERMIT", "DISTRICT"]],
  ["plates", ["PLATE", "REGISTRATION", "EXPIRED REG", "TABS", "VIN", "DISPLAY OF"]],
  [
    "forbidden",
    ["RED ZONE", "FIRE HYDRANT", "WHITE ZONE", "YELLOW ZONE", "NO STOP", "NO STAND",
     "STANDING", "STANDNG", "STAND", "ANTI-GRIDLOCK", "BUS", "DOUBLE PARK", "SIDEWALK",
     "DRIVEWAY", "ALLEY", "CURB", "NO PARK"],
  ],
];

function classify(desc: string): number {
  const d = (desc || "").toUpperCase();
  for (const [key, kws] of RULES) {
    if (kws.some((k) => d.includes(k))) return FAMILY_INDEX[key];
  }
  return FAMILY_INDEX.sundry;
}

// ─── Event stream ─────────────────────────────────────────────────────────────

export interface PulseEvent {
  t: number; // seconds since LA midnight (when to bloom)
  lat: number;
  lng: number;
  fine: number; // dollars
  f: number; // family index
}

export interface PulseDay {
  day: string; // donor date, YYYY-MM-DD
  count: number;
  families: Family[];
  events: PulseEvent[];
}

/** Tiny seeded PRNG + string hash, so each donor day jitters deterministically. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function parseCoord(latRaw: unknown, lngRaw: unknown): [number, number] | null {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // The dataset carries WGS84 degrees in text; reject the (0,0) nulls and
  // anything outside a generous LA box.
  if (lat < 33.6 || lat > 34.4 || lng < -118.8 || lng > -118.05) return null;
  return [lat, lng];
}

/** HHMM string → seconds since midnight, or null if unusable. */
function timeToSeconds(raw: unknown): number | null {
  const n = parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  const hh = Math.floor(n / 100);
  const mm = n % 100;
  if (hh > 23 || mm > 59) return null;
  return hh * 3600 + mm * 60;
}

async function socrata<T>(params: Record<string, string>): Promise<T> {
  if (SOCRATA_APP_TOKEN) params["$$app_token"] = SOCRATA_APP_TOKEN;
  const res = await axios.get<T>(DATASET, { params, headers: { "User-Agent": UA }, timeout: 60000 });
  return res.data;
}

/** The newest day with dense, geolocated data — the day we replay. */
async function freshestDenseDay(): Promise<string> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const cutoff = `${tomorrow.toISOString().split("T")[0]}T00:00:00.000`;
  const rows = await socrata<any[]>({
    $select: "date_trunc_ymd(issue_date) AS day, count(1) AS n",
    $where: `loc_lat IS NOT NULL AND issue_date < '${cutoff}'`,
    $group: "date_trunc_ymd(issue_date)",
    $having: `count(1) > ${DENSE_MIN}`,
    $order: "day DESC",
    $limit: "1",
  });
  const day = rows?.[0]?.day;
  if (!day) throw new Error("no dense citation day found");
  return String(day).split("T")[0];
}

/** Build the replay stream for one donor day. */
async function buildDay(day: string): Promise<PulseDay> {
  const rows = await socrata<any[]>({
    $select: "issue_time,loc_lat,loc_long,fine_amount,violation_description",
    $where: `loc_lat IS NOT NULL AND issue_date = '${day}T00:00:00.000'`,
    $limit: "50000",
  });

  // The data's resolution is HHMM, so we scatter each ticket to a RANDOM
  // second within its true minute rather than spreading them evenly. Even
  // spacing sounded metronomic; random offsets give the clusters, gaps, and
  // overlapping notes that make Music-for-Airports breathe. Seeded by the
  // donor day so the same day always replays identically.
  const rng = mulberry32(hashStr(day));
  const events: PulseEvent[] = [];
  for (const r of rows) {
    const secs = timeToSeconds(r.issue_time);
    if (secs === null) continue;
    const coord = parseCoord(r.loc_lat, r.loc_long);
    if (!coord) continue;
    const fine = Math.max(0, Math.round(Number(r.fine_amount) || 0));
    const minuteStart = secs - (secs % 60);
    events.push({
      t: minuteStart + Math.floor(rng() * 60),
      lat: Math.round(coord[0] * 1e5) / 1e5,
      lng: Math.round(coord[1] * 1e5) / 1e5,
      fine,
      f: classify(r.violation_description),
    });
  }
  events.sort((a, b) => a.t - b.t);

  return { day, count: events.length, families: FAMILIES, events };
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let cache: { at: number; data: PulseDay } | null = null;
let inflight: Promise<PulseDay> | null = null;

export async function getPulseDay(): Promise<PulseDay> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const day = await freshestDenseDay();
      // Same donor day still current? Keep the built stream, refresh the clock.
      if (cache && cache.data.day === day) {
        cache = { at: Date.now(), data: cache.data };
        return cache.data;
      }
      const data = await buildDay(day);
      cache = { at: Date.now(), data };
      return data;
    } catch (err) {
      if (cache) return cache.data; // serve stale rather than fail the stream
      throw err;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
