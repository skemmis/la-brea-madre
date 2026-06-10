/**
 * Battle resolution — five cards a side, lane by lane, on real ground.
 *
 * Pure function of (attacker cards, defender cards, terrain): no RNG inside.
 * The luck happened earlier, at the draw; the resolver is the courtroom.
 *
 * A lane's effective power = base
 *   + 2 if the card stands on its home stratum (affinity)
 *   + 3 if it counters the opposing card's color (the triangle)
 *   + its rite, if any — unless a WARD across the lane silenced it
 * Higher power takes the lane; equal power, nobody does. SINK swallows the
 * lane whole. Most lanes wins the battle; every tie defends the deed.
 *
 * Wards fire first and cannot themselves be warded. The resolver only
 * decides lanes and who was beaten; fates (burning, wounding, poaching,
 * fossils) are the shell's business — see game.ts.
 *
 * Empty lanes (a drained binder fighting on scraps) count power 0 — an
 * over-stretched empire literally runs out of soldiers.
 */
import type { CardDef, Suit } from "./cards";
import { COUNTERS } from "./cards";

/** What the ground itself favors. A hex can be several strata at once. */
export interface Terrain {
  black: boolean; // the under: tar wells, unrepaired quake damage
  blue: boolean; // the middle: real ticket money is written here
  white: boolean; // the upper: the city's dead-animal calls live here
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
  /** Rites silenced by a ward across the lane. */
  attackerWarded: boolean;
  defenderWarded: boolean;
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

function effectivePower(
  card: CardDef,
  opposing: CardDef | null,
  friends: CardDef[],
  terrain: Terrain,
  warded: boolean,
  defending: boolean,
  notes: string[]
): number {
  let p = card.power;
  if (terrain[card.suit]) {
    p += AFFINITY_BONUS;
    notes.push(`${card.name} on home ground +${AFFINITY_BONUS}`);
  }
  if (opposing && COUNTERS[card.suit] === opposing.suit) {
    p += COUNTER_BONUS;
    notes.push(`${card.name} counters ${opposing.suit} +${COUNTER_BONUS}`);
  }
  const rite = card.rite;
  if (!rite) return p;
  if (warded && rite.kind !== "ward") {
    notes.push(`${card.name}'s rite is warded away`);
    return p;
  }
  switch (rite.kind) {
    case "surge":
      if (terrain[card.suit]) {
        p += rite.n;
        notes.push(`${card.name} surges +${rite.n}`);
      }
      break;
    case "reckless":
      p += rite.n;
      notes.push(`${card.name} is reckless +${rite.n} (it will burn)`);
      break;
    case "bulwark":
      if (defending) {
        p += rite.n;
        notes.push(`${card.name} holds the deed +${rite.n}`);
      }
      break;
    case "flock": {
      const others = friends.filter((f) => f !== card && f.suit === "white").length;
      if (others > 0) {
        p += rite.n * others;
        notes.push(`${card.name} flocks +${rite.n * others}`);
      }
      break;
    }
    case "predator":
      if (opposing && opposing.suit === rite.vs) {
        p += rite.n;
        notes.push(`${card.name} preys on ${rite.vs} +${rite.n}`);
      }
      break;
    // ward, sink, phoenix, medic, poach: no power contribution
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

    // Wards fire first and cannot be warded.
    const attackerWarded = d?.rite?.kind === "ward";
    const defenderWarded = a?.rite?.kind === "ward";

    // The tar accepts both parties — unless the ordinance forbids it.
    const sunk =
      (a?.rite?.kind === "sink" && !attackerWarded) ||
      (d?.rite?.kind === "sink" && !defenderWarded);
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
        attackerWarded,
        defenderWarded,
        notes,
      });
      continue;
    }

    const ap = a ? effectivePower(a, d, attacker, terrain, attackerWarded, false, notes) : 0;
    const dp = d ? effectivePower(d, a, defender, terrain, defenderWarded, true, notes) : 0;
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
      attackerWarded,
      defenderWarded,
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
