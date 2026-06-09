/**
 * The map as a vintage printed sheet: Prussian-blue ink on cream paper,
 * in the style of a 1930s LA street map. There is no tile basemap — the
 * city boundary, the hex survey grid, and (coming) streets/labels are all
 * vector layers we own, drawn straight onto "paper".
 */
import { useMemo, useState, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer, TextLayer } from "@deck.gl/layers";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import LayerControl from "./LayerControl";
import { getLayer, metricColor, type LayerId } from "../lib/mapLayers";

// ─── Blueprint palette ────────────────────────────────────────────────────────
const PAPER = "#ece4d0";
const OCEAN = "#dfdbc6"; // the same paper, a shade colder where the water is
const INK: [number, number, number] = [42, 54, 106]; // Prussian blue
const SERIF = "Georgia, 'Times New Roman', serif";

// Letterspaced caps, like the old sheets: "BURBANK" → "B U R B A N K".
const spaced = (s: string) => s.split("").join(" ");

/** A static GeoJSON sheet layer from /public/geo — fetched once, cached forever. */
function useGeo(name: string) {
  return useQuery<any>({
    queryKey: ["geo", name],
    queryFn: () => fetch(`/geo/${name}.geojson`).then((r) => r.json()),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

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

  // The static sheet: land, coast, freeways, the boundary, and label points.
  const { data: boundary } = useGeo("la-city-boundary");
  const { data: land } = useGeo("socal-land");
  const { data: coastline } = useGeo("socal-coastline");
  const { data: roads } = useGeo("la-roads");
  const { data: hoods } = useGeo("la-neighborhood-labels");
  const { data: cities } = useGeo("la-city-labels");

  const [layerId, setLayerId] = useState<LayerId>("ownership");
  const layer = getLayer(layerId);

  // Land is paper; whatever it doesn't cover is the (slightly colder) ocean.
  // Unstroked — its edges are bbox clip cuts; the real coast ink is below.
  const landLayer = useMemo(() => {
    if (!land) return null;
    return new GeoJsonLayer({
      id: "land",
      data: land,
      stroked: false,
      filled: true,
      getFillColor: [236, 228, 208, 255],
      pickable: false,
    });
  }, [land]);

  const coastLayer = useMemo(() => {
    if (!coastline) return null;
    return new GeoJsonLayer({
      id: "coastline",
      data: coastline,
      stroked: true,
      filled: false,
      getLineColor: [...INK, 130] as [number, number, number, number],
      lineWidthUnits: "pixels",
      getLineWidth: 1.2,
      pickable: false,
    });
  }, [coastline]);

  // Freeways: the heaviest linework on the sheet besides the city limit.
  const roadsLayer = useMemo(() => {
    if (!roads) return null;
    return new GeoJsonLayer({
      id: "roads",
      data: roads,
      stroked: true,
      filled: false,
      getLineColor: [...INK, 150] as [number, number, number, number],
      lineWidthUnits: "pixels",
      getLineWidth: (f: any) => (f.properties?.type === "Major Highway" ? 1.6 : 0.9),
      pickable: false,
    });
  }, [roads]);

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

  // Neighborhood names: the biggest districts always; the rest as you zoom in.
  const hoodLabelLayer = useMemo(() => {
    if (!hoods) return null;
    const sorted = [...hoods.features].sort((a, b) => b.properties.area - a.properties.area);
    const visible = viewState.zoom >= 10.5 ? sorted : sorted.slice(0, 45);
    return new TextLayer({
      id: "hood-labels",
      data: visible,
      getPosition: (f: any) => f.geometry.coordinates,
      getText: (f: any) => f.properties.name,
      getSize: (f: any) => (f.properties.area > 0.0006 ? 12 : 10),
      getColor: [...INK, 175] as [number, number, number, number],
      fontFamily: SERIF,
      characterSet: "auto",
      sizeUnits: "pixels",
      pickable: false,
    });
  }, [hoods, viewState.zoom]);

  // Neighboring towns, bold and letterspaced like the reference sheets.
  const cityLabelLayer = useMemo(() => {
    if (!cities) return null;
    return new TextLayer({
      id: "city-labels",
      data: cities.features,
      getPosition: (f: any) => f.geometry.coordinates,
      getText: (f: any) => spaced(f.properties.name),
      getSize: 13,
      getColor: [...INK, 215] as [number, number, number, number],
      fontFamily: SERIF,
      fontWeight: "bold",
      characterSet: "auto",
      sizeUnits: "pixels",
      pickable: false,
    });
  }, [cities]);

  const oceanLabelLayer = useMemo(
    () =>
      new TextLayer({
        id: "ocean-label",
        data: [{ position: [-118.72, 33.82], text: spaced("PACIFIC  OCEAN") }],
        getPosition: (d: any) => d.position,
        getText: (d: any) => d.text,
        getSize: 24,
        getAngle: -38, // running with the shoreline of the bay
        getColor: [...INK, 110] as [number, number, number, number],
        fontFamily: SERIF,
        characterSet: "auto",
        sizeUnits: "pixels",
        pickable: false,
      }),
    []
  );

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
    // Stay on the sheet: clamp zoom so the view never outruns the extracted
    // base-map bbox or dives below useful detail.
    setViewState({ ...vs, zoom: Math.min(14, Math.max(8.8, vs.zoom)) });
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: OCEAN }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={true}
        layers={[
          landLayer,
          coastLayer,
          roadsLayer,
          hexLayer,
          boundaryLayer,
          hoodLabelLayer,
          cityLabelLayer,
          oceanLabelLayer,
        ]}
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
