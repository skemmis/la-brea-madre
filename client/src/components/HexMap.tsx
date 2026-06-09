/**
 * The map as a vintage printed sheet: Prussian-blue ink on cream paper,
 * in the style of a 1930s LA street map. There is no tile basemap — the
 * city boundary, the hex survey grid, and (coming) streets/labels are all
 * vector layers we own, drawn straight onto "paper".
 */
import { useMemo, useState, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer } from "@deck.gl/layers";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import LayerControl from "./LayerControl";
import { getLayer, metricColor, type LayerId } from "../lib/mapLayers";

// ─── Blueprint palette ────────────────────────────────────────────────────────
const PAPER = "#ece4d0";
const INK: [number, number, number] = [42, 54, 106]; // Prussian blue

// Initial view: the city centroid (Census INTPT), flat like a print.
const INITIAL_VIEW_STATE = {
  longitude: -118.4108,
  latitude: 34.0194,
  zoom: 9.5,
  pitch: 0,
  bearing: 0,
};

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
  deadAnimalPerDay?: number;
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
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);

  const { data: hexes = [] } = useQuery<HexData[]>({
    queryKey: ["/api/map/hexes"],
    queryFn: () => apiRequest("GET", "/api/map/hexes"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // The City of Los Angeles boundary — static, served from /public, fetched once.
  const { data: boundary } = useQuery<any>({
    queryKey: ["la-city-boundary"],
    queryFn: () => fetch("/geo/la-city-boundary.geojson").then((r) => r.json()),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const [layerId, setLayerId] = useState<LayerId>("ownership");
  const layer = getLayer(layerId);

  // The city limit, inked above the grid.
  const boundaryLayer = useMemo(() => {
    if (!boundary) return null;
    return new GeoJsonLayer({
      id: "city-boundary",
      data: boundary,
      stroked: true,
      filled: false,
      getLineColor: [...INK, 235] as [number, number, number, number],
      lineWidthUnits: "pixels",
      getLineWidth: 2,
      lineWidthMinPixels: 1.5,
      pickable: false,
    });
  }, [boundary]);

  // Max value of the active metric, for normalizing the heat ramp.
  const maxMetric = useMemo(() => {
    if (!layer.metric) return 1;
    return Math.max(1, ...hexes.map(layer.metric));
  }, [hexes, layer]);

  // The hex grid, drawn like a printed survey/lease grid: flat, thin ink
  // strokes, tint fills only where the game has something to say.
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
          // On metric layers, keep ownership legible via the border tint.
          if (layerId !== "ownership" && d.ownerId) {
            const [r, g, b] = playerColor(d.ownerId);
            return [r, g, b, 200] as [number, number, number, number];
          }
          return [...INK, 70] as [number, number, number, number];
        },
        pickable: true,
        autoHighlight: true,
        highlightColor: [...INK, 36],
        onClick: ({ object }) => {
          onSelectHex(object === selectedHex ? null : object ?? null);
        },
        updateTriggers: {
          getFillColor: [layerId, viewerUserId, maxMetric, selectedHex],
          getLineColor: [layerId, selectedHex],
        },
      }),
    [hexes, layerId, layer, maxMetric, viewerUserId, selectedHex, onSelectHex]
  );

  const onViewStateChange = useCallback(({ viewState: vs }: any) => {
    setViewState(vs);
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: PAPER }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={true}
        layers={[hexLayer, boundaryLayer]}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      />
      {/* Paper finish: grain + vignette, multiplied over ink and all. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage: GRAIN,
          opacity: 0.55,
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
