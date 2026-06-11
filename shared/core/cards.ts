/**
 * The cards — La Brea Madre's deck layer, pure and deterministic.
 *
 * Every card is POWER + COLOR + at most one RITE. The resolver (battle.ts)
 * only ever sees those three things; all the weirdness lives in names and
 * flavor text, which can be rewritten freely without touching balance.
 *
 * The three colors are the city's three strata, bottom to top:
 *
 *   BLACK   the under — tar, the faults, what the ground keeps. Kills quickly,
 *           no frills: big numbers, reckless rites, lanes that sink.
 *   BLUE    the middle — order, ordinance, parking. Protection and
 *           counterspells: wards that silence rites, bulwarks that hold deeds.
 *   WHITE   the upper — ascension, carrion, what circles overhead. The
 *           meta-game: phoenixes, medics, and poachers that STEAL beaten cards.
 *
 * There is NO color triangle — a mono-color binder is a school, not a
 * suicide pact. Color identity lives in the rites and the ground.
 *
 * Each color is strong on its home ground: BLACK on broken/tarry land,
 * BLUE on the ticket corridors, WHITE on the dead-animal fringe.
 *
 * Packs are opened with the game's own seeded RNG — same seed, same pulls.
 */
import type { RngState } from "./rng";
import { nextFloat } from "./rng";

export type Suit = "black" | "blue" | "white";

export type Rite =
  | { kind: "surge"; n: number } // +n on home terrain (stacks with affinity)
  | { kind: "reckless"; n: number } // BLACK: +n always — but it burns after the fight, win or lose
  | { kind: "sink" } // BLACK: the lane swallows both cards; nobody scores it
  | { kind: "ward" } // BLUE: the opposing card's rite does not fire
  | { kind: "bulwark"; n: number } // BLUE: +n when defending the deed
  | { kind: "flock"; n: number } // WHITE: +n per OTHER friendly white card in the fight
  | { kind: "phoenix" } // WHITE: never burned, wounded, or stolen — it walks away
  | { kind: "medic" } // WHITE: if it survives, one wounded card in your binder is healed
  | { kind: "poach" } // WHITE: a card it beats joins YOUR binder (wounded), forever
  | { kind: "predator"; vs: Suit; n: number } // +n against that color
  // Ripple rites — effects that flow down the line, lane i to lane i+1:
  | { kind: "vengeance"; n: number } // BLACK: when this card falls, your next lane +n
  | { kind: "rally"; n: number } // WHITE: when this card wins, your next lane +n
  | { kind: "omen"; n: number }; // BLUE: the foe's next lane fights at -n

export type Rarity = "common" | "uncommon" | "rare" | "mythic";

export interface CardDef {
  id: string;
  name: string;
  suit: Suit;
  power: number; // 1..9
  /**
   * WEIGHT 1..9: drawn hands are arranged light-to-heavy, so the light open
   * the night and the heavy close it. Ripple effects become plannable: a
   * featherweight martyr tends to fall early, a heavy closer tends to be
   * there to collect the vengeance. Tends to — the draw is still the dice.
   */
  weight: number;
  rite?: Rite;
  rarity: Rarity;
  /** Placeholder register — the details are the proprietor's department. */
  flavor: string;
}

// ─── The catalog (placeholder printings, v2 — the three strata) ───────────────

export const CATALOG: CardDef[] = [
  // BLACK — the under. Kill quickly, no frills. Grief flows downhill.
  { id: "b01", name: "HAIRLINE CRACK", suit: "black", power: 1, weight: 1, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "Started in the plaster. Didn't stop there." },
  { id: "b13", name: "FORESHOCK", suit: "black", power: 1, weight: 1, rite: { kind: "vengeance", n: 3 }, rarity: "common", flavor: "Never the main event. An announcement of one." },
  { id: "b14", name: "CANDLES ON THE GUARDRAIL", suit: "black", power: 2, weight: 2, rite: { kind: "vengeance", n: 2 }, rarity: "common", flavor: "Lit for the fallen. Felt by the next." },
  { id: "b02", name: "TAR SEEP", suit: "black", power: 2, weight: 3, rite: { kind: "reckless", n: 2 }, rarity: "common", flavor: "It was here before the street. It will be here after." },
  { id: "b03", name: "SEISMOGRAPH STRIP", suit: "black", power: 3, weight: 2, rite: { kind: "surge", n: 3 }, rarity: "common", flavor: "The needle wrote your name in its sleep." },
  { id: "b04", name: "CHANDELIER WARNING", suit: "black", power: 3, weight: 2, rarity: "common", flavor: "The first to know is always the glass." },
  { id: "b05", name: "AFTERSHOCK", suit: "black", power: 4, weight: 7, rite: { kind: "reckless", n: 2 }, rarity: "common", flavor: "You relaxed. That was the signal." },
  { id: "b06", name: "THE JOLT AT 3 A.M.", suit: "black", power: 5, weight: 5, rarity: "uncommon", flavor: "Magnitude small. Audience total." },
  { id: "b07", name: "DERRICK GHOST", suit: "black", power: 5, weight: 6, rite: { kind: "surge", n: 2 }, rarity: "uncommon", flavor: "Still pumping. Nothing comes up. Something goes down." },
  { id: "b08", name: "LIQUEFACTION CHOIR", suit: "black", power: 6, weight: 6, rite: { kind: "reckless", n: 2 }, rarity: "uncommon", flavor: "The ground sang. The foundations joined in." },
  { id: "b09", name: "LA BREA BUBBLES", suit: "black", power: 6, weight: 4, rite: { kind: "sink" }, rarity: "rare", flavor: "The tar accepts both parties." },
  { id: "b10", name: "EPICENTER BRIDE", suit: "black", power: 7, weight: 7, rite: { kind: "surge", n: 2 }, rarity: "rare", flavor: "Married to the fault line. Faithful." },
  { id: "b11", name: "THE BIG ONE (RUMOR OF)", suit: "black", power: 8, weight: 8, rite: { kind: "reckless", n: 3 }, rarity: "rare", flavor: "Spoken of only in futures contracts." },
  { id: "b12", name: "LA MADRE", suit: "black", power: 9, weight: 9, rite: { kind: "sink" }, rarity: "mythic", flavor: "She does not take sides. She takes both." },

  // BLUE — the middle. Protection, counterspells, paperwork that precedes you.
  { id: "u01", name: "EXPIRED METER", suit: "blue", power: 1, weight: 1, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "00:00, blinking, forever." },
  { id: "u13", name: "FINAL NOTICE", suit: "blue", power: 2, weight: 1, rite: { kind: "omen", n: 2 }, rarity: "common", flavor: "The envelope weighs nothing. The contents weigh on you." },
  { id: "u02", name: "THE METER MAID", suit: "blue", power: 2, weight: 2, rite: { kind: "bulwark", n: 3 }, rarity: "common", flavor: "She was writing your number before you parked." },
  { id: "u14", name: "CERTIFIED LETTER", suit: "blue", power: 3, weight: 3, rite: { kind: "omen", n: 3 }, rarity: "uncommon", flavor: "Signature required. Resistance optional, noted." },
  { id: "u03", name: "DMV BASILISK", suit: "blue", power: 3, weight: 4, rite: { kind: "ward" }, rarity: "common", flavor: "Take a number. Turn to stone." },
  { id: "u04", name: "STREET SWEEPER, TUESDAY", suit: "blue", power: 4, weight: 4, rarity: "common", flavor: "You knew. The sign knew you knew." },
  { id: "u05", name: "RED CURB PROPHET", suit: "blue", power: 4, weight: 3, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "He painted it himself. It counts." },
  { id: "u06", name: "ORDINANCE 80.69", suit: "blue", power: 3, weight: 5, rite: { kind: "ward" }, rarity: "uncommon", flavor: "Subsection (c) voids whatever you were about to do." },
  { id: "u07", name: "THE BOOT", suit: "blue", power: 5, weight: 6, rite: { kind: "bulwark", n: 3 }, rarity: "uncommon", flavor: "Yellow. Final." },
  { id: "u08", name: "TOW TRUCK SANTA GERTRUDIS", suit: "blue", power: 5, weight: 5, rite: { kind: "predator", vs: "white", n: 3 }, rarity: "uncommon", flavor: "Patron saint of the impound lot. Tows the dead too." },
  { id: "u09", name: "PARKING ENFORCEMENT HELICOPTER", suit: "blue", power: 6, weight: 3, rarity: "uncommon", flavor: "There is no budget line for it. It flies anyway." },
  { id: "u10", name: "NOTARY OF THE CURB", suit: "blue", power: 6, weight: 5, rite: { kind: "ward" }, rarity: "rare", flavor: "Her stamp annuls miracles." },
  { id: "u11", name: "THE 405 AT DUSK", suit: "blue", power: 7, weight: 9, rite: { kind: "bulwark", n: 3 }, rarity: "rare", flavor: "Nothing moves. Everything holds." },
  { id: "u12", name: "THE GREAT GRIDLOCK", suit: "blue", power: 9, weight: 9, rarity: "mythic", flavor: "One day it simply did not unlock." },

  // WHITE — the upper. The flock manages the game itself. What rises, lifts.
  { id: "w01", name: "ROADSIDE POSSUM", suit: "white", power: 1, weight: 1, rite: { kind: "flock", n: 1 }, rarity: "common", flavor: "It was already playing dead. Now it's playing." },
  { id: "w13", name: "THE UPDRAFT", suit: "white", power: 3, weight: 1, rite: { kind: "rally", n: 3 }, rarity: "common", flavor: "What rises first lifts the rest." },
  { id: "w02", name: "PIGEON JURY", suit: "white", power: 2, weight: 2, rite: { kind: "flock", n: 1 }, rarity: "common", flavor: "Twelve of them. All guilty." },
  { id: "w14", name: "DAWN CHORUS", suit: "white", power: 3, weight: 2, rite: { kind: "rally", n: 2 }, rarity: "common", flavor: "The first note wins the morning." },
  { id: "w03", name: "RACCOON IN THE WALLS", suit: "white", power: 3, weight: 3, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "The county was called. The county did not come." },
  { id: "w04", name: "THE HUNDRED RATS OF SPRING ST", suit: "white", power: 2, weight: 2, rite: { kind: "flock", n: 2 }, rarity: "uncommon", flavor: "Individually, a report. Together, a precinct." },
  { id: "w05", name: "EL COYOTE DEL ARROYO", suit: "white", power: 4, weight: 4, rite: { kind: "phoenix" }, rarity: "uncommon", flavor: "Beaten Tuesday. Back Wednesday." },
  { id: "w06", name: "THE CROW THAT COUNTS", suit: "white", power: 5, weight: 4, rite: { kind: "predator", vs: "blue", n: 3 }, rarity: "uncommon", flavor: "It has memorized your plate." },
  { id: "w07", name: "GRIFFITH PARK STAG", suit: "white", power: 5, weight: 6, rite: { kind: "surge", n: 3 }, rarity: "uncommon", flavor: "Filed under: deceased, majestic." },
  { id: "w08", name: "OPOSSUM MADONNA", suit: "white", power: 4, weight: 5, rite: { kind: "medic" }, rarity: "rare", flavor: "Eleven on her back. There is always room for a twelfth." },
  { id: "w09", name: "THE MAGPIE ASSESSOR", suit: "white", power: 3, weight: 6, rite: { kind: "poach" }, rarity: "rare", flavor: "Everything shiny is, on inspection, hers." },
  { id: "w10", name: "VULTURE OVER VAN NUYS", suit: "white", power: 6, weight: 8, rite: { kind: "poach" }, rarity: "mythic", flavor: "Patience, at altitude. What falls is collected." },
  { id: "w11", name: "ANGEL OF THE OVERPASS", suit: "white", power: 7, weight: 7, rite: { kind: "medic" }, rarity: "rare", flavor: "Four lanes below her, everything is forgiven." },
  { id: "w12", name: "SAINT OF THE DEAD DOG", suit: "white", power: 8, weight: 8, rite: { kind: "phoenix" }, rarity: "mythic", flavor: "Good boy. Eternal boy." },
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
