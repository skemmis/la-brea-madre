/**
 * Battle resolution — five cards a side, lane by lane, on real ground.
 *
 * Pure function of (attacker cards, defender cards, terrain): no RNG inside.
 * The luck happened earlier, at the draw; the resolver is the courtroom.
 *
 * A lane's effective power = base
 *   + 2 if the card stands on its home terrain (affinity)
 *   + 2 if it counters the opposing card's suit (the triangle)
 *   + its rite, if any (surge / pack / predator)
 * Higher power takes the lane; equal power, nobody does. SINK swallows the
 * lane whole. Most lanes wins the battle; every tie defends the deed.
 *
 * Empty lanes (a drained binder fighting on scraps) count power 0 — an
 * over-stretched empire literally runs out of soldiers.
 */
import type { CardDef, Suit } from "./cards";
import { COUNTERS } from "./cards";

/** What the ground itself favors. A hex can be several of these at once. */
export interface Terrain {
  carrion: boolean; // the fringe: the city's dead-animal calls live here
  machine: boolean; // the corridor: real ticket money is written here
  tremor: boolean; // broken ground: unrepaired quake damage
}

export const AFFINITY_BONUS = 2;
export const COUNTER_BONUS = 3;

export interface LaneResult {
  attacker: CardDef | null;
  defender: CardDef | null;
  attackerPower: number;
  defenderPower: number;
  winner: "attacker" | "defender" | "none";
  sunk: boolean;
  notes: string[];
}

export interface BattleResult {
  lanes: LaneResult[];
  attackerLanes: number;
  defenderLanes: number;
  winner: "attacker" | "defender";
  /** Cards that lost their lane (phoenixes excluded — they always walk away). */
  beaten: { attacker: CardDef[]; defender: CardDef[] };
}

function onHomeGround(suit: Suit, terrain: Terrain): boolean {
  return terrain[suit];
}

function effectivePower(
  card: CardDef,
  opposing: CardDef | null,
  friends: CardDef[],
  terrain: Terrain,
  notes: string[]
): number {
  let p = card.power;
  if (onHomeGround(card.suit, terrain)) {
    p += AFFINITY_BONUS;
    notes.push(`${card.name} on home ground +${AFFINITY_BONUS}`);
  }
  if (opposing && COUNTERS[card.suit] === opposing.suit) {
    p += COUNTER_BONUS;
    notes.push(`${card.name} counters ${opposing.suit} +${COUNTER_BONUS}`);
  }
  const rite = card.rite;
  if (rite) {
    if (rite.kind === "surge" && onHomeGround(card.suit, terrain)) {
      p += rite.n;
      notes.push(`${card.name} surges +${rite.n}`);
    } else if (rite.kind === "pack") {
      const others = friends.filter((f) => f !== card && f.suit === "carrion").length;
      if (others > 0) {
        p += rite.n * others;
        notes.push(`${card.name} runs with the pack +${rite.n * others}`);
      }
    } else if (rite.kind === "predator" && opposing && opposing.suit === rite.vs) {
      p += rite.n;
      notes.push(`${card.name} preys on ${rite.vs} +${rite.n}`);
    }
  }
  return p;
}

/**
 * Resolve one raid. `lanes` is the battle size; short hands (drained binders)
 * leave empty lanes. Cards are matched in drawn order — the draw is the dice.
 */
export function resolveBattle(
  attacker: CardDef[],
  defender: CardDef[],
  terrain: Terrain,
  lanes: number
): BattleResult {
  const laneResults: LaneResult[] = [];
  let aLanes = 0;
  let dLanes = 0;
  const beaten: BattleResult["beaten"] = { attacker: [], defender: [] };

  for (let i = 0; i < lanes; i++) {
    const a = attacker[i] ?? null;
    const d = defender[i] ?? null;
    const notes: string[] = [];

    // The tar accepts both parties.
    const sunk = a?.rite?.kind === "sink" || d?.rite?.kind === "sink";
    if (sunk) {
      notes.push("the lane sinks — nobody scores it");
      if (a && a.rite?.kind !== "phoenix") beaten.attacker.push(a);
      if (d && d.rite?.kind !== "phoenix") beaten.defender.push(d);
      laneResults.push({
        attacker: a,
        defender: d,
        attackerPower: 0,
        defenderPower: 0,
        winner: "none",
        sunk: true,
        notes,
      });
      continue;
    }

    const ap = a ? effectivePower(a, d, attacker, terrain, notes) : 0;
    const dp = d ? effectivePower(d, a, defender, terrain, notes) : 0;
    let winner: LaneResult["winner"] = "none";
    if (ap > dp) {
      winner = "attacker";
      aLanes++;
      if (d && d.rite?.kind !== "phoenix") beaten.defender.push(d);
    } else if (dp > ap) {
      winner = "defender";
      dLanes++;
      if (a && a.rite?.kind !== "phoenix") beaten.attacker.push(a);
    }
    laneResults.push({
      attacker: a,
      defender: d,
      attackerPower: ap,
      defenderPower: dp,
      winner,
      sunk: false,
      notes,
    });
  }

  return {
    lanes: laneResults,
    attackerLanes: aLanes,
    defenderLanes: dLanes,
    // Every tie defends the deed.
    winner: aLanes > dLanes ? "attacker" : "defender",
    beaten,
  };
}
