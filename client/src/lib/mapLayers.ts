import type { HexData } from "../components/HexMap";

export type LayerId = "ownership" | "parking" | "oil" | "deadanimals";

export interface MapLayer {
  id: LayerId;
  label: string;
  legend: string;
  // Metric layers carry a value function + a color ramp (heat = value / max).
  // The "ownership" layer has neither and is handled specially.
  ramp?: [number, number, number];
  metric?: (d: HexData) => number;
}

// Adding a new data layer (jacarandas, dead animals, crystal shops, ...) is
// just one more entry here once its per-hex metric is in the map payload.
export const LAYERS: MapLayer[] = [
  { id: "ownership", label: "Ownership", legend: "Who controls each cell" },
  {
    id: "parking",
    label: "Parking",
    legend: "Citations / day",
    ramp: [172, 50, 34], // brick-red ink
    metric: (d) => d.citationPerDay ?? 0,
  },
  {
    id: "oil",
    label: "Oil",
    legend: "Active wells per cell",
    ramp: [168, 112, 26], // ochre ink
    metric: (d) => d.ambient?.oilWellCount ?? 0,
  },
  {
    id: "deadanimals",
    label: "Carrion",
    legend: "Dead animal reports",
    ramp: [74, 118, 70], // pine-green ink
    // Raw cumulative count, not a per-day rate: at res-9 the cells are ~49x
    // smaller than the old res-7 grid, so a per-day value rounds to zero.
    // The heat ramp normalizes against the max, so sparse counts still read.
    metric: (d) => d.ambient?.deadAnimalCount ?? 0,
  },
];

export function getLayer(id: LayerId): MapLayer {
  return LAYERS.find((l) => l.id === id) ?? LAYERS[0];
}

/**
 * Heat color for a metric layer on the paper map: the ramp color printed at
 * increasing ink density — near-invisible at 0, a solid tint at the max.
 */
export function metricColor(
  ramp: [number, number, number],
  value: number,
  max: number
): [number, number, number, number] {
  const heat = max > 0 ? Math.min(1, value / max) : 0;
  const t = Math.pow(heat, 0.6); // lift low values so they're visible
  return [ramp[0], ramp[1], ramp[2], Math.floor(8 + t * 195)];
}
