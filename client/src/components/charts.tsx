/**
 * The exchange's chart kit, drawn like engravings on the sheet: thin ink
 * lines, dotted rules, serif figures. Hand-rolled SVG — no chart library,
 * so every mark speaks the map's language.
 */

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

// ─── Line chart ───────────────────────────────────────────────────────────────

export function InkLine({
  points,
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
}: {
  points: { x: number; y: number }[]; // x in [0..1] order, y raw
  width?: number;
  height?: number;
  yMin?: number;
  yMax?: number;
  step?: boolean; // step-after (price charts)
  percent?: boolean; // format axis as %
  color?: string;
  refY?: number; // dashed reference line (the "line" of an over/under)
  refLabel?: string;
  xLabels?: { x: number; label: string }[];
}) {
  const pad = { l: 40, r: 10, t: 8, b: xLabels ? 20 : 8 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  if (!points.length) return null;

  const ys = points.map((p) => p.y);
  const lo = yMin ?? Math.min(...ys, refY ?? Infinity);
  const hi = yMax ?? Math.max(...ys, refY ?? -Infinity);
  const span = hi - lo || 1;
  const X = (x: number) => pad.l + x * iw;
  const Y = (y: number) => pad.t + ih - ((y - lo) / span) * ih;

  let d = `M ${X(points[0].x)} ${Y(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    if (step) d += ` L ${X(points[i].x)} ${Y(points[i - 1].y)}`;
    d += ` L ${X(points[i].x)} ${Y(points[i].y)}`;
  }
  if (step) d += ` L ${X(1)} ${Y(points[points.length - 1].y)}`;

  const ticks = percent ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(lo, hi);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
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
      <path d={d} fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" />
      <circle
        cx={X(points[points.length - 1].x)} cy={Y(points[points.length - 1].y)}
        r={2.2} fill={color}
      />
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
