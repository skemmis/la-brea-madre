/**
 * Screenshot harness for eyeballing the map during development.
 *
 *   node scripts/screenshot.mjs [options]
 *
 * Options:
 *   --url     Page to open            (default http://localhost:5000/map)
 *   --out     PNG path to write       (default /tmp/map.png)
 *   --width   Viewport width          (default 1440)
 *   --height  Viewport height         (default 900)
 *   --wait    Extra settle time, ms   (default 5000)
 *   --zoom    Map zoom level — requires the page to expose window.__map
 *             (the MapLibre instance); ignored otherwise.
 *   --center  "lng,lat" — same requirement as --zoom.
 *
 * The page is given time to fetch the GeoJSON sheets and let the GPU layers
 * settle before the shot is taken.
 */
import { chromium } from "playwright";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg("url", "http://localhost:5000/map");
const out = arg("out", "/tmp/map.png");
const width = parseInt(arg("width", "1440"), 10);
const height = parseInt(arg("height", "900"), 10);
const wait = parseInt(arg("wait", "5000"), 10);
const zoom = arg("zoom", null);
const center = arg("center", null);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });

page.on("console", (msg) => {
  if (msg.type() === "error") console.error(`[page] ${msg.text()}`);
});
page.on("pageerror", (err) => console.error(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
// The app polls the API on an interval, so "networkidle" never arrives;
// wait for a rendering canvas instead.
await page.waitForSelector("canvas", { timeout: 30_000 });

if (zoom || center) {
  await page
    .waitForFunction(() => window.__map?.isStyleLoaded?.(), { timeout: 20_000 })
    .catch(() => console.error("[harness] window.__map never appeared — --zoom/--center ignored"));
  await page.evaluate(
    ([z, c]) => {
      if (!window.__map) return;
      const opts = {};
      if (z) opts.zoom = parseFloat(z);
      if (c) opts.center = c.split(",").map(Number);
      window.__map.jumpTo(opts);
    },
    [zoom, center]
  );
}

await page.waitForTimeout(wait);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
