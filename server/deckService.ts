/**
 * Deck service — the shell around the pure pack/card core. Loads the canonical
 * game state, opens packs (deducting crude, drawing through the seeded RNG),
 * and projects a player's collection for the UI.
 */
import { getOrInitGame, saveState, ensurePlayer, pid } from "./gameService";
import { openPack, CARDS, cardEffects, cardDef, type CardDef } from "@shared/core";

export interface DrawnCard extends CardDef {
  isNew: boolean;
}

export interface OpenPackResult {
  drawn: DrawnCard[];
  refund: number;
  crude: number;
  collection: string[];
}

export async function openPackFor(userId: number): Promise<OpenPackResult> {
  let { state, config } = await getOrInitGame();
  state = await ensurePlayer(state, config, userId);

  const { state: next, drawn, refund } = openPack(state, config, pid(userId));
  await saveState(next);

  const p = next.players[pid(userId)];
  return {
    drawn: drawn.map((d) => ({ ...cardDef(d.id)!, isNew: d.isNew })),
    refund,
    crude: p.crude,
    collection: p.cards,
  };
}

export interface CollectionView {
  owned: string[];
  effects: { payoutMult: number; loserRefund: number };
  catalog: Array<CardDef & { owned: boolean }>;
  packCost: number;
}

export async function getCollection(userId: number): Promise<CollectionView> {
  let { state, config } = await getOrInitGame();
  state = await ensurePlayer(state, config, userId);

  const owned = state.players[pid(userId)].cards ?? [];
  const ownedSet = new Set(owned);
  return {
    owned,
    effects: cardEffects(owned),
    catalog: Object.values(CARDS).map((c) => ({ ...c, owned: ownedSet.has(c.id) })),
    packCost: config.pack.cost,
  };
}
