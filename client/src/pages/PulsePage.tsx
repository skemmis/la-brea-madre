/**
 * THE PARKING PULSE — a birdfeeder livestream of LA enforcement.
 *
 * The freshest dense day of real parking citations, replayed on the vintage
 * sheet at 1:1 on Los Angeles time: a ticket written at 8:50am pops up at
 * 8:50am today. Quiet at 3am, a dawn surge when the street sweepers run.
 * Blooms are colored by what the ticket was for, sized by the fine. No
 * controls, no speed — it just runs, like watching a feeder.
 */
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Link } from "wouter";
import { apiRequest } from "../lib/queryClient";
import { SHEET_STYLE, INITIAL_CENTER, INITIAL_ZOOM } from "../lib/sheetStyle";

interface Family { key: string; label: string; color: string }
interface PulseEvent { t: number; lat: number; lng: number; fine: number; f: number }
interface PulseDay { day: string; count: number; families: Family[]; events: PulseEvent[] }

const BLOOM_MS = 6500; // how long each ticket's bloom lingers, like drying ink

/** Current Los Angeles wall-clock as seconds since LA midnight. */
function laSecondsNow(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  let h = get("hour");
  if (h === 24) h = 0; // some engines render midnight as 24
  return h * 3600 + get("minute") * 60 + get("second");
}

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const clock = (secs: number) => {
  const h = Math.floor(secs / 3600) % 24;
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
};

/** First index with events[i].t >= target (binary search; events sorted by t). */
function lowerBound(events: PulseEvent[], target: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export default function PulsePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dayRef = useRef<PulseDay | null>(null);

  const [day, setDay] = useState<PulseDay | null>(null);
  const [err, setErr] = useState(false);
  // Live readouts (updated ~1/s, not every frame, to spare React).
  const [readout, setReadout] = useState({ now: 0, written: 0 });
  const [latest, setLatest] = useState<{ fine: number; fam: number; t: number } | null>(null);

  const load = async () => {
    try {
      const d = await apiRequest<PulseDay>("GET", "/api/pulse/day");
      dayRef.current = d;
      setDay(d);
      setErr(false);
    } catch {
      setErr(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // The base map — the same vintage sheet the game prints on.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: SHEET_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      minZoom: 8.8,
      maxZoom: 14,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    // A deploy or cold start can sever a GeoJSON fetch mid-flight; MapLibre
    // won't retry on its own. Re-request failed sources a few times.
    const retries: Record<string, number> = {};
    map.on("error", (e: any) => {
      const id: string | undefined = e?.sourceId;
      if (!id) return;
      const n = retries[id] ?? 0;
      if (n >= 3) return;
      retries[id] = n + 1;
      setTimeout(() => {
        const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
        const data = (SHEET_STYLE.sources as any)[id]?.data;
        if (src && typeof data === "string") src.setData(data);
      }, 2000 * (n + 1));
    });
    // The container can measure 0 on first paint; force a resize once laid out.
    map.on("load", () => map.resize());
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current!);

    mapRef.current = map;
    if (import.meta.env.DEV) (window as any).__map = map;
    return () => {
      ro.disconnect();
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // The animator: a canvas over the map, blooming each ticket as the LA clock
  // crosses its moment. Runs entirely off requestAnimationFrame.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let cursor = -1; // next event index not yet spawned (-1 = needs seek)
    let lastNow = -1;
    let lastReadout = 0;

    type Live = { ev: PulseEvent; born: number };
    let active: Live[] = [];
    const rgb = (f: number) => hexToRgb(dayRef.current?.families[f]?.color ?? "#6b5a3e");

    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    window.addEventListener("resize", fit);

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const data = dayRef.current;
      const map = mapRef.current;
      if (!data || !map) return;
      const events = data.events;
      const now = laSecondsNow();

      // First run, or midnight rollover (clock jumped backwards): seek to the
      // present without replaying the whole morning, and refresh the donor day.
      if (cursor === -1 || now < lastNow - 5) {
        if (cursor !== -1) load(); // a new day has begun — fetch the new donor
        cursor = lowerBound(events, now);
        active = [];
      }
      lastNow = now;

      // Spawn everything whose moment has arrived since the last frame.
      const perf = performance.now();
      while (cursor < events.length && events[cursor].t <= now) {
        const ev = events[cursor];
        active.push({ ev, born: perf });
        setLatest({ fine: ev.fine, fam: ev.f, t: ev.t });
        cursor++;
      }

      // Draw the living blooms.
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      const next: Live[] = [];
      for (const live of active) {
        const age = (perf - live.born) / BLOOM_MS;
        if (age >= 1) continue;
        next.push(live);
        const { x, y } = map.project([live.ev.lng, live.ev.lat]);
        if (x < -40 || y < -40 || x > canvas.clientWidth + 40 || y > canvas.clientHeight + 40) continue;
        const [r, g, b] = rgb(live.ev.f);
        const base = 6 + Math.min(18, live.ev.fine / 12); // bigger fine, bigger mark
        const ease = 1 - Math.pow(1 - age, 3); // fast out, slow settle

        // Expanding stamp ring.
        ctx.beginPath();
        ctx.arc(x, y, base * (0.4 + ease * 1.6), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - age) * 0.5})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // The ink dot itself, blooming then fading.
        ctx.beginPath();
        ctx.arc(x, y, base * (0.5 + ease * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${(1 - age) * 0.8})`;
        ctx.fill();
      }
      active = next;

      // Cheap readouts ~1/s.
      if (perf - lastReadout > 1000) {
        lastReadout = perf;
        setReadout({ now, written: lowerBound(events, now + 1) });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, []);

  const families = day?.families ?? [];

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#ece4d0]">
      <div ref={containerRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />

      {/* Masthead cartouche */}
      <div className="plate absolute top-4 left-4 px-4 py-3 select-none max-w-xs">
        <div className="text-base font-bold" style={{ letterSpacing: "0.3em" }}>
          THE PARKING PULSE
        </div>
        <div className="text-[9px] mt-1 opacity-70 leading-relaxed" style={{ letterSpacing: "0.12em" }}>
          THE CITY TICKETS, LIVE ON LOS ANGELES TIME.
          <br />
          {day ? (
            <>REPLAYING {day.day} · {day.count.toLocaleString()} CITATIONS</>
          ) : err ? (
            "THE COUNTY IS QUIET…"
          ) : (
            "UNROLLING THE LEDGER…"
          )}
        </div>
        <div className="mt-2 text-2xl font-bold tabular-nums" style={{ letterSpacing: "0.1em" }}>
          {clock(readout.now)}
        </div>
        <div className="text-[9px] opacity-70" style={{ letterSpacing: "0.15em" }}>
          {readout.written.toLocaleString()} WRITTEN SINCE MIDNIGHT
        </div>
      </div>

      {/* Legend */}
      <div className="plate absolute bottom-4 left-4 px-3 py-2.5 select-none">
        <div className="text-[8px] mb-1.5 opacity-60" style={{ letterSpacing: "0.25em" }}>
          THE VIOLATIONS
        </div>
        {families.map((f) => (
          <div key={f.key} className="flex items-center gap-2 text-[9px]" style={{ letterSpacing: "0.08em" }}>
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: f.color }}
            />
            {f.label}
          </div>
        ))}
      </div>

      {/* Heartbeat: the most recent ticket */}
      {latest && (
        <div className="plate absolute bottom-4 right-4 px-3 py-2.5 text-right select-none">
          <div className="text-[8px] opacity-60" style={{ letterSpacing: "0.25em" }}>
            LATEST
          </div>
          <div className="text-[11px] font-bold" style={{ letterSpacing: "0.08em", color: families[latest.fam]?.color }}>
            {families[latest.fam]?.label ?? "—"}
          </div>
          <div className="text-[9px] opacity-70 tabular-nums">
            ${latest.fine} · {clock(latest.t)}
          </div>
        </div>
      )}

      <Link
        href="/"
        className="absolute top-4 right-4 plate px-3 py-1.5 text-[9px] hover:opacity-100 opacity-70"
        style={{ letterSpacing: "0.2em" }}
      >
        ← THE FLOOR
      </Link>
    </div>
  );
}
