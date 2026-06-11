/**
 * Dashboard Saints — the relics hanging from your rearview mirror.
 *
 * Forged at the fossil gallery: feed the bones of your burned rares and
 * mythics to the tar and something else comes back. A player carries at
 * most `raids.saintSlots` (3) saints, forever. Saints don't fight — they
 * bend the rules every fight is fought under, which is where builds stop
 * being arithmetic and start being identities.
 *
 * Effects live in three places, all deterministic:
 *   resolver  (battle.ts)  power/tie modifications, lane by lane
 *   fates     (game.ts)    what happens to the beaten at dawn
 *   economy   (game.ts)    stakes and escrow
 */
import type { Suit } from "./cards";

export type SaintEffect =
  | { kind: "tiebreaker" } // your lane ties become wins; a tied raid falls to you
  | { kind: "closer" } // your final-lane card fights twice (adds its base power again)
  | { kind: "karma"; per: number; max: number } // +1 all lanes per `per` fossils, capped
  | { kind: "jumper" } // your reckless cards that WIN their lane don't burn
  | { kind: "suitBoost"; suit: Suit; n: number } // all your cards of that color +n
  | { kind: "ghost"; n: number } // your phoenixes +n
  | { kind: "lostCause" }; // a failed raid's stake comes home anyway

export interface SaintDef {
  id: string;
  name: string;
  effect: SaintEffect;
  /** Fossils consumed at the forge — the tar takes payment in bone. */
  fossilCost: number;
  flavor: string;
}

export const SAINTS: SaintDef[] = [
  {
    id: "s_dice",
    name: "THE FUZZY DICE",
    effect: { kind: "tiebreaker" },
    fossilCost: 5,
    flavor: "House rules say ties defend. The dice have never read the house rules.",
  },
  {
    id: "s_fernando",
    name: "ST. FERNANDO OF THE REAR-VIEW",
    effect: { kind: "closer" },
    fossilCost: 4,
    flavor: "Objects in the last lane are stronger than they appear.",
  },
  {
    id: "s_karma",
    name: "THE PARKING KARMA LEDGER",
    effect: { kind: "karma", per: 3, max: 3 },
    fossilCost: 3,
    flavor: "Every loss is an entry. Every entry accrues interest.",
  },
  {
    id: "s_jumper",
    name: "THE JUMPER CABLES",
    effect: { kind: "jumper" },
    fossilCost: 4,
    flavor: "Dead by its own nature; back by lunch.",
  },
  {
    id: "s_madre",
    name: "ST. MADRE OF THE OPEN FAULT",
    effect: { kind: "suitBoost", suit: "black", n: 1 },
    fossilCost: 3,
    flavor: "She blesses what she intends to swallow.",
  },
  {
    id: "s_meters",
    name: "OUR LADY OF PERPETUAL METERS",
    effect: { kind: "suitBoost", suit: "blue", n: 1 },
    fossilCost: 3,
    flavor: "Exact change, eternal change.",
  },
  {
    id: "s_thermals",
    name: "BISHOP OF THE THERMALS",
    effect: { kind: "suitBoost", suit: "white", n: 1 },
    fossilCost: 3,
    flavor: "His diocese is everything above the power lines.",
  },
  {
    id: "s_ghost",
    name: "GHOST OF THE 6TH STREET BRIDGE",
    effect: { kind: "ghost", n: 2 },
    fossilCost: 4,
    flavor: "Demolished. Still standing, if you ask it.",
  },
  {
    id: "s_lostcause",
    name: "PATRON OF LOST CAUSES",
    effect: { kind: "lostCause" },
    fossilCost: 3,
    flavor: "He has never once won. He has never once paid.",
  },
];

export const SAINT_BY_ID: Record<string, SaintDef> = Object.fromEntries(
  SAINTS.map((s) => [s.id, s])
);

/** What a side carries into a battle: its saints and its fossil count. */
export interface BattleMods {
  saints: SaintDef[];
  fossils: number;
}

export const NO_MODS: BattleMods = { saints: [], fossils: 0 };

export function hasSaint(mods: BattleMods | undefined, kind: SaintEffect["kind"]): boolean {
  return !!mods?.saints.some((s) => s.effect.kind === kind);
}
