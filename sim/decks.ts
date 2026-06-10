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
  CARD_BY_ID,
  type CardDef,
  type GameConfig,
  type GameState,
  type PlayerId,
} from "../shared/core";
import type { Rng } from "./world";

export type CurationStyle = "power" | "balanced" | "swarm" | "random";

const riteValue = (c: CardDef): number =>
  c.rite ? { surge: 2, phoenix: 2.5, sink: 1.5, pack: 2, predator: 2 }[c.rite.kind] : 0;

function scoreCard(style: CurationStyle, c: CardDef, rng: Rng): number {
  switch (style) {
    case "power":
      return c.power;
    case "balanced":
      return c.power + riteValue(c) * 1.5;
    case "swarm":
      return c.rite?.kind === "pack" ? 10 + c.power : c.suit === "carrion" ? c.power : c.power / 2;
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
