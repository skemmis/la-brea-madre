/**
 * One-time extraction of the static base-map layers (run on demand, outputs
 * committed to client/public/geo — the app never fetches these sources at
 * runtime):
 *
 *   • socal-land.geojson           — Natural Earth 10m land, clipped to the
 *                                    LA viewport. Drawn as the paper sheet;
 *                                    whatever it doesn't cover is ocean.
 *   • la-roads.geojson             — Natural Earth 10m roads (freeways/major
 *                                    highways), clipped to the viewport.
 *   • la-neighborhood-labels.geojson — label points (name + area tier) from
 *                                    the LA Times-derived neighborhood
 *                                    polygons in codeforgermany/click_that_hood.
 *
 * Sources are GitHub-hosted (Natural Earth is public domain; neighborhoods
 * CC-BY from the LA Times). Finer street centerlines (LA GeoHub "Streets
 * (Centerline)") can be added here when a network path to lacity.org exists.
 *
 * Run with: npx tsx scripts/extractBaseMap.ts
 */
import fs from "fs";
import path from "path";

const OUT_DIR = "client/public/geo";

// Viewport box around greater LA ([minLng, minLat, maxLng, maxLat]) — generous
// enough that a wide screen at the minimum zoom never runs off the sheet.
const BBOX = [-119.6, 33.2, -117.2, 34.8] as const;

const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const CTH = "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data";
const HOODS = `${CTH}/los-angeles.geojson`;
const COUNTY_CITIES = `${CTH}/los-angeles-county.geojson`;

type Pt = [number, number];

const inBbox = ([x, y]: Pt) => x >= BBOX[0] && x <= BBOX[2] && y >= BBOX[1] && y <= BBOX[3];

/** Sutherland–Hodgman clip of one ring against the (convex) bbox. */
function clipRing(ring: Pt[]): Pt[] {
  type Edge = { inside: (p: Pt) => boolean; cross: (a: Pt, b: Pt) => Pt };
  const edges: Edge[] = [
    { inside: (p) => p[0] >= BBOX[0], cross: (a, b) => lerpX(a, b, BBOX[0]) },
    { inside: (p) => p[0] <= BBOX[2], cross: (a, b) => lerpX(a, b, BBOX[2]) },
    { inside: (p) => p[1] >= BBOX[1], cross: (a, b) => lerpY(a, b, BBOX[1]) },
    { inside: (p) => p[1] <= BBOX[3], cross: (a, b) => lerpY(a, b, BBOX[3]) },
  ];
  let out = ring;
  for (const e of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (e.inside(cur)) {
        if (!e.inside(prev)) out.push(e.cross(prev, cur));
        out.push(cur);
      } else if (e.inside(prev)) {
        out.push(e.cross(prev, cur));
      }
    }
  }
  return out;
}

const lerpX = (a: Pt, b: Pt, x: number): Pt => {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
};
const lerpY = (a: Pt, b: Pt, y: number): Pt => {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
};

const round5 = (p: Pt): Pt => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

async function fetchJson(url: string): Promise<any> {
  console.log(`fetching ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function write(name: string, data: unknown): void {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, JSON.stringify(data));
  console.log(`wrote ${p} (${(fs.statSync(p).size / 1024).toFixed(0)} KB)`);
}

async function land(): Promise<void> {
  const geo = await fetchJson(`${NE}/ne_10m_land.geojson`);
  const polys: Pt[][][] = [];
  for (const f of geo.features) {
    const coords =
      f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const poly of coords) {
      const outer = clipRing(poly[0]);
      if (outer.length >= 3) polys.push([outer.map(round5)]);
    }
  }
  write("socal-land.geojson", {
    type: "FeatureCollection",
    features: polys.map((polygon) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: polygon },
    })),
  });
}

/**
 * Coastline as line features (the land fill is drawn unstroked because its
 * clip edges are straight bbox cuts — the real coast ink comes from here).
 */
async function coast(): Promise<void> {
  const geo = await fetchJson(`${NE}/ne_10m_coastline.geojson`);
  const features: any[] = [];
  for (const f of geo.features) {
    const lines: Pt[][] =
      f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const line of lines) {
      let run: Pt[] = [];
      const flush = () => {
        if (run.length >= 2) {
          features.push({
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: run.map(round5) },
          });
        }
        run = [];
      };
      for (const p of line) (inBbox(p) ? run.push(p) : flush());
      flush();
    }
  }
  write("socal-coastline.geojson", { type: "FeatureCollection", features });
}

/**
 * Decorative shoreline ripples — three offset echoes of the coast running
 * seaward, like the engraved water lines on the old sheets. Pure geometry
 * from the two committed files above (run land + coast first).
 */
async function ripples(): Promise<void> {
  const landGeo = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "socal-land.geojson"), "utf8"));
  const coastGeo = JSON.parse(
    fs.readFileSync(path.join(OUT_DIR, "socal-coastline.geojson"), "utf8")
  );
  const landRings: Pt[][] = landGeo.features.map((f: any) => f.geometry.coordinates[0]);

  const inLand = (p: Pt): boolean => {
    for (const ring of landRings) {
      let ins = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ins = !ins;
      }
      if (ins) return true;
    }
    return false;
  };

  // Per-vertex normals (averaged segment normals), one consistent seaward
  // sign per line chosen by testing the midpoint offset against the land.
  const offsetLine = (line: Pt[], dist: number): Pt[] => {
    const normals: Pt[] = line.map((_, i) => {
      const a = line[Math.max(0, i - 1)];
      const b = line[Math.min(line.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      return [-dy / len, dx / len];
    });
    const mid = Math.floor(line.length / 2);
    const probe: Pt = [line[mid][0] + normals[mid][0] * dist, line[mid][1] + normals[mid][1] * dist];
    const sign = inLand(probe) ? -1 : 1;
    return line.map((p, i) => [
      p[0] + normals[i][0] * dist * sign,
      p[1] + normals[i][1] * dist * sign,
    ]);
  };

  const features: any[] = [];
  for (const f of coastGeo.features) {
    const line: Pt[] = f.geometry.coordinates;
    if (line.length < 4) continue;
    for (let k = 1; k <= 3; k++) {
      features.push({
        type: "Feature",
        properties: { k },
        geometry: { type: "LineString", coordinates: offsetLine(line, 0.004 * k).map(round5) },
      });
    }
  }
  write("socal-ripples.geojson", { type: "FeatureCollection", features });
}

async function roads(): Promise<void> {
  const geo = await fetchJson(`${NE}/ne_10m_roads.geojson`);
  const features: any[] = [];
  for (const f of geo.features) {
    const lines: Pt[][] =
      f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const line of lines) {
      // Keep in-bbox runs of each line (edge crossings trimmed, fine under
      // the map vignette).
      let run: Pt[] = [];
      const flush = () => {
        if (run.length >= 2) {
          features.push({
            type: "Feature",
            properties: { name: f.properties?.name ?? "", type: f.properties?.type ?? "" },
            geometry: { type: "LineString", coordinates: run.map(round5) },
          });
        }
        run = [];
      };
      for (const p of line) (inBbox(p) ? run.push(p) : flush());
      flush();
    }
  }
  write("la-roads.geojson", { type: "FeatureCollection", features });
}

async function neighborhoods(): Promise<void> {
  const geo = await fetchJson(HOODS);
  const features: any[] = [];
  for (const f of geo.features) {
    const name: string = f.properties?.name ?? "";
    if (!name) continue;
    const rings =
      f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map((p: any) => p[0]) : [f.geometry.coordinates[0]];
    // Label at the centroid of the largest ring; tier by rough area so the
    // renderer can size type like the old sheets (VAN NUYS big, Palms small).
    let best: Pt[] = [];
    let bestArea = 0;
    for (const ring of rings) {
      const a = Math.abs(ringArea(ring));
      if (a > bestArea) {
        bestArea = a;
        best = ring;
      }
    }
    if (!best.length) continue;
    const c = centroid(best);
    if (!inBbox(c)) continue;
    features.push({
      type: "Feature",
      properties: { name: name.toUpperCase(), area: bestArea },
      geometry: { type: "Point", coordinates: round5(c) },
    });
  }
  write("la-neighborhood-labels.geojson", { type: "FeatureCollection", features });
}

// The neighbor towns a 1930s sheet would actually label — curated, since the
// county file also carries unincorporated scraps ("ANGELES CREST", …).
const CITY_WHITELIST = new Set([
  "SANTA MONICA", "BEVERLY HILLS", "CULVER CITY", "WEST HOLLYWOOD",
  "BURBANK", "GLENDALE", "PASADENA", "SOUTH PASADENA", "ALHAMBRA",
  "SAN FERNANDO", "CALABASAS", "MALIBU", "INGLEWOOD", "EL SEGUNDO",
  "HAWTHORNE", "GARDENA", "MANHATTAN BEACH", "HERMOSA BEACH",
  "REDONDO BEACH", "TORRANCE", "COMPTON", "LYNWOOD", "SOUTH GATE",
  "HUNTINGTON PARK", "DOWNEY", "MONTEBELLO", "VERNON", "LONG BEACH",
  "SANTA CLARITA",
]);

/** Neighboring incorporated cities (BURBANK, GLENDALE, …) for the big labels. */
async function cities(): Promise<void> {
  const geo = await fetchJson(COUNTY_CITIES);
  const features: any[] = [];
  for (const f of geo.features) {
    const name: string = f.properties?.name ?? "";
    if (!name || !CITY_WHITELIST.has(name.toUpperCase())) continue;
    const rings =
      f.geometry.type === "MultiPolygon"
        ? f.geometry.coordinates.map((p: any) => p[0])
        : [f.geometry.coordinates[0]];
    let best: Pt[] = [];
    let bestArea = 0;
    for (const ring of rings) {
      const a = Math.abs(ringArea(ring));
      if (a > bestArea) {
        bestArea = a;
        best = ring;
      }
    }
    if (!best.length) continue;
    const c = centroid(best);
    if (!inBbox(c)) continue;
    features.push({
      type: "Feature",
      properties: { name: name.toUpperCase(), area: bestArea },
      geometry: { type: "Point", coordinates: round5(c) },
    });
  }
  write("la-city-labels.geojson", { type: "FeatureCollection", features });
}

function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

function centroid(ring: Pt[]): Pt {
  let x = 0,
    y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

// `ripples` reads the land/coast outputs, so it runs after them.
const tasks = { land, coast, ripples, roads, neighborhoods, cities };
const only = process.argv[2] as keyof typeof tasks | undefined;
(async () => {
  for (const [name, fn] of Object.entries(tasks)) {
    if (only && name !== only) continue;
    await fn();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
