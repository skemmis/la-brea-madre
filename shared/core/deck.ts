/**
 * Packs — spend crude to draw cards. Deterministic: draws flow through the
 * seeded RNG in the game state, so the same state + same opens reproduce the
 * same cards. A pack yields `size` distinct cards (weighted by rarity); cards
 * you already own come back as a small crude refund instead of stacking.
 */
import { nextFloat, type RngState } from "./rng";
import { CARDS, RARITY_WEIGHT, type CardDef } from "./cards";
import type { GameConfig, GameState, PlayerId } from "./types";

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Pick one card by rarity weight, excluding ids already drawn this pack. */
function drawWeighted(rng: RngState, exclude: Set<string>): CardDef | null {
  const pool = Object.values(CARDS).filter((c) => !exclude.has(c.id));
  if (pool.length === 0) return null;
  const weights = pool.map((c) => RARITY_WEIGHT[c.rarity]);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = nextFloat(rng) * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export interface PackDrawCard {
  id: string;
  isNew: boolean;
}

export interface PackResult {
  state: GameState;
  drawn: PackDrawCard[];
  refund: number; // crude returned for duplicates
}

/** Open a pack for a player, deducting its cost and adding the new cards. */
export function openPack(state: GameState, config: GameConfig, playerId: PlayerId): PackResult {
  const player = state.players[playerId];
  if (!player) throw new Error(`No such player: ${playerId}`);
  if (player.crude < config.pack.cost) {
    throw new Error(`Not enough crude (need ${config.pack.cost}, have ${player.crude}).`);
  }

  const next = clone(state);
  const p = next.players[playerId];
  p.cards ??= [];
  p.crude -= config.pack.cost;

  const owned = new Set(p.cards);
  const thisPack = new Set<string>();
  const drawn: PackDrawCard[] = [];
  let refund = 0;

  for (let i = 0; i < config.pack.size; i++) {
    const card = drawWeighted(next.rng, thisPack);
    if (!card) break; // fewer distinct cards than the pack size
    thisPack.add(card.id);
    const isNew = !owned.has(card.id);
    if (isNew) {
      owned.add(card.id);
      p.cards.push(card.id);
    } else {
      refund += config.pack.duplicateRefund;
    }
    drawn.push({ id: card.id, isNew });
  }

  p.crude += refund;
  return { state: next, drawn, refund };
}
