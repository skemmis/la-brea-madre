/**
 * The rotating daily board — which markets exist on a given day.
 *
 * Pure: a seeded shuffle keyed on the date deterministically picks the day's
 * slate from the catalog (same board for every player, every restart). The
 * staples run every day; the rest rotates so the floor always has fresh paper.
 *
 * Metric keys refer to series in daily_metric, maintained by the pipeline:
 *   citations, fines, dead_animals, make:<CODE>, color:<CODE>, viol:<KEY>
 */

// ─── Catalog ──────────────────────────────────────────────────────────────────

export const MAKE_LABELS: Record<string, string> = {
  TOYT: "Toyota", HOND: "Honda", FORD: "Ford", NISS: "Nissan",
  CHEV: "Chevrolet", MERZ: "Mercedes", BMW: "BMW", TSMR: "Tesla",
  KIA: "Kia", HYUN: "Hyundai", LEXS: "Lexus", JEEP: "Jeep",
  VOLK: "Volkswagen", DODG: "Dodge", MAZD: "Mazda", AUDI: "Audi",
  SUBA: "Subaru", PORS: "Porsche", CADI: "Cadillac", MNNI: "Mini",
};

// Pairs picked to be genuinely competitive in the citation data.
export const MAKE_PAIRS: [string, string][] = [
  ["TOYT", "HOND"], ["NISS", "CHEV"], ["BMW", "MERZ"], ["MERZ", "TSMR"],
  ["BMW", "TSMR"], ["KIA", "HYUN"], ["MAZD", "AUDI"], ["VOLK", "DODG"],
  ["LEXS", "JEEP"], ["PORS", "CADI"], ["SUBA", "MAZD"], ["FORD", "CHEV"],
];

export const COLOR_LABELS: Record<string, string> = {
  WT: "white", GY: "gray", BK: "black", SL: "silver",
  BL: "blue", RD: "red", GN: "green",
};

export const COLOR_PAIRS: [string, string][] = [
  ["BK", "WT"], ["WT", "GY"], ["BK", "GY"], ["SL", "BL"],
];

// Violation series: Socrata description → metric key + question phrasing.
export const VIOLATIONS: Record<string, { socrata: string; phrase: string }> = {
  SWEEP: { socrata: "NO PARK/STREET CLEAN", phrase: "street-sweeping tickets" },
  RED: { socrata: "RED ZONE", phrase: "red-zone tickets" },
  METER: { socrata: "METER EXP.", phrase: "expired-meter tickets" },
  DOUBLE: { socrata: "DOUBLE PARKING", phrase: "double-parking tickets" },
  BUS: { socrata: "EXCLUSIVE FOR BUSES", phrase: "bus-lane tickets" },
  PREF: { socrata: "PREFERENTIAL PARKING", phrase: "preferential-parking tickets" },
};

// Marquee neighborhoods for district markets. `name` must match the LA Times
// polygon names in la-city-land.geojson; `key` is the metric suffix
// (hoodcit:<KEY> tickets/day, hoodda:<KEY> dead animals/day).
export const HOODS: { key: string; name: string }[] = [
  { key: "VENICE", name: "Venice" },
  { key: "HOLLYWOOD", name: "Hollywood" },
  { key: "DOWNTOWN", name: "Downtown" },
  { key: "KOREATOWN", name: "Koreatown" },
  { key: "SILVERLAKE", name: "Silver Lake" },
  { key: "ECHOPARK", name: "Echo Park" },
  { key: "WESTWOOD", name: "Westwood" },
  { key: "SANPEDRO", name: "San Pedro" },
  { key: "VANNUYS", name: "Van Nuys" },
  { key: "BOYLEHEIGHTS", name: "Boyle Heights" },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "Toyotas", but "Mercedes" stays "Mercedes".
const plural = (name: string) => (name.endsWith("s") ? name : `${name}s`);

// ─── Spec ─────────────────────────────────────────────────────────────────────

export interface BoardSpec {
  /** Stable id prefix; full market id is `${specId}-${day}`. */
  specId: string;
  kind: "overunder" | "faceoff" | "weekday";
  category: "totals" | "makes" | "colors" | "violations" | "hoods" | "specials";
  metricA: string;
  metricB?: string;
  labelA?: string; // display name of side A (faceoffs)
  labelB?: string;
  /** Build the question once the line is known (over/unders). */
  question: (line: number) => string;
  /** Settlement rule, printed on the market page. */
  rules: string;
}

// ─── Seeded rotation ──────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function daySeed(day: string): number {
  let h = 2166136261;
  for (const c of day) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(rng: () => number, arr: T[], n: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const num = (n: number) => n.toLocaleString("en-US");

/** The full slate of market specs for a given day. */
export function boardSpecsFor(day: string): BoardSpec[] {
  const rng = mulberry32(daySeed(day));
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const specs: BoardSpec[] = [];

  // ── Staples: the city's vital signs, every day ──
  specs.push(
    {
      specId: "citations",
      kind: "overunder",
      category: "totals",
      metricA: "citations",
      question: (l) => `Will the city write more than ${num(l)} parking tickets today?`,
      rules: "Settles YES if the City of LA's citation record for the day shows strictly more tickets than the line. Counted from the official citations dataset once the day's records land (typically 1–2 days).",
    },
    {
      specId: "fines",
      kind: "overunder",
      category: "totals",
      metricA: "fines",
      question: (l) => `Will the city collect more than $${num(l)} in parking fines today?`,
      rules: "Settles YES if the summed fine amounts on the day's citations strictly exceed the line, per the official citations dataset.",
    },
    {
      specId: "dead_animals",
      kind: "overunder",
      category: "totals",
      metricA: "dead_animals",
      question: (l) => `Will more than ${num(l)} dead animals be reported to the city today?`,
      rules: "Settles YES if MyLA311 dead-animal removal requests for the day strictly exceed the line.",
    },
    {
      specId: "viol_SWEEP",
      kind: "overunder",
      category: "violations",
      metricA: "viol:SWEEP",
      question: (l) => `Will more than ${num(l)} street-sweeping tickets be written today?`,
      rules: `Settles YES if citations coded "NO PARK/STREET CLEAN" strictly exceed the line for the day.`,
    }
  );

  // ── Make face-offs: two per day, rotating through competitive pairs ──
  for (const [a, b] of pick(rng, MAKE_PAIRS, 2)) {
    specs.push({
      specId: `mfo_${a}_${b}`,
      kind: "faceoff",
      category: "makes",
      metricA: `make:${a}`,
      metricB: `make:${b}`,
      labelA: MAKE_LABELS[a],
      labelB: MAKE_LABELS[b],
      question: () => `Will more ${plural(MAKE_LABELS[a])} than ${plural(MAKE_LABELS[b])} be ticketed today?`,
      rules: `Settles YES if strictly more ${plural(MAKE_LABELS[a])} than ${plural(MAKE_LABELS[b])} appear on the day's citations, by the vehicle-make field. Ties settle NO.`,
    });
  }

  // ── Make props: two over/unders on makes not already in today's face-offs ──
  const usedMakes = new Set(specs.flatMap((s) => [s.metricA, s.metricB ?? ""]));
  const propMakes = pick(
    rng,
    Object.keys(MAKE_LABELS).filter((m) => !usedMakes.has(`make:${m}`)),
    2
  );
  for (const m of propMakes) {
    specs.push({
      specId: `mou_${m}`,
      kind: "overunder",
      category: "makes",
      metricA: `make:${m}`,
      labelA: MAKE_LABELS[m],
      question: (l) => `Will the city ticket more than ${num(l)} ${plural(MAKE_LABELS[m])} today?`,
      rules: `Settles YES if strictly more than the line of ${MAKE_LABELS[m]} vehicles appear on the day's citations.`,
    });
  }

  // ── Colors: one face-off and one prop ──
  const [ca, cb] = pick(rng, COLOR_PAIRS, 1)[0];
  specs.push({
    specId: `cfo_${ca}_${cb}`,
    kind: "faceoff",
    category: "colors",
    metricA: `color:${ca}`,
    metricB: `color:${cb}`,
    labelA: `${COLOR_LABELS[ca]} cars`,
    labelB: `${COLOR_LABELS[cb]} cars`,
    question: () => `Will more ${COLOR_LABELS[ca]} cars than ${COLOR_LABELS[cb]} cars be ticketed today?`,
    rules: `Settles YES if strictly more ${COLOR_LABELS[ca]} vehicles than ${COLOR_LABELS[cb]} vehicles appear on the day's citations, by the color field. Ties settle NO.`,
  });
  const propColor = pick(
    rng,
    Object.keys(COLOR_LABELS).filter((c) => c !== ca && c !== cb),
    1
  )[0];
  specs.push({
    specId: `cou_${propColor}`,
    kind: "overunder",
    category: "colors",
    metricA: `color:${propColor}`,
    labelA: `${COLOR_LABELS[propColor]} cars`,
    question: (l) => `Will more than ${num(l)} ${COLOR_LABELS[propColor]} cars be ticketed today?`,
    rules: `Settles YES if strictly more than the line of ${COLOR_LABELS[propColor]} vehicles appear on the day's citations.`,
  });

  // ── Violations: two more rotating props (street sweeping is a staple) ──
  for (const v of pick(rng, Object.keys(VIOLATIONS).filter((v) => v !== "SWEEP"), 2)) {
    specs.push({
      specId: `viol_${v}`,
      kind: "overunder",
      category: "violations",
      metricA: `viol:${v}`,
      question: (l) => `Will more than ${num(l)} ${VIOLATIONS[v].phrase} be written today?`,
      rules: `Settles YES if citations coded "${VIOLATIONS[v].socrata}" strictly exceed the line for the day.`,
    });
  }

  // ── The neighborhoods: a district face-off, a ticket prop, and a
  //    dead-animal prop, rotating through the marquee districts ──
  const [ha, hb, hc, hd] = pick(rng, HOODS, 4);
  specs.push(
    {
      specId: `hfo_${ha.key}_${hb.key}`,
      kind: "faceoff",
      category: "hoods",
      metricA: `hoodcit:${ha.key}`,
      metricB: `hoodcit:${hb.key}`,
      labelA: ha.name,
      labelB: hb.name,
      question: () => `Will ${ha.name} out-ticket ${hb.name} today?`,
      rules: `Settles YES if strictly more parking citations are written within ${ha.name} than within ${hb.name} today, counted by each district's bounds (LA Times neighborhood boundaries). Ties settle NO.`,
    },
    {
      specId: `hou_${hc.key}`,
      kind: "overunder",
      category: "hoods",
      metricA: `hoodcit:${hc.key}`,
      labelA: hc.name,
      question: (l) => `Will ${hc.name} rack up more than ${num(l)} parking tickets today?`,
      rules: `Settles YES if strictly more than the line of parking citations are written within ${hc.name}'s bounds (LA Times neighborhood boundaries) today.`,
    },
    {
      specId: `hda_${hd.key}`,
      kind: "overunder",
      category: "hoods",
      metricA: `hoodda:${hd.key}`,
      labelA: hd.name,
      question: (l) => `Will more than ${num(l)} dead animals be reported in ${hd.name} today?`,
      rules: `Settles YES if strictly more than the line of MyLA311 dead-animal removal requests fall within ${hd.name}'s bounds (LA Times neighborhood boundaries) today.`,
    }
  );

  // ── The Madre's special: did the ground move today? ──
  specs.push({
    specId: "madre",
    kind: "overunder",
    category: "specials",
    metricA: "quakes",
    question: () => `Will the Madre stir today — any M1.5+ quake in the basin?`,
    rules: "Settles YES if the USGS records at least one M1.5+ earthquake within 60 km of central Los Angeles during the PT day. Counted from the USGS realtime catalog.",
  });

  // ── The weekday special ──
  specs.push({
    specId: "weekday",
    kind: "weekday",
    category: "specials",
    metricA: "citations",
    question: (l) =>
      `A ${WEEKDAYS[weekday]} in Los Angeles: will the city beat its typical ${WEEKDAYS[weekday]} (${num(l)} tickets)?`,
    rules: `Settles YES if the day's citation count strictly exceeds the median of the last eight ${WEEKDAYS[weekday]}s.`,
  });

  return specs;
}
