/**
 * The base map as a vintage printed sheet — Prussian-blue ink on cream paper,
 * 1930s LA street-map style — built entirely from GeoJSON sheets we own
 * (/public/geo) and self-hosted glyphs (/public/fonts). No tile basemap.
 *
 * Shared by the game map (HexMap) and the ambient Parking Pulse, so both
 * surfaces print on identical stock.
 */
import type maplibregl from "maplibre-gl";

// ─── Blueprint palette ────────────────────────────────────────────────────────
export const PAPER = "#ece4d0";
export const OCEAN = "#dfdbc6"; // the same paper, a shade colder where the water is
export const INK: [number, number, number] = [42, 54, 106]; // Prussian blue
export const INK_HEX = "#2a366a";
// Place names get their own darker, warmer ink — like the near-black district
// names on the reference prints — so they read over busy linework.
export const SEPIA_HEX = "#473423";

// Self-hosted Libre Baskerville SDF glyphs — a 1900s ATF Baskerville revival.
export const SERIF = ["libre_baskerville_regular"];
export const SERIF_BOLD = ["libre_baskerville_bold"];

// Street ink, weighted by class `t` (0 local … 3 arterial).
const classed = (vals: [number, number, number, number]) =>
  ["match", ["get", "t"], 0, vals[0], 1, vals[1], 2, vals[2], 3, vals[3], vals[0]] as any;

// Initial view: the city centroid (Census INTPT), flat like a print.
export const INITIAL_CENTER: [number, number] = [-118.4108, 34.0194];
export const INITIAL_ZOOM = 9.5;

/**
 * The whole base map as one MapLibre style: paper, water engraving, street
 * grid, and typographic layers with real line placement and collision.
 */
export const SHEET_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "/fonts/{fontstack}/{range}.pbf",
  sources: {
    land: { type: "geojson", data: "/geo/socal-land.geojson" },
    ripples: { type: "geojson", data: "/geo/socal-ripples.geojson" },
    coastline: { type: "geojson", data: "/geo/socal-coastline.geojson" },
    streets: { type: "geojson", data: "/geo/la-streets.geojson" },
    roads: { type: "geojson", data: "/geo/la-roads.geojson" },
    boundary: { type: "geojson", data: "/geo/la-city-boundary.geojson" },
    mask: { type: "geojson", data: "/geo/la-city-mask.geojson" },
    districts: { type: "geojson", data: "/geo/la-city-land.geojson" },
    hoods: { type: "geojson", data: "/geo/la-neighborhood-labels.geojson" },
    cities: { type: "geojson", data: "/geo/la-city-labels.geojson" },
    ocean: {
      type: "geojson",
      data: {
        type: "Feature",
        properties: { name: "PACIFIC  OCEAN" },
        geometry: { type: "Point", coordinates: [-118.72, 33.82] },
      },
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": OCEAN } },
    {
      id: "land",
      type: "fill",
      source: "land",
      paint: { "fill-color": PAPER },
    },
    // Engraved water lines: three echoes of the coast, fading seaward.
    {
      id: "shore-ripples",
      type: "line",
      source: "ripples",
      paint: {
        "line-color": INK_HEX,
        "line-width": 0.6,
        "line-opacity": ["match", ["get", "k"], 1, 0.2, 2, 0.14, 3, 0.085, 0.14] as any,
      },
    },
    {
      id: "coastline",
      type: "line",
      source: "coastline",
      paint: { "line-color": INK_HEX, "line-width": 1.2, "line-opacity": 0.5 },
    },
    // The street grid: arterials (t≥2) are the bold named skeleton; the local
    // grid is whisper-faint unlabeled texture between them.
    {
      id: "streets",
      type: "line",
      source: "streets",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": INK_HEX,
        "line-width": [
          "interpolate", ["exponential", 1.6], ["zoom"],
          9, classed([0.2, 0.25, 0.6, 0.9]),
          12, classed([0.35, 0.45, 1.1, 1.5]),
          14, classed([0.7, 0.9, 2.2, 3.0]),
        ] as any,
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          9, classed([0.07, 0.09, 0.42, 0.55]),
          11.5, classed([0.18, 0.22, 0.55, 0.68]),
        ] as any,
      },
    },
    // Freeways: the heaviest linework besides the city limit.
    {
      id: "roads",
      type: "line",
      source: "roads",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": INK_HEX,
        "line-width": ["match", ["get", "type"], "Major Highway", 1.6, 0.9] as any,
        "line-opacity": 0.59,
      },
    },
    // District boundaries: dashed faint sepia survey lines under the labels.
    {
      id: "district-lines",
      type: "line",
      source: "districts",
      minzoom: 10,
      paint: {
        "line-color": SEPIA_HEX,
        "line-width": 0.8,
        "line-dasharray": [2, 3] as any,
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.12, 12, 0.28] as any,
      },
    },
    // The focus mask: a translucent paper wash beyond the city limit.
    {
      id: "city-mask",
      type: "fill",
      source: "mask",
      paint: { "fill-color": PAPER, "fill-opacity": 0.55 },
    },
    // The city limit, inked above the grid.
    {
      id: "city-boundary",
      type: "line",
      source: "boundary",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": INK_HEX, "line-width": 2, "line-opacity": 0.92 },
    },
    // ── Typography ──────────────────────────────────────────────────────────
    {
      id: "street-labels-major",
      type: "symbol",
      source: "streets",
      minzoom: 10.5,
      filter: [">=", ["get", "t"], 2] as any,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "name"] as any,
        "text-font": SERIF,
        "text-size": ["interpolate", ["linear"], ["zoom"], 10.5, 9.5, 14, 14.5] as any,
        "text-letter-spacing": 0.06,
        "text-offset": [0, -0.65] as any,
        "symbol-spacing": 420,
        "text-padding": 4,
      },
      paint: {
        "text-color": INK_HEX,
        "text-opacity": 0.9,
        "text-halo-color": PAPER,
        "text-halo-width": 0.9,
      },
    },
    {
      id: "road-labels",
      type: "symbol",
      source: "roads",
      minzoom: 9.2,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "name"] as any,
        "text-font": SERIF_BOLD,
        "text-size": 10,
        "text-letter-spacing": 0.15,
        "symbol-spacing": 500,
      },
      paint: {
        "text-color": INK_HEX,
        "text-opacity": 0.45,
        "text-halo-color": PAPER,
        "text-halo-width": 1.2,
      },
    },
    {
      id: "hood-labels-major",
      type: "symbol",
      source: "hoods",
      filter: [">", ["get", "area"], 0.0006] as any,
      layout: {
        "text-field": ["get", "name"] as any,
        "text-font": SERIF,
        "text-size": 12,
        "text-letter-spacing": 0.08,
        "symbol-sort-key": ["*", -1, ["get", "area"]] as any,
      },
      paint: {
        "text-color": SEPIA_HEX,
        "text-opacity": 0.8,
        "text-halo-color": PAPER,
        "text-halo-width": 1.6,
      },
    },
    {
      id: "hood-labels-minor",
      type: "symbol",
      source: "hoods",
      minzoom: 10.5,
      filter: ["<=", ["get", "area"], 0.0006] as any,
      layout: {
        "text-field": ["get", "name"] as any,
        "text-font": SERIF,
        "text-size": 10,
        "text-letter-spacing": 0.08,
        "symbol-sort-key": ["*", -1, ["get", "area"]] as any,
      },
      paint: {
        "text-color": SEPIA_HEX,
        "text-opacity": 0.8,
        "text-halo-color": PAPER,
        "text-halo-width": 1.6,
      },
    },
    {
      id: "city-labels",
      type: "symbol",
      source: "cities",
      layout: {
        "text-field": ["get", "name"] as any,
        "text-font": SERIF_BOLD,
        "text-size": 11,
        "text-letter-spacing": 0.35,
        "symbol-sort-key": ["*", -1, ["get", "area"]] as any,
      },
      paint: {
        "text-color": SEPIA_HEX,
        "text-opacity": 0.45,
        "text-halo-color": PAPER,
        "text-halo-width": 1.4,
      },
    },
    {
      id: "ocean-label",
      type: "symbol",
      source: "ocean",
      layout: {
        "text-field": ["get", "name"] as any,
        "text-font": SERIF,
        "text-size": 24,
        "text-letter-spacing": 0.5,
        "text-rotate": -38, // running with the shoreline of the bay
        "text-allow-overlap": true,
      },
      paint: { "text-color": INK_HEX, "text-opacity": 0.43 },
    },
  ],
};
