/**
 * The map as a vintage printed sheet: Prussian-blue ink on cream paper,
 * in the style of a 1930s LA street map. There is no tile basemap — the
 * base map is a MapLibre style built entirely from GeoJSON sheets we own
 * (/public/geo) and self-hosted glyphs (/public/fonts), with the game's
 * hex survey grid drawn over it as a deck.gl overlay.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import LayerControl from "./LayerControl";
import { getLayer, metricColor, type LayerId } from "../lib/mapLayers";

// ─── Blueprint palette ────────────────────────────────────────────────────────
const PAPER = "#ece4d0";
const OCEAN = "#dfdbc6"; // the same paper, a shade colder where the water is
const INK: [number, number, number] = [42, 54, 106]; // Prussian blue
const INK_HEX = "#2a366a";
// Place names get their own darker, warmer ink — like the near-black
// district names on the reference prints — so they read over busy linework
// instead of dissolving into it.
const SEPIA_HEX = "#473423";

// Self-hosted Libre Baskerville SDF glyphs — a 1900s ATF Baskerville revival,
// the right voice for a printed sheet.
const SERIF = ["libre_baskerville_regular"];
const SERIF_BOLD = ["libre_baskerville_bold"];

// Street ink, weighted by class `t` (0 local … 3 arterial).
const classed = (vals: [number, number, number, number]) =>
  ["match", ["get", "t"], 0, vals[0], 1, vals[1], 2, vals[2], 3, vals[3], vals[0]] as any;

/**
 * The whole base map as one MapLibre style: paper, water engraving, street
 * grid, and typographic layers. Symbol layers give us real street names with
 * proper line placement and collision handling — things the hand-rolled
 * deck.gl sheet could never do.
 */
const SHEET_STYLE: maplibregl.StyleSpecification = {
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
    // The street grid, printed like the reference sheets: arterials (t≥2)
    // are the bold named skeleton of the city; the local grid is whisper-
    // faint unlabeled texture between them.
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
    // Freeways: the heaviest linework on the sheet besides the city limit.
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
    // The focus mask: a translucent paper wash over everything beyond the
    // city limit, the way the old sheets grayed neighbor territory — the
    // playable area reads at a glance.
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
    // Only arterials carry names, like the reference sheets — the local grid
    // is texture, not information.
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
        // Like the reference sheets: the name rides just above the street's
        // ink line rather than running over it.
        "text-offset": [0, -0.65] as any,
        "symbol-spacing": 420,
        "text-padding": 4,
      },
      paint: {
        // Full ink and a slim halo: a fat halo eats the serif hairlines and
        // is most of what reads as "muddy" at close zoom.
        "text-color": INK_HEX,
        "text-opacity": 0.9,
        "text-halo-color": PAPER,
        "text-halo-width": 0.9,
      },
    },
    // Highway numbers along the freeways.
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
    // Neighborhood names: the biggest districts always; the rest as you zoom
    // in. Collision handling keeps the sheet from clotting; the sort key
    // makes the larger district win when two names fight for the same spot.
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
    // Neighboring towns, bold and letterspaced like the reference sheets.
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
      // Outside the playable area: present for bearings, but half-voiced.
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

// Initial view: the city centroid (Census INTPT), flat like a print.
const INITIAL_CENTER: [number, number] = [-118.4108, 34.0194];
const INITIAL_ZOOM = 9.5;

// Owned parcels read as muted print tints stamped onto the sheet.
const OWNED_COLORS = [
  [166, 84, 60],   // brick
  [186, 120, 52],  // burnt orange
  [128, 128, 54],  // olive
  [58, 122, 116],  // teal
  [84, 96, 156],   // slate blue
  [134, 84, 138],  // plum
  [108, 90, 60],   // sienna
  [60, 110, 80],   // pine
];

function playerColor(userId: number): [number, number, number] {
  return OWNED_COLORS[userId % OWNED_COLORS.length] as [number, number, number];
}

// Paper grain: a tiny tileable fractal-noise SVG, multiplied over the sheet.
const GRAIN =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E` +
  `%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E` +
  `%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E` +
  `%3Crect width='240' height='240' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;

export interface HexData {
  h3Index: string;
  ownerId: number | null;
  upgradeLevel: number;
  isExploited: boolean;
  degradation: number;
  lastTickYield: number;
  citationToday?: number;
  citationPerDay?: number;
  deadAnimalPerMonth?: number;
  ownerName?: string;
  ambient: {
    oilWellCount: number;
    treeCount: number;
    deadAnimalCount: number;
    baseYieldPerTick: number;
  } | null;
  pendingContest?: boolean;
}

interface Props {
  viewerUserId?: number;
  onSelectHex: (hex: HexData | null) => void;
  selectedHex: HexData | null;
}

export default function HexMap({ viewerUserId, onSelectHex, selectedHex }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  // Latest select handler/selection, readable from the long-lived overlay.
  const selectRef = useRef({ onSelectHex, selectedHex });
  selectRef.current = { onSelectHex, selectedHex };

  // Paper grain reads as age at sheet scale but as noise over the type up
  // close — fade it back as the reader leans in.
  const [grainOpacity, setGrainOpacity] = useState(0.55);

  const { data: hexes = [] } = useQuery<HexData[]>({
    queryKey: ["/api/map/hexes"],
    queryFn: () => apiRequest("GET", "/api/map/hexes"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [layerId, setLayerId] = useState<LayerId>("ownership");
  const layer = getLayer(layerId);

  // Yesterday's dead-animal pickups, plotted as glowing dots on the carrion
  // layer — the exact report locations, not the hex aggregate. (Experimental.)
  const { data: carrion } = useQuery<{ date: string; points: { lng: number; lat: number }[] }>({
    queryKey: ["/api/map/carrion-points"],
    queryFn: () => apiRequest("GET", "/api/map/carrion-points"),
    enabled: layerId === "deadanimals",
    staleTime: 15 * 60_000,
  });

  // Max value of the active metric, for normalizing the heat ramp.
  const maxMetric = useMemo(() => {
    if (!layer.metric) return 1;
    return Math.max(1, ...hexes.map(layer.metric));
  }, [hexes, layer]);

  // The base map. Built once; the game overlay rides on top of it.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: SHEET_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      // Stay on the sheet: clamp zoom so the view never outruns the extracted
      // base-map bbox or dives below useful detail.
      minZoom: 8.8,
      maxZoom: 14,
      // Flat like a print: no rotation, no pitch.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    const onZoom = () =>
      setGrainOpacity(Math.min(0.55, Math.max(0.22, 0.55 - (map.getZoom() - 9.5) * 0.075)));
    map.on("zoom", onZoom);
    onZoom();

    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay);

    mapRef.current = map;
    overlayRef.current = overlay;
    if (import.meta.env.DEV) (window as any).__map = map;

    return () => {
      overlayRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // The hex grid, drawn like a printed survey/lease grid: flat ink, tint
  // fills only where the game has something to say. Unowned cells carry no
  // stroke at all, so the survey grid never competes with the street ink.
  const hexLayer = useMemo(
    () =>
      new H3HexagonLayer<HexData>({
        id: "hex-layer",
        data: hexes,
        getHexagon: (d) => d.h3Index,
        filled: true,
        stroked: true,
        extruded: false,
        lineWidthUnits: "pixels",
        getLineWidth: 0.5,
        lineWidthMinPixels: 0.35,
        getFillColor: (d) => {
          if (layerId === "ownership") {
            if (d.pendingContest) return [166, 60, 44, 150] as [number, number, number, number];
            if (!d.ownerId) return [...INK, 7] as [number, number, number, number];
            const [r, g, b] = playerColor(d.ownerId);
            const mine = d.ownerId === viewerUserId;
            const degradeFade = Math.max(0.4, 1 - d.degradation * 0.005);
            return [r, g, b, Math.round((mine ? 170 : 120) * degradeFade)] as [
              number, number, number, number,
            ];
          }
          return metricColor(layer.ramp!, layer.metric!(d), maxMetric);
        },
        getLineColor: (d) => {
          if (d.h3Index === selectedHex?.h3Index) return [...INK, 255] as [number, number, number, number];
          if (!d.ownerId) return [0, 0, 0, 0] as [number, number, number, number];
          // On metric layers, keep ownership legible via the border tint.
          if (layerId !== "ownership") {
            const [r, g, b] = playerColor(d.ownerId);
            return [r, g, b, 200] as [number, number, number, number];
          }
          return [...INK, 70] as [number, number, number, number];
        },
        pickable: true,
        autoHighlight: true,
        highlightColor: [...INK, 36],
        onClick: ({ object }) => {
          const { onSelectHex: select, selectedHex: sel } = selectRef.current;
          select(object === sel ? null : object ?? null);
        },
        updateTriggers: {
          getFillColor: [layerId, viewerUserId, maxMetric, selectedHex],
          getLineColor: [layerId, selectedHex],
        },
      }),
    [hexes, layerId, layer, maxMetric, viewerUserId, selectedHex]
  );

  // Glow = three concentric scatter dots: a soft halo, a brighter middle,
  // and a near-white hot core. Pixel radii so it reads at every zoom.
  const carrionGlowLayers = useMemo(() => {
    if (layerId !== "deadanimals" || !carrion?.points?.length) return [];
    const common = {
      data: carrion.points,
      getPosition: (d: { lng: number; lat: number }) => [d.lng, d.lat] as [number, number],
      radiusUnits: "pixels" as const,
      stroked: false,
      pickable: false,
    };
    return [
      new ScatterplotLayer({ id: "carrion-glow-halo", ...common, getRadius: 12, getFillColor: [110, 175, 95, 55] }),
      new ScatterplotLayer({ id: "carrion-glow-mid", ...common, getRadius: 6, getFillColor: [130, 205, 110, 140] }),
      new ScatterplotLayer({ id: "carrion-glow-core", ...common, getRadius: 2.4, getFillColor: [240, 255, 225, 255] }),
    ];
  }, [carrion, layerId]);

  useEffect(() => {
    overlayRef.current?.setProps({
      layers: [hexLayer, ...carrionGlowLayers],
      onHover: ({ object }) => {
        const canvas = mapRef.current?.getCanvas();
        if (canvas) canvas.style.cursor = object ? "pointer" : "";
      },
    });
  }, [hexLayer, carrionGlowLayers]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: OCEAN }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {/* Paper finish: grain + vignette, multiplied over ink and all. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage: GRAIN,
          opacity: grainOpacity,
          mixBlendMode: "multiply",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(64,52,28,0.22) 100%)",
          mixBlendMode: "multiply",
        }}
      />
      <LayerControl active={layerId} onChange={setLayerId} />
    </div>
  );
}
