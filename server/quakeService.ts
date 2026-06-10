/**
 * Quake service — the Madre's seismograph.
 *
 * Polls the USGS realtime feed (free, keyless) for quakes near the basin,
 * journals them, and keeps a daily metric series ("quakes", M1.5+ count) for
 * the exchange. The daily tick turns unapplied quakes into damage events on
 * owned parcels via the pure quakeMath falloff; the map shows the last 48h
 * of shaking as a heat overlay.
 */
import axios from "axios";
import { pool } from "./db";
import { upsertMetricDay } from "./storage";
import { cellToLatLng } from "h3-js";
import { distanceKm, quakeDamageAt, quakeRadiusKm, quakePeakDamage } from "./quakeMath";

const CENTER = { lat: 34.05, lng: -118.4 };
const RADIUS_KM = 60; // poll window: the basin and its faults, incl. offshore
const MIN_MAG = 1.5;

function todayPT(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .split("T")[0];
}

export async function ensureQuakeTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS quake (
       id text PRIMARY KEY,
       mag real NOT NULL,
       lat double precision NOT NULL,
       lng double precision NOT NULL,
       place text,
       occurred_at timestamptz NOT NULL,
       applied boolean NOT NULL DEFAULT false
     )`
  );
}

/** Pull the last 7 days from USGS and journal anything new. */
export async function pollQuakes(): Promise<{ fetched: number; inserted: number }> {
  const start = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&latitude=${CENTER.lat}&longitude=${CENTER.lng}&maxradiuskm=${RADIUS_KM}` +
    `&starttime=${start}&minmagnitude=${MIN_MAG}`;
  const resp = await axios.get(url, { timeout: 30000 });
  const features: any[] = resp.data?.features ?? [];

  let inserted = 0;
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    const r = await pool.query(
      `INSERT INTO quake (id, mag, lat, lng, place, occurred_at)
       VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0))
       ON CONFLICT (id) DO NOTHING`,
      [f.id, f.properties.mag, lat, lng, f.properties.place ?? null, f.properties.time]
    );
    inserted += r.rowCount ?? 0;
  }

  // Daily series for the exchange: quakes per PT day, today included (the
  // market settles on "did the Madre stir", so same-day counts matter).
  const { rows } = await pool.query(
    `SELECT to_char(occurred_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') AS day,
            count(*) AS n
     FROM quake
     WHERE occurred_at > now() - interval '40 days'
     GROUP BY 1`
  );
  const byDay = new Map<string, number>((rows as any[]).map((r) => [r.day, Number(r.n)]));
  // Quiet days are real zeros — fill the calendar so odds price honestly.
  for (let i = 34; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000)
      .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
      .split("T")[0];
    if (d > todayPT()) continue;
    await upsertMetricDay("quakes", d, byDay.get(d) ?? 0);
  }

  return { fetched: features.length, inserted };
}

export interface QuakeDamageEvent {
  h3: string;
  damage: number;
}

/**
 * Turn unapplied quakes into per-parcel damage for the tick, then mark them
 * applied. Damage only lands on the given (owned) parcels — the Madre's
 * maintenance bill goes to landlords.
 */
export async function consumeQuakeDamage(ownedH3: string[]): Promise<QuakeDamageEvent[]> {
  if (!ownedH3.length) return [];
  const { rows } = await pool.query(`SELECT * FROM quake WHERE applied = false`);
  if (!rows.length) return [];

  const centers = ownedH3.map((h) => {
    const [lat, lng] = cellToLatLng(h);
    return { h3: h, lat, lng };
  });

  const damage = new Map<string, number>();
  for (const q of rows as any[]) {
    for (const c of centers) {
      const d = distanceKm(q.lat, q.lng, c.lat, c.lng);
      const dmg = quakeDamageAt(d, q.mag);
      if (dmg > 0) damage.set(c.h3, (damage.get(c.h3) ?? 0) + dmg);
    }
  }
  await pool.query(`UPDATE quake SET applied = true WHERE applied = false`);

  return [...damage.entries()].map(([h3, dmg]) => ({ h3, damage: dmg }));
}

/**
 * Per-hex shake heat over the trailing window: the summed damage each cell
 * would take from every journaled quake — the seismic layer's metric.
 */
export async function shakeByHex(h3s: string[], days = 30): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!h3s.length) return out;
  const quakes = await recentQuakes(days);
  if (!quakes.length) return out;

  const centers = h3s.map((h) => {
    const [lat, lng] = cellToLatLng(h);
    return { h3: h, lat, lng };
  });
  for (const q of quakes) {
    const rKm = q.radiusKm;
    const latPad = rKm / 111;
    const lngPad = rKm / 92;
    for (const c of centers) {
      // Cheap box reject before the haversine.
      if (Math.abs(c.lat - q.lat) > latPad || Math.abs(c.lng - q.lng) > lngPad) continue;
      const dmg = quakeDamageAt(distanceKm(q.lat, q.lng, c.lat, c.lng), q.mag);
      if (dmg > 0) out.set(c.h3, (out.get(c.h3) ?? 0) + dmg);
    }
  }
  return out;
}

export interface QuakeView {
  id: string;
  mag: number;
  lat: number;
  lng: number;
  place: string | null;
  occurredAt: string;
  radiusKm: number;
  peakDamage: number;
  applied: boolean;
}

/** Recent shaking for the map: default the last 48h, up to 35 days. */
export async function recentQuakes(days = 2): Promise<QuakeView[]> {
  const d = Math.min(35, Math.max(1, days));
  const { rows } = await pool.query(
    `SELECT * FROM quake WHERE occurred_at > now() - ($1 || ' days')::interval ORDER BY occurred_at DESC`,
    [String(d)]
  );
  return (rows as any[]).map((q) => ({
    id: q.id,
    mag: Number(q.mag),
    lat: q.lat,
    lng: q.lng,
    place: q.place,
    occurredAt: q.occurred_at.toISOString(),
    radiusKm: quakeRadiusKm(Number(q.mag)),
    peakDamage: quakePeakDamage(Number(q.mag)),
    applied: q.applied,
  }));
}
