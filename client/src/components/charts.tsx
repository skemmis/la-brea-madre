/**
 * The exchange's chart kit, drawn like engravings on the sheet: thin ink
 * lines, dotted rules, serif figures. Hand-rolled SVG — no chart library,
 * so every mark speaks the map's language.
 */
import { useState } from "react";

const INK = "#2a366a";
const SEPIA = "#473423";
const SERIF = "Georgia, 'Times New Roman', serif";

function niceTicks(min: number, max: number, n = 4): number[] {
  if (max <= min) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / n)));
  const candidates = [step, step * 2, step * 2.5, step * 5, step * 10];
  const s = candidates.find((c) => span / c <= n + 1) ?? step * 10;
  const start = Math.ceil(min / s) * s;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-9; v += s) out.push(Math.round(v * 1000) / 1000);
  return out;
}

const fmt = (v: number) =>
  Math.abs(v) >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : Math.abs(v) >= 10_000
      ? `${Math.round(v / 1000)}k`
      : Math.abs(v) >= 1000
        ? `${(v / 1000).toFixed(1)}k`
        : String(Math.round(v * 100) / 100);

// ─── Line chart (one or two series, with a crosshair tooltip) ────────────────

export interface InkSeries {
  points: { x: number; y: number }[]; // x in [0..1] order, y raw
  color?: string;
  name?: string;
}

export function InkLine({
  points,
  series,
  width = 560,
  height = 160,
  yMin,
  yMax,
  step = false,
  percent = false,
  color = INK,
  refY,
  refLabel,
  xLabels,
  hoverLabels,
  format,
}: {
  points?: { x: number; y: number }[];
  series?: InkSeries[]; // alternative to points: up to two color-coded lines
  width?: number;
  height?: number;
  yMin?: number;
  yMax?: number;
  step?: boolean; // step-after (price charts)
  percent?: boolean; // format axis as ¢
  color?: string;
  refY?: number; // dashed reference line (the "line" of an over/under)
  refLabel?: string;
  xLabels?: { x: number; label: string }[];
  /** Per-index captions (dates/times) — enables the crosshair tooltip. */
  hoverLabels?: string[];
  format?: (v: number) => string;
}) {
  const all: InkSeries[] = series ?? (points ? [{ points, color }] : []);
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 40, r: 10, t: 8, b: xLabels ? 20 : 8 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  if (!all.length || !all[0].points.length) return null;

  const ys = all.flatMap((s) => s.points.map((p) => p.y));
  const lo = yMin ?? Math.min(...ys, refY ?? Infinity);
  const hi = yMax ?? Math.max(...ys, refY ?? -Infinity);
  const span = hi - lo || 1;
  const X = (x: number) => pad.l + x * iw;
  const Y = (y: number) => pad.t + ih - ((y - lo) / span) * ih;

  const paths = all.map((s) => {
    let d = `M ${X(s.points[0].x)} ${Y(s.points[0].y)}`;
    for (let i = 1; i < s.points.length; i++) {
      if (step) d += ` L ${X(s.points[i].x)} ${Y(s.points[i - 1].y)}`;
      d += ` L ${X(s.points[i].x)} ${Y(s.points[i].y)}`;
    }
    if (step) d += ` L ${X(1)} ${Y(s.points[s.points.length - 1].y)}`;
    return d;
  });

  const ticks = percent ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(lo, hi);
  const fmtV = format ?? ((v: number) => (percent ? `${Math.round(v * 100)}¢` : fmt(v)));
  const n = Math.max(...all.map((s) => s.points.length));

  const onMove = hoverLabels
    ? (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * width;
        const idx = Math.round(((px - pad.l) / iw) * (n - 1));
        setHover(Math.max(0, Math.min(n - 1, idx)));
      }
    : undefined;

  // Tooltip layout: flip sides near the right edge.
  let tip: React.ReactNode = null;
  if (hover != null && hoverLabels) {
    const hx = X(all[0].points[Math.min(hover, all[0].points.length - 1)]?.x ?? 0);
    const lines = [
      hoverLabels[hover] ?? "",
      ...all.map((s) => {
        const p = s.points[Math.min(hover, s.points.length - 1)];
        return `${s.name ? s.name + "  " : ""}${p ? fmtV(p.y) : ""}`;
      }),
    ];
    const w = Math.max(...lines.map((l) => l.length)) * 5.4 + 12;
    const bx = hx + 8 + w > width ? hx - 8 - w : hx + 8;
    tip = (
      <g pointerEvents="none">
        <line x1={hx} x2={hx} y1={pad.t} y2={pad.t + ih} stroke={SEPIA} strokeOpacity={0.45} strokeWidth={0.7} strokeDasharray="2 2" />
        {all.map((s, si) => {
          const p = s.points[Math.min(hover, s.points.length - 1)];
          return p ? <circle key={si} cx={X(p.x)} cy={Y(p.y)} r={2.6} fill={s.color ?? INK} /> : null;
        })}
        <rect x={bx} y={pad.t + 2} width={w} height={12 + lines.length * 11} fill="#ece4d0" stroke={INK} strokeOpacity={0.6} strokeWidth={0.8} />
        {lines.map((l, li) => (
          <text key={li} x={bx + 6} y={pad.t + 14 + li * 11} fontFamily={SERIF} fontSize={li === 0 ? 8.5 : 9.5} fontWeight={li === 0 ? "normal" : "bold"} fill={li === 0 ? SEPIA : (all[li - 1]?.color ?? INK)}>
            {l}
          </text>
        ))}
      </g>
    );
  }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
      onMouseMove={onMove}
      onMouseLeave={hoverLabels ? () => setHover(null) : undefined}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={pad.l} x2={width - pad.r} y1={Y(t)} y2={Y(t)}
            stroke={INK} strokeOpacity={0.18} strokeWidth={0.6} strokeDasharray="1.5 3"
          />
          <text
            x={pad.l - 5} y={Y(t) + 3} textAnchor="end"
            fontFamily={SERIF} fontSize={9} fill={SEPIA} fillOpacity={0.75}
          >
            {percent ? `${Math.round(t * 100)}¢` : fmt(t)}
          </text>
        </g>
      ))}
      {refY != null && (
        <g>
          <line
            x1={pad.l} x2={width - pad.r} y1={Y(refY)} y2={Y(refY)}
            stroke="#a6543c" strokeOpacity={0.7} strokeWidth={0.8} strokeDasharray="5 3"
          />
          {refLabel && (
            <text
              x={width - pad.r - 2} y={Y(refY) - 3} textAnchor="end"
              fontFamily={SERIF} fontSize={8.5} fill="#a6543c" fontStyle="italic"
            >
              {refLabel}
            </text>
          )}
        </g>
      )}
      {xLabels?.map((l) => (
        <text
          key={l.label + l.x} x={X(l.x)} y={height - 6} textAnchor="middle"
          fontFamily={SERIF} fontSize={8.5} fill={SEPIA} fillOpacity={0.7}
        >
          {l.label}
        </text>
      ))}
      {all.map((s, si) => (
        <path key={si} d={paths[si]} fill="none" stroke={s.color ?? INK} strokeWidth={1.3} strokeLinejoin="round" strokeOpacity={all.length > 1 ? 0.85 : 1} />
      ))}
      {all.map((s, si) => {
        const lp = s.points[s.points.length - 1];
        return <circle key={si} cx={X(lp.x)} cy={Y(lp.y)} r={2.2} fill={s.color ?? INK} />;
      })}
      {tip}
    </svg>
  );
}

// ─── Bars (day-of-week seasonality) ──────────────────────────────────────────

export function InkBars({
  values,
  labels,
  highlight,
  width = 260,
  height = 110,
}: {
  values: number[];
  labels: string[];
  highlight?: number; // index drawn in brick (e.g. today's weekday)
  width?: number;
  height?: number;
}) {
  const pad = { l: 6, r: 6, t: 8, b: 16 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = Math.max(...values, 1);
  const bw = iw / values.length;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      {values.map((v, i) => {
        const h = (v / max) * ih;
        const x = pad.l + i * bw + bw * 0.18;
        const w = bw * 0.64;
        const y = pad.t + ih - h;
        const hot = i === highlight;
        return (
          <g key={i}>
            {/* hatched fill, like an engraver's shading */}
            <rect
              x={x} y={y} width={w} height={h}
              fill={hot ? "#a6543c" : INK} fillOpacity={hot ? 0.34 : 0.16}
              stroke={hot ? "#a6543c" : INK} strokeOpacity={hot ? 0.9 : 0.55} strokeWidth={0.8}
            />
            <text
              x={x + w / 2} y={y - 3} textAnchor="middle"
              fontFamily={SERIF} fontSize={7.5} fill={SEPIA} fillOpacity={0.8}
            >
              {fmt(v)}
            </text>
            <text
              x={x + w / 2} y={height - 4} textAnchor="middle"
              fontFamily={SERIF} fontSize={8} fill={hot ? "#a6543c" : SEPIA} fillOpacity={0.85}
            >
              {labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Duo bars (head-to-head day-of-week) ──────────────────────────────────────

export function InkBarsDuo({
  a,
  b,
  labels,
  aColor = "#3c6e50",
  bColor = "#a6543c",
  highlight,
  width = 300,
  height = 110,
}: {
  a: number[];
  b: number[];
  labels: string[];
  aColor?: string;
  bColor?: string;
  highlight?: number;
  width?: number;
  height?: number;
}) {
  const pad = { l: 6, r: 6, t: 8, b: 16 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = Math.max(...a, ...b, 1);
  const slot = iw / labels.length;
  const bw = slot * 0.3;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      {labels.map((lab, i) => {
        const hot = i === highlight;
        const ha = (a[i] / max) * ih;
        const hb = (b[i] / max) * ih;
        const x0 = pad.l + i * slot + slot * 0.15;
        return (
          <g key={lab}>
            <rect x={x0} y={pad.t + ih - ha} width={bw} height={ha} fill={aColor} fillOpacity={0.45} stroke={aColor} strokeWidth={0.8}>
              <title>{`${lab} — ${fmt(a[i])}`}</title>
            </rect>
            <rect x={x0 + bw + 1.5} y={pad.t + ih - hb} width={bw} height={hb} fill={bColor} fillOpacity={0.45} stroke={bColor} strokeWidth={0.8}>
              <title>{`${lab} — ${fmt(b[i])}`}</title>
            </rect>
            <text
              x={x0 + bw + 0.75} y={height - 4} textAnchor="middle"
              fontFamily={SERIF} fontSize={8} fill={hot ? "#a6543c" : SEPIA} fillOpacity={0.85}
              fontWeight={hot ? "bold" : "normal"}
            >
              {lab}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

export function Spark({
  values,
  width = 84,
  height = 24,
  color = INK,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height}>
        <line
          x1={2} x2={width - 2} y1={height / 2} y2={height / 2}
          stroke={color} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2 2"
        />
      </svg>
    );
  }
  // Price sparks live on [0,1]; pad a touch so flat lines aren't on the edge.
  const lo = Math.min(...values) - 0.04;
  const hi = Math.max(...values) + 0.04;
  const span = hi - lo || 1;
  const pts = values
    .map((v, i) => `${2 + (i / (values.length - 1)) * (width - 4)},${2 + (height - 4) * (1 - (v - lo) / span)}`)
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height}>
      <polyline
        points={pts} fill="none"
        stroke={up ? "#3c6e50" : "#a6543c"} strokeWidth={1.1} strokeLinejoin="round"
      />
    </svg>
  );
}
