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
    ramp: [230, 70, 40],
    metric: (d) => d.citationPerDay ?? 0,
  },
  {
    id: "oil",
    label: "Oil",
    legend: "Active wells per cell",
    ramp: [235, 170, 50],
    metric: (d) => d.ambient?.oilWellCount ?? 0,
  },
  {
    id: "deadanimals",
    label: "Carrion",
    legend: "Dead animals / day",
    ramp: [120, 200, 120],
    metric: (d) => d.deadAnimalPerDay ?? 0,
  },
];

export function getLayer(id: LayerId): MapLayer {
  return LAYERS.find((l) => l.id === id) ?? LAYERS[0];
}

/** Heat color for a metric layer: dark when 0, ramp color when at the max. */
export function metricColor(
  ramp: [number, number, number],
  value: number,
  max: number
): [number, number, number, number] {
  const heat = max > 0 ? Math.min(1, value / max) : 0;
  const t = Math.pow(heat, 0.6); // lift low values so they're visible
  const base = 14;
  const blend = (c: number) => Math.floor(base + (c - base) * t);
  return [blend(ramp[0]), blend(ramp[1]), blend(ramp[2]), Math.floor(40 + t * 180)];
}
