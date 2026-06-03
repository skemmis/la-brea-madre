import { useMemo, useState, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { Map as MapboxMap } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";

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

export interface HexData {
  h3Index: string;
  ownerId: number | null;
  upgradeLevel: number;
  isExploited: boolean;
  degradation: number;
  lastTickYield: number;
  ownerName?: string;
  ambient: {
    oilWellCount: number;
    treeCount: number;
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

  const { data: hotspots = [] } = useQuery<{ h3Index: string; citationCount: number }[]>({
    queryKey: ["/api/map/hotspots"],
    queryFn: () => apiRequest("GET", "/api/map/hotspots"),
    refetchInterval: 120_000,
  });

  const hotspotMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of hotspots) m.set(h.h3Index, h.citationCount);
    return m;
  }, [hotspots]);

  const maxCitations = useMemo(
    () => Math.max(1, ...hotspots.map((h) => h.citationCount)),
    [hotspots]
  );

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
          if (!d.ownerId) {
            // Shade by citation heat
            const heat = (hotspotMap.get(d.h3Index) ?? 0) / maxCitations;
            const r = Math.floor(20 + heat * 60);
            const g = Math.floor(10 + heat * 20);
            const b = Math.floor(8 + heat * 10);
            return [r, g, b, 120] as [number, number, number, number];
          }

          if (d.pendingContest) {
            return [200, 50, 30, 220] as [number, number, number, number];
          }

          const [r, g, b] = playerColor(d.ownerId);
          const brightness =
            d.ownerId === viewerUserId
              ? 1.3
              : 0.9;
          const degradeFade = 1 - d.degradation * 0.005;
          return [
            Math.min(255, r * brightness * degradeFade),
            Math.min(255, g * brightness * degradeFade),
            Math.min(255, b * brightness * degradeFade),
            210,
          ] as [number, number, number, number];
        },
        getLineColor: (d) => {
          if (d.h3Index === selectedHex?.h3Index) return [255, 220, 100, 255];
          if (!d.ownerId) return [40, 30, 20, 60];
          return [0, 0, 0, 80];
        },
        lineWidthScale: 1,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 220, 100, 100],
        onClick: ({ object }) => {
          onSelectHex(object === selectedHex ? null : object ?? null);
        },
        updateTriggers: {
          getFillColor: [viewerUserId, hotspotMap, maxCitations, selectedHex],
          getLineColor: [selectedHex],
          getElevation: [hexes],
        },
      }),
    [hexes, hotspotMap, maxCitations, viewerUserId, selectedHex, onSelectHex]
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
        layers={[hexLayer]}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      >
        <MapboxMap
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          reuseMaps
        />
      </DeckGL>
    </div>
  );
}
