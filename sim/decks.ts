/**
 * Binder management for the game bots: rip packs when the scrip allows,
 * cut the weakest cards (by each persona's lights) when the binder is full.
 *
 * Curation styles mirror the fight lab's archetypes:
 *   power      keep the biggest numbers (flippers, warlords)
 *   balanced   even suits, rites valued (rentiers, sprawlers)
 *   swarm      carrion pack-density above all (scavengers)
 *   random     cut whatever (drifters)
 */
import {
  buyPackMut,
  cutCardMut,
  forgeSaintMut,
  CARD_BY_ID,
  type CardDef,
  type GameConfig,
  type GameState,
  type PlayerId,
} from "../shared/core";
import type { Rng } from "./world";

export type CurationStyle = "power" | "balanced" | "swarm" | "random";

const RITE_VALUE: Record<string, number> = {
  surge: 2, reckless: 2, sink: 1.5, ward: 2.5, bulwark: 2,
  flock: 2, phoenix: 2.5, medic: 2, poach: 3, predator: 2,
  vengeance: 2.5, rally: 2.5, omen: 2.5, haunt: 2.5, anchor: 2.5, crescendo: 2,
};
const riteValue = (c: CardDef): number => (c.rite ? RITE_VALUE[c.rite.kind] ?? 0 : 0);

function scoreCard(style: CurationStyle, c: CardDef, rng: Rng): number {
  switch (style) {
    case "power":
      return c.power;
    case "balanced":
      return c.power + riteValue(c) * 1.5;
    case "swarm":
      return c.rite?.kind === "flock" ? 10 + c.power : c.suit === "white" ? c.power : c.power / 2;
    case "random":
      return rng();
  }
}

/**
 * Daily binder upkeep: while a pack is affordable, make room (cut worst
 * cards) and rip it. Mutates state directly — shell privilege, same as prod's
 * pack endpoint will be.
 */
export function manageBinder(
  state: GameState,
  config: GameConfig,
  me: PlayerId,
  style: CurationStyle,
  rng: Rng
): void {
  const player = state.players[me];
  if (!player) return;
  while ((player.scrip ?? 0) >= config.packs.cost) {
    const binder = (player.binder ??= []);
    while (binder.length + config.packs.size > config.raids.collectionCap) {
      let worst = 0;
      let worstScore = Infinity;
      for (let i = 0; i < binder.length; i++) {
        const s = scoreCard(style, CARD_BY_ID[binder[i].def], rng);
        if (s < worstScore) {
          worstScore = s;
          worst = i;
        }
      }
      cutCardMut(state, me, worst);
    }
    buyPackMut(state, config, me);
  }
}

/** Which relics each taste reaches for first at the forge. */
const SAINT_TASTE: Record<CurationStyle, string[]> = {
  power: ["s_fernando", "s_dice", "s_madre"],
  balanced: ["s_karma", "s_dice", "s_meters"],
  swarm: ["s_thermals", "s_ghost", "s_karma"],
  random: ["s_lostcause", "s_jumper", "s_dice"],
};

/** Forge saints whenever the gallery can pay. Returns how many were forged. */
export function manageSaints(
  state: GameState,
  config: GameConfig,
  me: PlayerId,
  style: CurationStyle
): number {
  const player = state.players[me];
  if (!player) return 0;
  let forged = 0;
  for (const id of SAINT_TASTE[style]) {
    try {
      forgeSaintMut(state, config, me, id);
      forged++;
    } catch {
      // can't afford it, already owned, or the mirror is full — all fine
    }
  }
  return forged;
}
