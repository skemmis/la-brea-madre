import { useMemo, useState, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer, PolygonLayer } from "@deck.gl/layers";
import { Map as MapboxMap } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import LayerControl from "./LayerControl";
import { getLayer, metricColor, type LayerId } from "../lib/mapLayers";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";

// Initial view centered on LA
const INITIAL_VIEW_STATE = {
  longitude: -118.2437,
  latitude: 34.0522,
  zoom: 9.5,
  pitch: 30,
  bearing: 0,
};

// Palette: tar black, crude amber, contested red, upgraded glow
const UNOWNED_COLOR: [number, number, number, number] = [30, 20, 10, 100];
const OWNED_COLORS = [
  [139, 90, 43],   // dark amber
  [180, 120, 60],
  [220, 150, 80],
  [255, 200, 100],
  [100, 160, 80],  // teal-green
  [80, 130, 200],  // muted blue
  [160, 80, 200],  // violet
  [200, 80, 80],   // rust red
];

function playerColor(userId: number): [number, number, number] {
  return OWNED_COLORS[userId % OWNED_COLORS.length] as [number, number, number];
}

// A generous box around greater LA; used to dim everything outside the city.
const WORLD_BOX: [number, number][] = [
  [-130, 28], [-105, 28], [-105, 40], [-130, 40], [-130, 28],
];

type Ring = [number, number][];
interface MaskPoly {
  polygon: Ring[];
}

/**
 * Turn the city polygon into "everything *outside* the city" mask polygons:
 *   • the world box with the city's outer ring punched out as a hole, plus
 *   • each enclave (Beverly Hills, Santa Monica, …) as its own filled patch.
 * Drawn semi-transparent under the hexes so the playable city reads as a
 * lit stage and the surroundings recede.
 */
function buildMask(geo: any): MaskPoly[] {
  const geom = geo?.features?.[0]?.geometry;
  if (!geom) return [];
  const rings: Ring[] = geom.type === "MultiPolygon" ? geom.coordinates.flat() : geom.coordinates;
  if (!rings.length) return [];
  const [outer, ...enclaves] = rings;
  return [{ polygon: [WORLD_BOX, outer] }, ...enclaves.map((r) => ({ polygon: [r] }))];
}

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

  // Dim the world outside the city limits.
  const maskLayer = useMemo(() => {
    const polys = buildMask(boundary);
    if (!polys.length) return null;
    return new PolygonLayer<MaskPoly>({
      id: "city-mask",
      data: polys,
      getPolygon: (d) => d.polygon,
      getFillColor: [8, 5, 2, 165],
      stroked: false,
      filled: true,
      pickable: false,
    });
  }, [boundary]);

  // The hard line: the city limit, always visible above the hexes.
  const boundaryLayer = useMemo(() => {
    if (!boundary) return null;
    return new GeoJsonLayer({
      id: "city-boundary",
      data: boundary,
      stroked: true,
      filled: false,
      getLineColor: [255, 198, 92, 235],
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

  const hexLayer = useMemo(
    () =>
      new H3HexagonLayer<HexData>({
        id: "hex-layer",
        data: hexes,
        getHexagon: (d) => d.h3Index,
        filled: true,
        stroked: true,
        lineWidthMinPixels: 0.5,
        extruded: true,
        elevationScale: 200,
        getElevation: (d) => {
          if (!d.ownerId) return 0;
          const base = d.upgradeLevel * 0.3 + 0.2;
          const exploitBonus = d.isExploited ? 0.3 : 0;
          return base + exploitBonus;
        },
        getFillColor: (d) => {
          if (layerId === "ownership") {
            if (!d.ownerId) return UNOWNED_COLOR;
            if (d.pendingContest) return [200, 50, 30, 220] as [number, number, number, number];
            const [r, g, b] = playerColor(d.ownerId);
            const brightness = d.ownerId === viewerUserId ? 1.3 : 0.9;
            const degradeFade = 1 - d.degradation * 0.005;
            return [
              Math.min(255, r * brightness * degradeFade),
              Math.min(255, g * brightness * degradeFade),
              Math.min(255, b * brightness * degradeFade),
              210,
            ] as [number, number, number, number];
          }
          // Metric heat layer (parking, oil, ...)
          return metricColor(layer.ramp!, layer.metric!(d), maxMetric);
        },
        getLineColor: (d) => {
          if (d.h3Index === selectedHex?.h3Index) return [255, 220, 100, 255] as [number, number, number, number];
          // On metric layers, keep ownership legible via the border color.
          if (layerId !== "ownership" && d.ownerId) {
            const [r, g, b] = playerColor(d.ownerId);
            return [r, g, b, 230] as [number, number, number, number];
          }
          if (!d.ownerId) return [40, 30, 20, 60] as [number, number, number, number];
          return [0, 0, 0, 80] as [number, number, number, number];
        },
        lineWidthScale: 1,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 220, 100, 100],
        onClick: ({ object }) => {
          onSelectHex(object === selectedHex ? null : object ?? null);
        },
        updateTriggers: {
          getFillColor: [layerId, viewerUserId, maxMetric, selectedHex],
          getLineColor: [layerId, selectedHex],
          getElevation: [hexes],
        },
      }),
    [hexes, layerId, layer, maxMetric, viewerUserId, selectedHex, onSelectHex]
  );

  const onViewStateChange = useCallback(({ viewState: vs }: any) => {
    setViewState(vs);
  }, []);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={true}
        layers={[maskLayer, hexLayer, boundaryLayer]}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      >
        <MapboxMap
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          reuseMaps
        />
      </DeckGL>
      <LayerControl active={layerId} onChange={setLayerId} />
    </div>
  );
}
