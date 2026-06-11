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
  | { kind: "flock"; n: number } // +n per OTHER friendly card of THIS card's color — kin run together
  | { kind: "phoenix" } // WHITE: never burned, wounded, or stolen — it walks away
  | { kind: "medic" } // WHITE: if it survives, one wounded card in your binder is healed
  | { kind: "poach" } // WHITE: a card it beats joins YOUR binder (wounded), forever
  | { kind: "predator"; vs: Suit; n: number } // +n against that color
  // Ripple rites — effects that flow down the line, lane i to lane i+1:
  | { kind: "vengeance"; n: number } // BLACK: when this card falls, the grudge grows +n until night ends
  | { kind: "rally"; n: number } // WHITE: when this card wins, your next lane +n
  | { kind: "omen"; n: number } // BLUE: the foe's next lane fights at -n
  | { kind: "haunt"; n: number } // BLACK: when this card falls, the foe's next lane fights at -n
  | { kind: "anchor" } // BLUE: the impound — the opposing card loses its home ground (affinity + surge)
  | { kind: "crescendo"; n: number }; // +n per lane index — it builds as the night goes

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

  // ── more BLACK printings (v3: designed against the fun evals) ──
  { id: "b15", name: "GAS LEAK LULLABY", suit: "black", power: 1, weight: 1, rite: { kind: "haunt", n: 2 }, rarity: "common", flavor: "You won't smell it in your sleep." },
  { id: "b16", name: "PAVEMENT BLISTER", suit: "black", power: 2, weight: 2, rite: { kind: "haunt", n: 2 }, rarity: "common", flavor: "Step on it. Go on." },
  { id: "b17", name: "MUDSLIDE CHORUS", suit: "black", power: 2, weight: 3, rite: { kind: "flock", n: 1 }, rarity: "common", flavor: "One voice is silt. A choir is the street, leaving." },
  { id: "b18", name: "THE SETTLING", suit: "black", power: 2, weight: 4, rite: { kind: "crescendo", n: 1 }, rarity: "common", flavor: "Houses talk at night. This is what they say." },
  { id: "b19", name: "CRACKED MAIN ON 6TH", suit: "black", power: 3, weight: 3, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "The city's water, freelancing." },
  { id: "b20", name: "WIDOW OF THE INTERCHANGE", suit: "black", power: 2, weight: 2, rite: { kind: "vengeance", n: 2 }, rarity: "common", flavor: "She knew the merge was bad." },
  { id: "b21", name: "SUMP PUMP PSALM", suit: "black", power: 4, weight: 4, rarity: "common", flavor: "It prays all night. It loses every dawn." },
  { id: "b22", name: "THE UNPERMITTED BASEMENT", suit: "black", power: 3, weight: 3, rite: { kind: "reckless", n: 2 }, rarity: "common", flavor: "Dug deep. Filed nothing." },
  { id: "b23", name: "OILBIRD", suit: "black", power: 3, weight: 2, rarity: "common", flavor: "Feathers of the old fields. It does not migrate." },
  { id: "b24", name: "BONES IN THE FOUNDATION", suit: "black", power: 2, weight: 5, rite: { kind: "flock", n: 1 }, rarity: "common", flavor: "The inspector signed off. The inspector is in there." },
  { id: "b25", name: "TAR PIGEON", suit: "black", power: 2, weight: 2, rite: { kind: "reckless", n: 1 }, rarity: "common", flavor: "It landed once." },
  { id: "b26", name: "FAULT GOSSIP", suit: "black", power: 1, weight: 1, rite: { kind: "haunt", n: 3 }, rarity: "common", flavor: "The ground hears everything you bury in it." },
  { id: "b27", name: "THE CONDEMNED STAIRS", suit: "black", power: 4, weight: 5, rarity: "common", flavor: "Forty-one steps. Officially, none." },
  { id: "b28", name: "SECOND FORESHOCK", suit: "black", power: 2, weight: 1, rite: { kind: "vengeance", n: 3 }, rarity: "uncommon", flavor: "The announcement, repeated. For the cheap seats." },
  { id: "b29", name: "THE 2 A.M. WIDENING", suit: "black", power: 3, weight: 6, rite: { kind: "crescendo", n: 2 }, rarity: "uncommon", flavor: "The crack measures itself nightly." },
  { id: "b30", name: "DERRICK CHOIR", suit: "black", power: 4, weight: 6, rite: { kind: "flock", n: 2 }, rarity: "uncommon", flavor: "Pumpjacks in unison. The hymn is extraction." },
  { id: "b31", name: "METHANE BLOOM", suit: "black", power: 5, weight: 4, rite: { kind: "reckless", n: 3 }, rarity: "uncommon", flavor: "The flower of the under. Do not pick it." },
  { id: "b32", name: "THE SWALLOWED PORSCHE", suit: "black", power: 6, weight: 7, rarity: "uncommon", flavor: "Still under warranty. Still under Wilshire." },
  { id: "b33", name: "GROUND TRUTH", suit: "black", power: 4, weight: 5, rite: { kind: "surge", n: 3 }, rarity: "uncommon", flavor: "Surveyors call it datum. The datum moved." },
  { id: "b34", name: "MOURNERS' CARPOOL", suit: "black", power: 4, weight: 5, rite: { kind: "vengeance", n: 2 }, rarity: "uncommon", flavor: "They ride together. They arrive angry." },
  { id: "b35", name: "THE LISTING DUPLEX", suit: "black", power: 5, weight: 6, rite: { kind: "haunt", n: 3 }, rarity: "uncommon", flavor: "Leans on its neighbor. Then onto yours." },
  { id: "b36", name: "TAR MAJORDOMO", suit: "black", power: 6, weight: 7, rite: { kind: "flock", n: 2 }, rarity: "rare", flavor: "It keeps the pit's appointments. You have one." },
  { id: "b37", name: "THE NIGHT THE HILLS MOVED", suit: "black", power: 6, weight: 8, rite: { kind: "crescendo", n: 2 }, rarity: "rare", flavor: "Nobody filed a flight plan for the hillside." },
  { id: "b38", name: "GRIEF ENGINE", suit: "black", power: 3, weight: 3, rite: { kind: "vengeance", n: 4 }, rarity: "rare", flavor: "Runs on what you lost. Never idles." },
  { id: "b39", name: "SISTER OF THE BUBBLES", suit: "black", power: 5, weight: 3, rite: { kind: "sink" }, rarity: "rare", flavor: "The tar has family. The family visits." },
  { id: "b40", name: "THE PERMANENT AFTER", suit: "black", power: 7, weight: 7, rite: { kind: "reckless", n: 4 }, rarity: "rare", flavor: "There is no before anymore." },
  { id: "b41", name: "CURFEW OF THE FAULTS", suit: "black", power: 6, weight: 8, rite: { kind: "haunt", n: 4 }, rarity: "rare", flavor: "When it breaks, everything else stays in." },
  { id: "b42", name: "EL GRAN HUNDIMIENTO", suit: "black", power: 7, weight: 9, rite: { kind: "crescendo", n: 2 }, rarity: "mythic", flavor: "The great subsidence. RSVP not required; attendance is." },

  // ── more BLUE printings (v3: designed against the fun evals) ──
  { id: "u15", name: "THE IMPOUND NOTICE", suit: "blue", power: 2, weight: 2, rite: { kind: "anchor" }, rarity: "common", flavor: "Your car is not where you left it. Nothing is." },
  { id: "u16", name: "CROSSING GUARD EMERITUS", suit: "blue", power: 2, weight: 3, rite: { kind: "bulwark", n: 2 }, rarity: "common", flavor: "Retired in 1987. Still out there." },
  { id: "u17", name: "PERMIT IN TRIPLICATE", suit: "blue", power: 2, weight: 6, rite: { kind: "ward" }, rarity: "common", flavor: "The third copy is load-bearing." },
  { id: "u18", name: "YELLOW PAINT, FRESH", suit: "blue", power: 3, weight: 2, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "Wet enough to mean it." },
  { id: "u19", name: "THE ODD-EVEN ORDINANCE", suit: "blue", power: 2, weight: 2, rite: { kind: "omen", n: 2 }, rarity: "common", flavor: "Today is neither. Pay anyway." },
  { id: "u20", name: "LUNCH BREAK, UNION", suit: "blue", power: 4, weight: 4, rarity: "common", flavor: "Twelve to one. The city holds its breath." },
  { id: "u21", name: "THE CITATION PRINTER", suit: "blue", power: 2, weight: 3, rite: { kind: "flock", n: 1 }, rarity: "common", flavor: "It jams only for mercy, which is never." },
  { id: "u22", name: "CURB FEELER", suit: "blue", power: 1, weight: 1, rite: { kind: "omen", n: 1 }, rarity: "common", flavor: "It knows where you'll park before you do." },
  { id: "u23", name: "MOTORCYCLE COP, DECORATIVE", suit: "blue", power: 3, weight: 3, rite: { kind: "predator", vs: "black", n: 2 }, rarity: "common", flavor: "Parked on the fault line. Writing it up." },
  { id: "u24", name: "THE WAITING ROOM", suit: "blue", power: 3, weight: 5, rite: { kind: "crescendo", n: 1 }, rarity: "common", flavor: "Now serving number 4. You are number 339." },
  { id: "u25", name: "SCHOOL ZONE, ETERNAL", suit: "blue", power: 1, weight: 2, rite: { kind: "bulwark", n: 3 }, rarity: "common", flavor: "The children crossed decades ago. Slow down forever." },
  { id: "u26", name: "RED LIGHT CAMERA SAINT", suit: "blue", power: 3, weight: 2, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "It blinks once for absolution. It has never blinked." },
  { id: "u27", name: "TRAFFIC CONE GOLEM", suit: "blue", power: 2, weight: 1, rarity: "common", flavor: "Animate. Orange. Municipal." },
  { id: "u28", name: "SIGN SPINNER OF THE APOCALYPSE", suit: "blue", power: 4, weight: 3, rarity: "common", flavor: "EVERYTHING MUST GO, it spins. Everything goes." },
  { id: "u29", name: "THE SUPERVISOR'S SUPERVISOR", suit: "blue", power: 4, weight: 6, rite: { kind: "ward" }, rarity: "uncommon", flavor: "She does not take meetings. Meetings are taken to her." },
  { id: "u30", name: "VALET CONSPIRACY", suit: "blue", power: 3, weight: 4, rite: { kind: "flock", n: 2 }, rarity: "uncommon", flavor: "Where do the cars go? They know. They all know." },
  { id: "u31", name: "THE DOUBLE-PARKED HEARSE", suit: "blue", power: 4, weight: 5, rite: { kind: "anchor" }, rarity: "uncommon", flavor: "Even the dead get cited. Especially the dead." },
  { id: "u32", name: "ASSESSOR'S MIDNIGHT RIDE", suit: "blue", power: 4, weight: 4, rite: { kind: "crescendo", n: 2 }, rarity: "uncommon", flavor: "One if by land. Two if by land. It's all land." },
  { id: "u33", name: "THE METER MAID'S MOTHER", suit: "blue", power: 4, weight: 5, rite: { kind: "bulwark", n: 3 }, rarity: "uncommon", flavor: "Where do you think she learned it?" },
  { id: "u34", name: "INJUNCTION, GRANTED", suit: "blue", power: 3, weight: 4, rite: { kind: "omen", n: 3 }, rarity: "uncommon", flavor: "Whatever you were doing — stop." },
  { id: "u35", name: "TOW CHAIN ROSARY", suit: "blue", power: 5, weight: 5, rite: { kind: "predator", vs: "white", n: 3 }, rarity: "uncommon", flavor: "Fifty-nine links. One per impounded soul." },
  { id: "u36", name: "THE PAPERWORK ITSELF", suit: "blue", power: 5, weight: 7, rite: { kind: "ward" }, rarity: "uncommon", flavor: "Not the form. The Platonic form." },
  { id: "u37", name: "THE HEARING, POSTPONED", suit: "blue", power: 6, weight: 6, rite: { kind: "anchor" }, rarity: "rare", flavor: "Continuance granted. Continuance eternal." },
  { id: "u38", name: "GRIDLOCK'S DAUGHTER", suit: "blue", power: 6, weight: 7, rite: { kind: "flock", n: 2 }, rarity: "rare", flavor: "Born on the 110. Never left." },
  { id: "u39", name: "THE FINAL FINAL NOTICE", suit: "blue", power: 3, weight: 3, rite: { kind: "omen", n: 4 }, rarity: "rare", flavor: "There is one more after this. There always is." },
  { id: "u40", name: "CHIEF OF PARKING, EMERITUS", suit: "blue", power: 6, weight: 8, rite: { kind: "bulwark", n: 4 }, rarity: "rare", flavor: "His shadow still falls across loading zones." },
  { id: "u41", name: "MUNICIPAL EXORCIST", suit: "blue", power: 7, weight: 6, rite: { kind: "ward" }, rarity: "rare", flavor: "She does not cast out demons. She denies their permits." },
  { id: "u42", name: "THE CODE ITSELF", suit: "blue", power: 8, weight: 9, rite: { kind: "ward" }, rarity: "mythic", flavor: "It cannot be read. Only obeyed." },

  // ── more WHITE printings (v3: designed against the fun evals) ──
  { id: "w15", name: "SPARROW AUDIT", suit: "white", power: 1, weight: 1, rite: { kind: "flock", n: 1 }, rarity: "common", flavor: "Small. Numerous. Thorough." },
  { id: "w16", name: "THE OPOSSUM'S UNDERSTUDY", suit: "white", power: 2, weight: 3, rite: { kind: "phoenix" }, rarity: "common", flavor: "Knows the role by heart: drop, wait, rise." },
  { id: "w17", name: "GULL OF THE LANDFILL", suit: "white", power: 2, weight: 2, rite: { kind: "flock", n: 1 }, rarity: "common", flavor: "Inland sea bird. The sea is garbage. It is king." },
  { id: "w18", name: "MOURNING DOVE", suit: "white", power: 2, weight: 3, rite: { kind: "medic" }, rarity: "common", flavor: "Its song is for the others. It always is." },
  { id: "w19", name: "THE ANT QUESTION", suit: "white", power: 1, weight: 1, rite: { kind: "flock", n: 2 }, rarity: "common", flavor: "Not whether they will come. Only when." },
  { id: "w20", name: "SQUIRREL WITH A PLAN", suit: "white", power: 2, weight: 1, rite: { kind: "rally", n: 2 }, rarity: "common", flavor: "You've seen it cross. You know it has one." },
  { id: "w21", name: "FERAL CHIHUAHUA MOB", suit: "white", power: 3, weight: 2, rite: { kind: "flock", n: 1 }, rarity: "common", flavor: "Four pounds each. Furious beyond measure." },
  { id: "w22", name: "THE PIGEON UPSTAIRS", suit: "white", power: 3, weight: 3, rite: { kind: "surge", n: 2 }, rarity: "common", flavor: "Moved in over the awning. Pays nothing." },
  { id: "w23", name: "SAINTLY RACCOON, LAPSED", suit: "white", power: 4, weight: 4, rarity: "common", flavor: "Took vows. Took the trash too." },
  { id: "w24", name: "CROW FUNERAL", suit: "white", power: 2, weight: 2, rite: { kind: "rally", n: 2 }, rarity: "common", flavor: "They gather, they grieve, they remember your face." },
  { id: "w25", name: "HAWK OVER THE OFF-RAMP", suit: "white", power: 3, weight: 3, rite: { kind: "predator", vs: "black", n: 2 }, rarity: "common", flavor: "It hunts what the ground gives up." },
  { id: "w26", name: "PALM RAT NATIVITY", suit: "white", power: 2, weight: 2, rite: { kind: "flock", n: 1 }, rarity: "common", flavor: "Born in the fronds. Raised on the wires." },
  { id: "w27", name: "ASCENSION VIA UPDRAFT", suit: "white", power: 2, weight: 4, rite: { kind: "crescendo", n: 1 }, rarity: "common", flavor: "Going up. Everything here is, eventually." },
  { id: "w28", name: "THE SECOND COYOTE", suit: "white", power: 3, weight: 5, rite: { kind: "phoenix" }, rarity: "common", flavor: "There is always a second coyote." },
  { id: "w29", name: "THE PARLIAMENT OF GULLS", suit: "white", power: 4, weight: 4, rite: { kind: "flock", n: 2 }, rarity: "uncommon", flavor: "Quorum is screaming. Quorum is always met." },
  { id: "w30", name: "MAGPIE'S APPRENTICE", suit: "white", power: 2, weight: 4, rite: { kind: "poach" }, rarity: "uncommon", flavor: "Still learning what shines. Learning fast." },
  { id: "w31", name: "VETERINARIAN SAINT, DEFROCKED", suit: "white", power: 4, weight: 5, rite: { kind: "medic" }, rarity: "uncommon", flavor: "License revoked. Hands still good." },
  { id: "w32", name: "THE THERMAL ESCALATOR", suit: "white", power: 3, weight: 2, rite: { kind: "rally", n: 3 }, rarity: "uncommon", flavor: "First one up holds the door." },
  { id: "w33", name: "PEACOCK DIASPORA", suit: "white", power: 4, weight: 3, rite: { kind: "surge", n: 3 }, rarity: "uncommon", flavor: "Arcadia could not hold them." },
  { id: "w34", name: "THE BONE ORCHARD DOCENT", suit: "white", power: 3, weight: 5, rite: { kind: "crescendo", n: 2 }, rarity: "uncommon", flavor: "This way, please. Everything here used to fight." },
  { id: "w35", name: "TURKEY VULTURE PICKET LINE", suit: "white", power: 4, weight: 6, rite: { kind: "flock", n: 2 }, rarity: "uncommon", flavor: "ON STRIKE: WILL NOT WAIT FOR YOU TO FINISH DYING." },
  { id: "w36", name: "NINE LIVES, AUDITED", suit: "white", power: 5, weight: 6, rite: { kind: "phoenix" }, rarity: "uncommon", flavor: "Seven remaining. The county is counting." },
  { id: "w37", name: "THE FLOCK ENTIRE", suit: "white", power: 3, weight: 4, rite: { kind: "flock", n: 3 }, rarity: "rare", flavor: "Not a bird. The idea of birds." },
  { id: "w38", name: "CONDOR BANKRUPTCY LAWYER", suit: "white", power: 5, weight: 7, rite: { kind: "poach" }, rarity: "rare", flavor: "Circles your estate. Files at the moment of death." },
  { id: "w39", name: "OUR LADY OF THE OVERTURNED BIN", suit: "white", power: 6, weight: 6, rite: { kind: "medic" }, rarity: "rare", flavor: "Feast night. All are fed. All are forgiven." },
  { id: "w40", name: "THE RAPTURE OF GRIFFITH PARK", suit: "white", power: 4, weight: 7, rite: { kind: "crescendo", n: 3 }, rarity: "rare", flavor: "The animals went first. They always do." },
  { id: "w41", name: "ALPHA PIGEON", suit: "white", power: 6, weight: 6, rite: { kind: "flock", n: 2 }, rarity: "rare", flavor: "The one the statue fears." },
  { id: "w42", name: "THE BIRD KING", suit: "white", power: 7, weight: 8, rite: { kind: "flock", n: 3 }, rarity: "mythic", flavor: "All of them. At once." },
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
