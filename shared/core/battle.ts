/**
 * Battle resolution — five cards a side, lane by lane, on real ground.
 *
 * Pure function of (attacker cards, defender cards, terrain, mods): no RNG
 * inside. The luck happened earlier, at the draw; the resolver is the
 * courtroom. Hands arrive ALREADY ARRANGED light-to-heavy (see arrangeHand
 * in game.ts) — weight decides who opens the night and who closes it.
 *
 * A lane's effective power = base
 *   + 2 if the card stands on its home stratum (affinity)
 *   + its rite, if any — unless a WARD across the lane silenced it
 *   + its side's Dashboard Saints (suit boosts, karma, the closer's blessing)
 *   + whatever RIPPLED in from the previous lane (vengeance, rally, omen)
 * Higher power takes the lane; equal power, nobody does — unless someone
 * carries THE FUZZY DICE. SINK swallows the lane whole. Most lanes wins;
 * ties defend the deed (the dice break that rule too).
 *
 * There is NO blanket color triangle: a mono-color binder is a school, not
 * a suicide pact. Color identity lives in the rites and the ground.
 *
 * Empty lanes (a drained binder fighting on scraps) count power 0 — an
 * over-stretched empire literally runs out of soldiers.
 */
import type { CardDef } from "./cards";
import { hasSaint, type BattleMods } from "./saints";

/** What the ground itself favors. A hex can be several strata at once. */
export interface Terrain {
  black: boolean; // the under: tar wells, unrepaired quake damage
  blue: boolean; // the middle: real ticket money is written here
  white: boolean; // the upper: the city's dead-animal calls live here
}

export const AFFINITY_BONUS = 2;

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

interface SideState {
  cards: CardDef[];
  mods: BattleMods;
  defending: boolean;
  carry: number; // a rally rolling into my next lane (one lane only)
  grudge: number; // vengeance: stacks as my martyrs fall — the night remembers
  curse: number; // the foe's omen weighing on my next lane
}

function effectivePower(
  side: SideState,
  i: number,
  lanes: number,
  opposing: CardDef | null,
  terrain: Terrain,
  warded: boolean,
  notes: string[]
): number {
  const card = side.cards[i];
  if (!card) return 0;
  let p = card.power;
  if (terrain[card.suit]) {
    p += AFFINITY_BONUS;
    notes.push(`${card.name} on home ground +${AFFINITY_BONUS}`);
  }

  // Dashboard Saints bless from the rearview mirror.
  for (const s of side.mods.saints) {
    const e = s.effect;
    if (e.kind === "suitBoost" && card.suit === e.suit) {
      p += e.n;
      notes.push(`${s.name} +${e.n}`);
    } else if (e.kind === "karma") {
      const k = Math.min(e.max, Math.floor(side.mods.fossils / e.per));
      if (k > 0 && i === 0) notes.push(`${s.name} +${k} to every lane`);
      p += k;
    } else if (e.kind === "ghost" && card.rite?.kind === "phoenix") {
      p += e.n;
      notes.push(`${s.name} +${e.n}`);
    } else if (e.kind === "closer" && i === lanes - 1) {
      p += card.power;
      notes.push(`${s.name} — ${card.name} fights twice`);
    }
  }

  // What rippled in from the lanes before.
  if (side.carry > 0) {
    p += side.carry;
    notes.push(`${card.name} rides the rally +${side.carry}`);
  }
  if (side.grudge > 0) {
    p += side.grudge;
    notes.push(`${card.name} carries the grudge +${side.grudge}`);
  }
  if (side.curse > 0) {
    p = Math.max(0, p - side.curse);
    notes.push(`${card.name} fights under an omen −${side.curse}`);
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
      if (side.defending) {
        p += rite.n;
        notes.push(`${card.name} holds the deed +${rite.n}`);
      }
      break;
    case "flock": {
      const others = side.cards.filter((f) => f && f !== card && f.suit === "white").length;
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
    // ward, sink, phoenix, medic, poach, vengeance, rally, omen:
    // no power contribution in their own lane
  }
  return p;
}

/** After a lane settles, queue what ripples onward. */
function ripple(side: SideState, foe: SideState, card: CardDef | null, warded: boolean, won: boolean, lost: boolean, notes: string[]): void {
  side.carry = 0; // rallies last exactly one lane
  if (!card || !card.rite || warded) return;
  const r = card.rite;
  if (r.kind === "vengeance" && lost) {
    side.grudge += r.n;
    notes.push(`${card.name} falls — the grudge grows +${r.n} until avenged`);
  } else if (r.kind === "rally" && won) {
    side.carry = r.n;
    notes.push(`${card.name} rallies — +${r.n} flows to the next lane`);
  } else if (r.kind === "omen") {
    foe.curse = r.n;
    notes.push(`${card.name} reads an omen — the foe's next lane fights at −${r.n}`);
  }
}

/**
 * Resolve one raid. `lanes` is the battle size; short hands (drained binders)
 * leave empty lanes. Lanes pair by position — arrange your weights wisely.
 */
export function resolveBattle(
  attacker: CardDef[],
  defender: CardDef[],
  terrain: Terrain,
  lanes: number,
  mods: { attacker?: BattleMods; defender?: BattleMods } = {}
): BattleResult {
  const a: SideState = { cards: attacker, mods: mods.attacker ?? { saints: [], fossils: 0 }, defending: false, carry: 0, grudge: 0, curse: 0 };
  const d: SideState = { cards: defender, mods: mods.defender ?? { saints: [], fossils: 0 }, defending: true, carry: 0, grudge: 0, curse: 0 };
  const laneResults: LaneResult[] = [];
  let aLanes = 0;
  let dLanes = 0;
  const beaten: BattleResult["beaten"] = { attacker: [], defender: [] };

  for (let i = 0; i < lanes; i++) {
    const ac = a.cards[i] ?? null;
    const dc = d.cards[i] ?? null;
    const notes: string[] = [];

    // Wards fire first and cannot be warded.
    const attackerWarded = dc?.rite?.kind === "ward";
    const defenderWarded = ac?.rite?.kind === "ward";

    // The tar accepts both parties — unless the ordinance forbids it.
    const sunk =
      (ac?.rite?.kind === "sink" && !attackerWarded) ||
      (dc?.rite?.kind === "sink" && !defenderWarded);
    if (sunk) {
      notes.push("the lane sinks — nobody scores it");
      if (ac && ac.rite?.kind !== "phoenix") beaten.attacker.push(ac);
      if (dc && dc.rite?.kind !== "phoenix") beaten.defender.push(dc);
      // Curses aimed at a sunk lane drown with it; falling in still counts as falling.
      a.curse = 0;
      d.curse = 0;
      ripple(a, d, ac, !!attackerWarded, false, true, notes);
      ripple(d, a, dc, !!defenderWarded, false, true, notes);
      laneResults.push({
        attacker: ac, defender: dc, attackerPower: 0, defenderPower: 0,
        winner: "none", sunk: true, attackerWarded, defenderWarded, notes,
      });
      continue;
    }

    const ap = effectivePower(a, i, lanes, dc, terrain, !!attackerWarded, notes);
    const dp = effectivePower(d, i, lanes, ac, terrain, !!defenderWarded, notes);
    a.curse = 0;
    d.curse = 0;

    let winner: LaneResult["winner"] = "none";
    if (ap > dp) winner = "attacker";
    else if (dp > ap) winner = "defender";
    else {
      // The dice break the house rules — unless both tables carry them.
      const aDice = hasSaint(a.mods, "tiebreaker");
      const dDice = hasSaint(d.mods, "tiebreaker");
      if (aDice && !dDice && ap > 0) {
        winner = "attacker";
        notes.push("THE FUZZY DICE call the standoff");
      } else if (dDice && !aDice && dp > 0) {
        winner = "defender";
        notes.push("THE FUZZY DICE call the standoff");
      }
    }
    if (winner === "attacker") {
      aLanes++;
      if (dc && dc.rite?.kind !== "phoenix") beaten.defender.push(dc);
    } else if (winner === "defender") {
      dLanes++;
      if (ac && ac.rite?.kind !== "phoenix") beaten.attacker.push(ac);
    }

    ripple(a, d, ac, !!attackerWarded, winner === "attacker", winner === "defender", notes);
    ripple(d, a, dc, !!defenderWarded, winner === "defender", winner === "attacker", notes);

    laneResults.push({
      attacker: ac, defender: dc, attackerPower: ap, defenderPower: dp,
      winner, sunk: false, attackerWarded: !!attackerWarded, defenderWarded: !!defenderWarded, notes,
    });
  }

  // Every tie defends the deed — unless the raider rolled the dice.
  let winner: BattleResult["winner"] = aLanes > dLanes ? "attacker" : "defender";
  if (
    aLanes === dLanes &&
    hasSaint(a.mods, "tiebreaker") &&
    !hasSaint(d.mods, "tiebreaker")
  ) {
    winner = "attacker";
  }

  return { lanes: laneResults, attackerLanes: aLanes, defenderLanes: dLanes, winner, beaten };
}
