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
import {
  SHEET_STYLE,
  INITIAL_CENTER,
  INITIAL_ZOOM,
  INK,
  PAPER,
  OCEAN,
} from "../lib/sheetStyle";


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

// "14h ago", for the seismograph bulletin.
function ago(iso: string): string {
  const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
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
  degradation: number;
  lastTickYield: number;
  citationToday?: number;
  fineDollarsPerDay?: number;
  shakePoints?: number;
  askingPrice?: number;
  dailyTax?: number;
  repairBill?: number;
  retrofitted?: boolean;
  crewDaysLeft?: number;
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

  // 30 days of shaking: fresh quakes (48h) ring on every layer; the seismic
  // layer shows the whole month's epicenters over the per-hex heat.
  const { data: allQuakes = [] } = useQuery<
    { id: string; mag: number; lat: number; lng: number; radiusKm: number; place: string | null; occurredAt: string }[]
  >({
    queryKey: ["/api/map/quakes", 30],
    queryFn: () => apiRequest("GET", "/api/map/quakes?days=30"),
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });
  const freshQuakes = useMemo(
    () => allQuakes.filter((q) => Date.now() - new Date(q.occurredAt).getTime() < 48 * 3_600_000),
    [allQuakes]
  );
  const quakes = layerId === "seismic" ? allQuakes : freshQuakes;

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

    // A deploy (or flaky network) can sever a GeoJSON fetch mid-flight, and
    // MapLibre won't retry — the layer would stay blank until a reload.
    // Re-request failed sources a few times with backoff instead.
    const sourceRetries: Record<string, number> = {};
    map.on("error", (e: any) => {
      const id: string | undefined = e?.sourceId;
      if (!id) return;
      const n = sourceRetries[id] ?? 0;
      if (n >= 3) return;
      sourceRetries[id] = n + 1;
      setTimeout(() => {
        const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
        const data = (SHEET_STYLE.sources as any)[id]?.data;
        if (src && typeof data === "string") src.setData(data);
      }, 2000 * (n + 1));
    });
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

  // Quake heat: three concentric washes per shake — ochre into brick at the
  // epicenter, sized by the felt radius. The Madre's signature on the sheet.
  const quakeLayers = useMemo(() => {
    if (!quakes.length) return [];
    const common = {
      data: quakes,
      getPosition: (q: { lng: number; lat: number }) => [q.lng, q.lat] as [number, number],
      radiusUnits: "meters" as const,
      stroked: false,
      pickable: false,
    };
    return [
      new ScatterplotLayer({ id: "quake-outer", ...common, getRadius: (q: any) => q.radiusKm * 1000, getFillColor: [168, 112, 26, 26] }),
      new ScatterplotLayer({ id: "quake-mid", ...common, getRadius: (q: any) => q.radiusKm * 450, getFillColor: [166, 84, 44, 44] }),
      new ScatterplotLayer({ id: "quake-core", ...common, getRadius: (q: any) => q.radiusKm * 120, getFillColor: [166, 60, 44, 90] }),
      // Pixel-scale epicenter mark, so even a small offshore tremor registers
      // at sheet zoom: a brick point in a thin survey ring.
      new ScatterplotLayer({
        id: "quake-mark-ring", ...common,
        radiusUnits: "pixels", getRadius: 7,
        filled: false, stroked: true,
        getLineColor: [166, 60, 44, 200], lineWidthUnits: "pixels", getLineWidth: 1.2,
      }),
      new ScatterplotLayer({
        id: "quake-mark-dot", ...common,
        radiusUnits: "pixels", getRadius: 3,
        getFillColor: [166, 60, 44, 230],
      }),
    ];
  }, [quakes]);

  useEffect(() => {
    overlayRef.current?.setProps({
      layers: [quakeLayers, hexLayer, ...carrionGlowLayers].flat(),
      onHover: ({ object }) => {
        const canvas = mapRef.current?.getCanvas();
        if (canvas) canvas.style.cursor = object ? "pointer" : "";
      },
    });
  }, [hexLayer, carrionGlowLayers, quakeLayers]);

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
      {/* The seismograph bulletin: recent shakes, click to fly to one. */}
      {quakes.length > 0 && (
        <div className="plate absolute bottom-4 right-4 px-3 py-2 select-none max-w-[260px]">
          <div className="plate-title text-[9px] mb-1 text-[var(--brick)]">THE MADRE STIRRED</div>
          {quakes.slice(0, 3).map((q) => (
            <button
              key={q.id}
              onClick={() => mapRef.current?.flyTo({ center: [q.lng, q.lat], zoom: 11.5 })}
              className="block w-full text-left text-[10px] text-[var(--ink)] hover:underline leading-snug py-0.5"
              style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
            >
              M{q.mag.toFixed(1)} — {q.place ?? "the basin"} · {ago((q as any).occurredAt)} →
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
