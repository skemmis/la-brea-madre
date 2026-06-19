/**
 * THE PARKING PULSE — a birdfeeder livestream of LA enforcement.
 *
 * The freshest dense day of real parking citations, replayed on the vintage
 * sheet at 1:1 on Los Angeles time: a ticket written at 8:50am pops up at
 * 8:50am today. Quiet at 3am, a dawn surge when the street sweepers run.
 * Blooms are colored by what the ticket was for, sized by the fine.
 *
 * Alongside the map: a running feed of the last dozen, two hourly trend
 * graphs ($/hour and tickets/hour across the 24-hour day), and an optional
 * generative ambient score (see pulseAudio.ts) — started by a click, because
 * browsers forbid autoplay.
 */
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { apiRequest } from "../lib/queryClient";
import { SHEET_STYLE, INITIAL_CENTER, INITIAL_ZOOM } from "../lib/sheetStyle";
import { PulseAudio, DIALS } from "../lib/pulseAudio";

interface Family { key: string; label: string; color: string }
interface PulseEvent { t: number; lat: number; lng: number; fine: number; f: number }
interface PulseDay { day: string; count: number; families: Family[]; events: PulseEvent[] }
interface FeedItem { fine: number; fam: number; t: number; id: number }
interface Bins { dollars: number[]; count: number[]; maxD: number; maxC: number; nowHour: number }

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
  if (h === 24) h = 0;
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

// ─── A vintage bar chart, fixed to the 24-hour day ───────────────────────────
function HourBars({
  values, max, color, nowHour, label, total,
}: { values: number[]; max: number; color: string; nowHour: number; label: string; total: string }) {
  const W = 300;
  const H = 78;
  const gap = 2;
  const bw = (W - gap * 23) / 24;
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-[11px] font-bold" style={{ letterSpacing: "0.18em", color: "var(--ink)" }}>{label}</span>
        <span className="text-[13px] font-bold tabular-nums" style={{ color }}>{total}</span>
      </div>
      <svg width={W} height={H} style={{ display: "block", width: "100%" }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {values.map((v, h) => {
          const bh = max > 0 ? (v / max) * (H - 2) : 0;
          const future = h > nowHour;
          return (
            <rect
              key={h}
              x={h * (bw + gap)}
              y={H - bh}
              width={bw}
              height={Math.max(future ? 0 : 0.8, bh)}
              fill={color}
              opacity={future ? 0.1 : h === nowHour ? 0.55 : 0.85}
            />
          );
        })}
        {/* noon tick */}
        <rect x={12 * (bw + gap) - gap / 2} y={0} width={0.6} height={H} fill={color} opacity={0.2} />
      </svg>
    </div>
  );
}

// ─── The mixing desk: in-app dials for the score ──────────────────────────────

// Numeric knobs: [DIALS key, label, min, max, step].
const KNOBS: [keyof typeof DIALS, string, number, number, number][] = [
  ["masterGain", "MASTER VOLUME", 0, 1, 0.01],
  ["notePeak", "NOTE LOUDNESS", 0, 0.5, 0.01],
  ["noteAttack", "NOTE ATTACK (s)", 0.1, 6, 0.1],
  ["noteRelease", "NOTE RELEASE (s)", 0.5, 12, 0.1],
  ["voiceCap", "MAX NOTES AT ONCE", 1, 24, 1],
  ["shimmerFineThreshold", "OCTAVE-UP ABOVE $", 0, 400, 5],
  ["reverbWet", "REVERB WETNESS", 0, 1, 0.01],
  ["reverbSeconds", "REVERB TAIL (s)", 1, 10, 0.5],
  ["reverbDecay", "REVERB DECAY SHAPE", 1, 8, 0.5],
  ["droneGainMin", "DRONE — QUIET", 0, 1, 0.01],
  ["droneGainMax", "DRONE — BUSY", 0, 1, 0.01],
  ["droneCutoffMin", "DRONE TONE — QUIET (Hz)", 60, 800, 10],
  ["droneCutoffMax", "DRONE TONE — BUSY (Hz)", 60, 1200, 10],
  ["densityFull", "TICKETS/HR = FULL", 50, 1200, 10],
  ["droneGlide", "DRONE GLIDE (s)", 0.5, 15, 0.5],
  ["breathRate", "BREATH RATE (Hz)", 0.01, 0.3, 0.005],
  ["breathDepth", "BREATH DEPTH", 0, 0.2, 0.005],
];

// Note choices, D-major pentatonic across the useful register (Hz).
const PENT: { label: string; hz: number }[] = [
  ["D2", 73.42], ["E2", 82.41], ["F#2", 92.5], ["A2", 110], ["B2", 123.47],
  ["D3", 146.83], ["E3", 164.81], ["F#3", 185], ["A3", 220], ["B3", 246.94],
  ["D4", 293.66], ["E4", 329.63], ["F#4", 369.99], ["A4", 440], ["B4", 493.88],
  ["D5", 587.33],
].map(([label, hz]) => ({ label: label as string, hz: hz as number }));

function Knob({ k, label, min, max, step, onChange }: {
  k: keyof typeof DIALS; label: string; min: number; max: number; step: number; onChange: () => void;
}) {
  const v = DIALS[k] as number;
  const show = step >= 1 ? v.toString() : v.toFixed(step < 0.02 ? 3 : 2);
  return (
    <label className="block mb-2.5">
      <div className="flex justify-between text-[10px] mb-0.5" style={{ letterSpacing: "0.1em", color: "var(--ink)" }}>
        <span className="opacity-70">{label}</span>
        <span className="tabular-nums font-bold">{show}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={v}
        onChange={(e) => { (DIALS as any)[k] = parseFloat(e.target.value); onChange(); }}
        className="w-full"
        style={{ accentColor: "var(--ink)" }}
      />
    </label>
  );
}

export default function PulsePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dayRef = useRef<PulseDay | null>(null);
  const prefixRef = useRef<{ cumD: number[]; fullD: number[]; fullC: number[]; maxD: number; maxC: number } | null>(null);
  const audioRef = useRef<PulseAudio | null>(null);
  const feedRef = useRef<FeedItem[]>([]);
  const feedId = useRef(0);

  const [day, setDay] = useState<PulseDay | null>(null);
  const [, setErr] = useState(false);
  const [readout, setReadout] = useState({ now: 0, written: 0 });
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [bins, setBins] = useState<Bins | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [showTune, setShowTune] = useState(false);
  const [, setTuneVer] = useState(0); // bump to re-render sliders after a change
  const [copied, setCopied] = useState(false);

  // A dial moved: push it into the live audio and re-render the controls.
  const applyTune = () => {
    audioRef.current?.applyDials();
    setTuneVer((v) => v + 1);
  };
  const exportDials = () => {
    const text = JSON.stringify(DIALS, null, 2);
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => {}
    );
  };

  const load = async () => {
    try {
      const d = await apiRequest<PulseDay>("GET", "/api/pulse/day");
      // Precompute prefix sums + full-day hourly maxima for fixed-scale graphs.
      const cumD = new Array(d.events.length + 1).fill(0);
      for (let i = 0; i < d.events.length; i++) cumD[i + 1] = cumD[i] + d.events[i].fine;
      const fullD = new Array(24).fill(0);
      const fullC = new Array(24).fill(0);
      for (const e of d.events) {
        const h = Math.min(23, Math.floor(e.t / 3600));
        fullD[h] += e.fine;
        fullC[h] += 1;
      }
      prefixRef.current = {
        cumD, fullD, fullC,
        maxD: Math.max(1, ...fullD),
        maxC: Math.max(1, ...fullC),
      };
      dayRef.current = d;
      setDay(d);
      setErr(false);
    } catch {
      setErr(true);
    }
  };

  useEffect(() => {
    load();
    return () => audioRef.current?.stop();
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
  // crosses its moment, feeding the ticker and (if on) the music.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let cursor = -1;
    let lastNow = -1;
    let vib = 0; // smoothed audio level driving the line tremble

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

      if (cursor === -1 || now < lastNow - 5) {
        if (cursor !== -1) load();
        cursor = lowerBound(events, now);
        active = [];
      }
      lastNow = now;

      const perf = performance.now();
      let spawned = false;
      while (cursor < events.length && events[cursor].t <= now) {
        const ev = events[cursor];
        active.push({ ev, born: perf });
        feedRef.current.unshift({ fine: ev.fine, fam: ev.f, t: ev.t, id: feedId.current++ });
        audioRef.current?.note(ev.f, ev.fine);
        cursor++;
        spawned = true;
      }
      if (spawned) {
        feedRef.current = feedRef.current.slice(0, 12);
        setFeed(feedRef.current.slice());
      }

      // The sound's loudness makes every line tremble; even silent, a faint
      // hand-drawn quiver keeps the ink alive.
      const lvl = audioRef.current?.level() ?? 0;
      vib += (lvl - vib) * 0.2; // smoothed
      const t = perf / 1000;

      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.lineJoin = "round";
      const next: Live[] = [];
      for (const live of active) {
        const age = (perf - live.born) / BLOOM_MS;
        if (age >= 1) continue;
        next.push(live);
        const { x, y } = map.project([live.ev.lng, live.ev.lat]);
        if (x < -60 || y < -60 || x > canvas.clientWidth + 60 || y > canvas.clientHeight + 60) continue;
        const [r, g, b] = rgb(live.ev.f);
        const base = 7 + Math.min(20, live.ev.fine / 11);
        const seed = live.ev.t; // stable per ticket, so each ripple has its own hand

        // Three concentric ripples, each launched a beat after the last and
        // drawn as an imperfect, trembling circle — engraved, not stamped.
        for (let ring = 0; ring < 3; ring++) {
          const p = age * 1.35 - ring * 0.16;
          if (p <= 0 || p >= 1) continue;
          const ease = 1 - Math.pow(1 - p, 2.2);
          const radius = base * (0.3 + ease * 2.3);
          const fade = (1 - p) * (1 - ring * 0.18);
          if (fade <= 0.02) continue;

          // Wobble: two summed sines (a hand can't draw a true circle), with
          // amplitude swelling on the music. Lobe counts differ per ring.
          const lobesA = 5 + ring;
          const lobesB = 8 + ring * 2;
          const amp = radius * (0.04 + 0.018 * ring) + (1.5 + vib * 9) + radius * vib * 0.12;
          const phase = seed * (0.7 + ring) + t * (0.6 + ring * 0.25);

          ctx.beginPath();
          const STEPS = 56;
          for (let i = 0; i <= STEPS; i++) {
            const a = (i / STEPS) * Math.PI * 2;
            const w =
              amp * Math.sin(lobesA * a + phase) +
              amp * 0.45 * Math.sin(lobesB * a - phase * 1.3);
            const rr = radius + w;
            const px = x + Math.cos(a) * rr;
            const py = y + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = `rgba(${r},${g},${b},${fade * 0.6})`;
          ctx.lineWidth = 1.1;
          ctx.stroke();
        }
      }
      active = next;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, []);

  // Trend graphs + readouts + the drone's density, recomputed every few seconds.
  useEffect(() => {
    if (!day) return;
    const events = day.events;
    const tick = () => {
      const pre = prefixRef.current;
      if (!pre) return;
      const now = laSecondsNow();
      const idxUpTo = (sec: number) => lowerBound(events, sec);
      const written = idxUpTo(now + 1);
      setReadout({ now, written });

      const nowHour = Math.floor(now / 3600);
      const dollars: number[] = [];
      const count: number[] = [];
      for (let h = 0; h < 24; h++) {
        const start = h * 3600;
        const end = Math.min((h + 1) * 3600, now);
        if (start >= now) {
          dollars.push(0);
          count.push(0);
          continue;
        }
        const a = idxUpTo(start);
        const b = idxUpTo(end);
        count.push(b - a);
        dollars.push(pre.cumD[b] - pre.cumD[a]);
      }
      setBins({ dollars, count, maxD: pre.maxD, maxC: pre.maxC, nowHour });

      // violations in the last 60 minutes → the drone's intensity.
      const perHour = idxUpTo(now) - idxUpTo(now - 3600);
      audioRef.current?.setDensity(perHour);
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => clearInterval(iv);
  }, [day]);

  const toggleSound = () => {
    if (soundOn) {
      audioRef.current?.stop();
      setSoundOn(false);
    } else {
      audioRef.current ??= new PulseAudio();
      audioRef.current.start();
      setSoundOn(true);
    }
  };

  const families = day?.families ?? [];
  const dayTotalDollars = prefixRef.current
    ? prefixRef.current.cumD[lowerBound(day?.events ?? [], readout.now + 1)]
    : 0;

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#ece4d0]">
      <div ref={containerRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />

      {/* Masthead cartouche */}
      <div className="plate absolute top-4 left-4 px-5 py-4 select-none max-w-sm">
        <div className="text-2xl font-bold" style={{ letterSpacing: "0.28em" }}>
          MUSIC FOR PARKING
        </div>
        <div className="text-[11px] mt-1.5 opacity-60" style={{ letterSpacing: "0.1em" }}>
          REAL LOS ANGELES PARKING DATA
        </div>
        {/* The headline figures: how many, how much — since midnight. */}
        <div className="mt-3 flex items-end gap-6">
          <div>
            <div className="text-4xl font-bold tabular-nums leading-none">
              {readout.written.toLocaleString()}
            </div>
            <div className="text-[10px] opacity-55 mt-1" style={{ letterSpacing: "0.22em" }}>
              TICKETS
            </div>
          </div>
          <div>
            <div className="text-4xl font-bold tabular-nums leading-none" style={{ color: "#a6543c" }}>
              ${Math.round(dayTotalDollars).toLocaleString()}
            </div>
            <div className="text-[10px] opacity-55 mt-1" style={{ letterSpacing: "0.22em" }}>
              IN FINES
            </div>
          </div>
        </div>
        <div className="text-[11px] opacity-45 mt-2.5 tabular-nums" style={{ letterSpacing: "0.18em" }}>
          {clock(readout.now)} · SINCE MIDNIGHT
        </div>
      </div>

      <div className="absolute top-4 right-4 flex gap-2">
        <button
          onClick={() => setShowTune((s) => !s)}
          className="plate px-4 py-2 text-[11px] hover:opacity-100 opacity-70"
          style={{ letterSpacing: "0.2em", color: "var(--ink)" }}
        >
          {showTune ? "✕ CLOSE" : "⚙ TUNE"}
        </button>
      </div>

      {/* The mixing desk — live audio dials + export */}
      {showTune && (
        <div className="plate absolute top-20 right-4 bottom-4 w-[320px] px-4 py-3 select-none overflow-y-auto">
          <div className="text-[11px] mb-2 opacity-60" style={{ letterSpacing: "0.25em", color: "var(--ink)" }}>
            THE MIXING DESK
          </div>
          {!soundOn && (
            <div className="text-[10px] italic opacity-60 mb-2">turn sound on to hear changes</div>
          )}
          {KNOBS.map(([k, label, min, max, step]) => (
            <Knob key={k} k={k} label={label} min={min} max={max} step={step} onChange={applyTune} />
          ))}

          <div className="text-[10px] mt-3 mb-1 opacity-60" style={{ letterSpacing: "0.2em", color: "var(--ink)" }}>
            NOTE PER VIOLATION
          </div>
          {families.map((f, i) => (
            <label key={f.key} className="flex items-center justify-between mb-1.5 text-[10px]" style={{ color: "var(--ink)" }}>
              <span className="flex items-center gap-1.5 truncate">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: f.color }} />
                {f.label}
              </span>
              <select
                value={DIALS.notes[i]}
                onChange={(e) => { DIALS.notes[i] = parseFloat(e.target.value); applyTune(); }}
                className="bg-transparent border border-[var(--ink-faint)] text-[10px] tabular-nums"
                style={{ color: "var(--ink)" }}
              >
                {PENT.map((n) => (
                  <option key={n.hz} value={n.hz}>{n.label}</option>
                ))}
              </select>
            </label>
          ))}

          <button
            onClick={exportDials}
            className="mt-3 w-full border-2 border-[var(--ink-strong)] py-2 text-[11px] font-bold hover:bg-[var(--paper-deep)]"
            style={{ letterSpacing: "0.2em", color: "var(--ink)" }}
          >
            {copied ? "COPIED — PASTE TO CLAUDE" : "⎘ COPY THESE VALUES"}
          </button>
          <textarea
            readOnly
            value={JSON.stringify(DIALS)}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full h-16 text-[8px] tabular-nums bg-[var(--paper-deep)] border border-[var(--ink-faint)] p-1"
            style={{ color: "var(--ink)", fontFamily: "monospace" }}
          />
        </div>
      )}

      {/* Trend graphs, fixed to the 24-hour day */}
      {bins && !showTune && (
        <div className="plate absolute top-20 right-4 px-4 py-3.5 select-none w-[340px]">
          <HourBars
            label="$ / HOUR"
            values={bins.dollars}
            max={bins.maxD}
            color="#a6543c"
            nowHour={bins.nowHour}
            total={`$${Math.round(dayTotalDollars).toLocaleString()}`}
          />
          <div className="h-3" />
          <HourBars
            label="TICKETS / HOUR"
            values={bins.count}
            max={bins.maxC}
            color="#2a366a"
            nowHour={bins.nowHour}
            total={readout.written.toLocaleString()}
          />
          <div className="flex justify-between text-[9px] opacity-45 mt-1.5" style={{ letterSpacing: "0.2em" }}>
            <span>12 AM</span>
            <span>NOON</span>
            <span>12 AM</span>
          </div>
        </div>
      )}

      {/* The feed: the last dozen written */}
      {!showTune && (
      <div className="plate absolute bottom-4 right-4 px-4 py-3 select-none w-[340px]">
        <div className="text-[11px] mb-2 opacity-60" style={{ letterSpacing: "0.25em" }}>
          THE LATEST
        </div>
        {feed.length === 0 && (
          <div className="text-[12px] opacity-50 italic">the street is quiet…</div>
        )}
        {feed.map((it, i) => (
          <div
            key={it.id}
            className="flex items-center gap-2.5 text-[13px] py-[3px]"
            style={{ letterSpacing: "0.02em", opacity: 1 - i * 0.05 }}
          >
            <span className="tabular-nums opacity-60 w-11 shrink-0">{clock(it.t).slice(0, 5)}</span>
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: families[it.fam]?.color }} />
            <span className="truncate flex-1">{families[it.fam]?.label ?? "—"}</span>
            <span className="tabular-nums opacity-70 font-bold shrink-0">${it.fine}</span>
          </div>
        ))}
      </div>
      )}

      {/* Legend */}
      <div className="plate absolute bottom-4 left-4 px-4 py-3 select-none">
        <div className="text-[11px] mb-2 opacity-60" style={{ letterSpacing: "0.25em" }}>
          THE VIOLATIONS
        </div>
        {families.map((f) => (
          <div key={f.key} className="flex items-center gap-2.5 text-[12px] py-[1px]" style={{ letterSpacing: "0.06em" }}>
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: f.color }} />
            {f.label}
          </div>
        ))}
      </div>

      {/* The sound control — once the intro is dismissed, a quiet corner toggle. */}
      {!showIntro && (
        <button
          onClick={toggleSound}
          className="plate absolute bottom-4 left-1/2 -translate-x-1/2 px-5 py-2.5 text-[12px] hover:bg-[var(--paper-deep)]"
          style={{ letterSpacing: "0.25em", color: "var(--ink)" }}
        >
          {soundOn ? "♪ CLICK TO MUTE" : "♪ CLICK FOR SOUND"}
        </button>
      )}

      {/* Opening modal: the score is silent until invited in. */}
      {showIntro && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center"
          style={{ background: "rgba(42,54,106,0.18)", backdropFilter: "blur(1px)" }}
        >
          <div className="plate px-10 py-8 text-center select-none max-w-md">
            <div className="text-3xl font-bold" style={{ letterSpacing: "0.28em" }}>
              MUSIC FOR PARKING
            </div>
            <div className="text-[12px] opacity-70 mt-3 leading-relaxed" style={{ letterSpacing: "0.08em" }}>
              A day of the city's parking citations, replayed on the hour, on
              Los Angeles time. The map keeps a generative score — each ticket
              a note, the city's busyness the bass.
            </div>
            <button
              onClick={() => {
                audioRef.current ??= new PulseAudio();
                audioRef.current.start();
                setSoundOn(true);
                setShowIntro(false);
              }}
              className="mt-6 w-full border-2 border-[var(--ink-strong)] py-3 text-[14px] font-bold hover:bg-[var(--paper-deep)]"
              style={{ letterSpacing: "0.3em", color: "var(--ink)" }}
            >
              ♪ CLICK FOR SOUND
            </button>
            <button
              onClick={() => setShowIntro(false)}
              className="mt-2 text-[11px] opacity-50 hover:opacity-90"
              style={{ letterSpacing: "0.2em" }}
            >
              enter in silence
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
