/**
 * The cards — La Brea Madre's deck layer, pure and deterministic.
 *
 * Every card is POWER + SUIT + at most one RITE. The resolver (battle.ts)
 * only ever sees those three things; all the weirdness lives in names and
 * flavor text, which can be rewritten freely without touching balance.
 *
 * Suits are the city's three faces, each strong on its real terrain:
 *   CARRION   the dead-animal fringe        (strong where the city calls)
 *   MACHINE   the meter-and-tow corridors   (strong where tickets are written)
 *   TREMOR    the Madre's children          (strong on broken ground)
 *
 * The counter triangle: carrion picks the machine clean, the machine is
 * bolted against the tremor, the tremor opens the earth under the carrion.
 *
 * Packs are opened with the game's own seeded RNG — same seed, same pulls.
 */
import type { RngState } from "./rng";
import { nextFloat } from "./rng";

export type Suit = "carrion" | "machine" | "tremor";

export type Rite =
  | { kind: "surge"; n: number } // +n on home terrain (stacks with affinity)
  | { kind: "phoenix" } // when beaten, it is not exhausted/burned — it returns
  | { kind: "sink" } // the lane swallows both cards: nobody scores it
  | { kind: "pack"; n: number } // +n per OTHER friendly carrion card in the fight
  | { kind: "predator"; vs: Suit; n: number }; // +n against that suit

export type Rarity = "common" | "uncommon" | "rare" | "mythic";

export interface CardDef {
  id: string;
  name: string;
  suit: Suit;
  power: number; // 1..9
  rite?: Rite;
  rarity: Rarity;
  /** Placeholder register — the details are the proprietor's department. */
  flavor: string;
}

/** The counter triangle: who each suit is strong against. */
export const COUNTERS: Record<Suit, Suit> = {
  carrion: "machine",
  machine: "tremor",
  tremor: "carrion",
};

// ─── The catalog (placeholder printings, v1) ──────────────────────────────────

export const CATALOG: CardDef[] = [
  // CARRION — the fringe eats
  { id: "c01", name: "ROADSIDE POSSUM", suit: "carrion", power: 1, rite: { kind: "pack", n: 1 }, rarity: "common", flavor: "It was already playing dead. Now it's playing." },
  { id: "c02", name: "PIGEON JURY", suit: "carrion", power: 2, rite: { kind: "pack", n: 1 }, rarity: "common", flavor: "Twelve of them. All guilty." },
  { id: "c03", name: "RACCOON IN THE WALLS", suit: "carrion", power: 3, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "The county was called. The county did not come." },
  { id: "c04", name: "EL COYOTE DEL ARROYO", suit: "carrion", power: 4, rite: { kind: "phoenix" }, rarity: "uncommon", flavor: "Beaten Tuesday. Back Wednesday." },
  { id: "c05", name: "THE CROW THAT COUNTS", suit: "carrion", power: 5, rite: { kind: "predator", vs: "machine", n: 3 }, rarity: "uncommon", flavor: "It has memorized your plate." },
  { id: "c06", name: "GRIFFITH PARK STAG", suit: "carrion", power: 5, rite: { kind: "surge", n: 3 }, rarity: "uncommon", flavor: "Filed under: deceased, majestic." },
  { id: "c07", name: "OPOSSUM MADONNA", suit: "carrion", power: 6, rite: { kind: "pack", n: 1 }, rarity: "rare", flavor: "Eleven on her back, all of them owed." },
  { id: "c08", name: "VULTURE OVER VAN NUYS", suit: "carrion", power: 7, rarity: "rare", flavor: "Patience, at altitude." },
  { id: "c09", name: "THE HUNDRED RATS OF SPRING ST", suit: "carrion", power: 2, rite: { kind: "pack", n: 2 }, rarity: "uncommon", flavor: "Individually, a report. Together, a precinct." },
  { id: "c10", name: "SAINT OF THE DEAD DOG", suit: "carrion", power: 8, rite: { kind: "phoenix" }, rarity: "mythic", flavor: "Good boy. Eternal boy." },

  // MACHINE — the corridor collects
  { id: "m01", name: "EXPIRED METER", suit: "machine", power: 1, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "00:00, blinking, forever." },
  { id: "m02", name: "THE METER MAID", suit: "machine", power: 2, rite: { kind: "surge", n: 3 }, rarity: "common", flavor: "She was writing your number before you parked." },
  { id: "m03", name: "DMV BASILISK", suit: "machine", power: 3, rite: { kind: "predator", vs: "tremor", n: 2 }, rarity: "common", flavor: "Take a number. Turn to stone." },
  { id: "m04", name: "STREET SWEEPER, TUESDAY", suit: "machine", power: 4, rarity: "common", flavor: "You knew. The sign knew you knew." },
  { id: "m05", name: "RED CURB PROPHET", suit: "machine", power: 4, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "He painted it himself. It counts." },
  { id: "m06", name: "THE BOOT", suit: "machine", power: 5, rarity: "uncommon", flavor: "Yellow. Final." },
  { id: "m07", name: "TOW TRUCK SANTA GERTRUDIS", suit: "machine", power: 5, rite: { kind: "predator", vs: "carrion", n: 2 }, rarity: "uncommon", flavor: "Patron saint of the impound lot." },
  { id: "m08", name: "PARKING ENFORCEMENT HELICOPTER", suit: "machine", power: 6, rarity: "uncommon", flavor: "There is no budget line for it. It flies anyway." },
  { id: "m09", name: "THE 405 AT DUSK", suit: "machine", power: 7, rarity: "rare", flavor: "Nothing moves. Everything burns." },
  { id: "m10", name: "THE GREAT GRIDLOCK", suit: "machine", power: 9, rarity: "mythic", flavor: "One day it simply did not unlock." },

  // TREMOR — the ground remembers
  { id: "t01", name: "HAIRLINE CRACK", suit: "tremor", power: 1, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "Started in the plaster. Didn't stop there." },
  { id: "t02", name: "CHANDELIER WARNING", suit: "tremor", power: 2, rarity: "common", flavor: "The first to know is always the glass." },
  { id: "t03", name: "SEISMOGRAPH STRIP", suit: "tremor", power: 3, rite: { kind: "surge", n: 3 }, rarity: "common", flavor: "The needle wrote your name in its sleep." },
  { id: "t04", name: "THE RETROFIT INSPECTOR", suit: "tremor", power: 3, rite: { kind: "predator", vs: "machine", n: 3 }, rarity: "common", flavor: "He taps the bolt. The bolt confesses." },
  { id: "t05", name: "AFTERSHOCK", suit: "tremor", power: 4, rite: { kind: "phoenix" }, rarity: "common", flavor: "You relaxed. That was the signal." },
  { id: "t06", name: "LIQUEFACTION CHOIR", suit: "tremor", power: 4, rite: { kind: "surge", n: 2 }, rarity: "uncommon", flavor: "The ground sang. The foundations joined in." },
  { id: "t07", name: "THE JOLT AT 3 A.M.", suit: "tremor", power: 5, rarity: "uncommon", flavor: "Magnitude small. Audience total." },
  { id: "t08", name: "LA BREA BUBBLES", suit: "tremor", power: 6, rite: { kind: "sink" }, rarity: "rare", flavor: "The tar accepts both parties." },
  { id: "t09", name: "EPICENTER BRIDE", suit: "tremor", power: 7, rite: { kind: "surge", n: 2 }, rarity: "rare", flavor: "Married to the fault line. Faithful." },
  { id: "t10", name: "LA MADRE", suit: "tremor", power: 9, rite: { kind: "sink" }, rarity: "mythic", flavor: "She does not take sides. She takes both." },
];

export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(
  CATALOG.map((c) => [c.id, c])
);

// ─── Packs ─────────────────────────────────────────────────────────────────────

const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 0.6,
  uncommon: 0.25,
  rare: 0.12,
  mythic: 0.03,
};

const BY_RARITY: Record<Rarity, CardDef[]> = {
  common: CATALOG.filter((c) => c.rarity === "common"),
  uncommon: CATALOG.filter((c) => c.rarity === "uncommon"),
  rare: CATALOG.filter((c) => c.rarity === "rare"),
  mythic: CATALOG.filter((c) => c.rarity === "mythic"),
};

function rollRarity(rng: RngState): Rarity {
  let r = nextFloat(rng);
  for (const rarity of ["common", "uncommon", "rare", "mythic"] as Rarity[]) {
    r -= RARITY_WEIGHT[rarity];
    if (r <= 0) return rarity;
  }
  return "common";
}

/** Rip a pack: `size` card ids, rarity-weighted, from the given RNG. */
export function openPack(rng: RngState, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < size; i++) {
    const pool = BY_RARITY[rollRarity(rng)];
    out.push(pool[Math.floor(nextFloat(rng) * pool.length)].id);
  }
  return out;
}

/** A new player's starter binder: a modest, honest spread of commons. */
export function starterBinder(rng: RngState, size: number): string[] {
  const commons = BY_RARITY.common;
  const out: string[] = [];
  for (let i = 0; i < size; i++) {
    out.push(commons[Math.floor(nextFloat(rng) * commons.length)].id);
  }
  return out;
}
