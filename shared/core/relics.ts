import type { GameEvent } from "./types";

/**
 * Relics are passive, universal modifiers (Slay-the-Spire style). Each is a
 * pure data object with optional hooks the tick engine applies. Adding a
 * relic is one entry here — no engine changes.
 *
 * Lore note (design doc §3): relics are named, never explained in-game.
 */
export interface YieldHookCtx {
  wells: number;
  level: number;
  exploited: boolean;
  events: GameEvent[]; // events on this hex this tick
}

export interface RelicDef {
  id: string;
  name: string;
  text: string;
  /** Multiplier applied to a hex's yield (default 1). */
  yieldMult?: (ctx: YieldHookCtx) => number;
  /** Flat crude added to a hex's yield (default 0). */
  yieldBonus?: (ctx: YieldHookCtx) => number;
  /** Multiplier on exploit degradation accrual (default 1). */
  degradeMult?: () => number;
  /** Short note shown in the dispatch when this relic fired on a hex. */
  note?: (ctx: YieldHookCtx) => string | null;
}

const sumMag = (events: GameEvent[], kind: string) =>
  events.filter((e) => e.kind === kind).reduce((a, e) => a + e.magnitude, 0);

export const RELICS: Record<string, RelicDef> = {
  derrick_governor: {
    id: "derrick_governor",
    name: "Derrick Governor",
    text: "Hexes with oil wells yield +25%.",
    yieldMult: (c) => (c.wells > 0 ? 1.25 : 1),
  },
  wildcatter: {
    id: "wildcatter",
    name: "Wildcatter's Nerve",
    text: "+1 crude from every hex you hold, each tick.",
    yieldBonus: () => 1,
  },
  carrion_rites: {
    id: "carrion_rites",
    name: "Carrion Rites",
    text: "Dead-animal activity on your land is a feast: +2 crude per report/day.",
    yieldBonus: (c) => Math.ceil(sumMag(c.events, "deadAnimal") * 2),
    note: (c) => (sumMag(c.events, "deadAnimal") > 0 ? "carrion feast" : null),
  },
  meter_maids_cut: {
    id: "meter_maids_cut",
    name: "Meter Maid's Cut",
    text: "Skim the citations: +1 crude per citation/day on your land.",
    yieldBonus: (c) => Math.ceil(sumMag(c.events, "citation")),
    note: (c) => (sumMag(c.events, "citation") > 0 ? "skimmed citations" : null),
  },
  tar_seal: {
    id: "tar_seal",
    name: "Tar Seal",
    text: "Your hexes degrade half as fast when exploited.",
    degradeMult: () => 0.5,
  },
};

export function relicDef(id: string): RelicDef | undefined {
  return RELICS[id];
}
