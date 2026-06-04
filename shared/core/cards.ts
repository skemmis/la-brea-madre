/**
 * Cards — the deck-building layer's collectible modifiers.
 *
 * Like relics, each card is a pure data object with simple, declarative
 * effects the market engine applies at settlement. Owning a card is enough
 * for its effect to fire (passive, Slay-the-Spire style); duplicates don't
 * stack. Adding a card is one entry here — no engine changes.
 *
 * Lore note: named, never explained in-game.
 */
export type CardRarity = "common" | "uncommon" | "rare";

export interface CardDef {
  id: string;
  name: string;
  text: string;
  rarity: CardRarity;
  /** Multiplier on winning payouts (stacks multiplicatively across cards). */
  payoutMult?: number;
  /** Fraction of a net loss refunded (the best owned card wins; no stacking). */
  loserRefund?: number;
}

export const CARDS: Record<string, CardDef> = {
  wildcatters_nerve: {
    id: "wildcatters_nerve",
    name: "Wildcatter's Nerve",
    text: "Winning bets pay 15% more.",
    rarity: "common",
    payoutMult: 1.15,
  },
  meter_maids_cut: {
    id: "meter_maids_cut",
    name: "Meter Maid's Cut",
    text: "Winning bets pay 20% more.",
    rarity: "common",
    payoutMult: 1.2,
  },
  tar_insurance: {
    id: "tar_insurance",
    name: "Tar Insurance",
    text: "Refunds 40% of what you lose on a bad read.",
    rarity: "uncommon",
    loserRefund: 0.4,
  },
  the_long_con: {
    id: "the_long_con",
    name: "The Long Con",
    text: "Winning bets pay 40% more.",
    rarity: "uncommon",
    payoutMult: 1.4,
  },
  sex_magick: {
    id: "sex_magick",
    name: "Sex Magick",
    text: "Double all payouts.",
    rarity: "rare",
    payoutMult: 2,
  },
  la_brea_pact: {
    id: "la_brea_pact",
    name: "La Brea Pact",
    text: "Refunds 75% of what you lose. She is merciful, for a price.",
    rarity: "rare",
    loserRefund: 0.75,
  },
};

export const RARITY_WEIGHT: Record<CardRarity, number> = {
  common: 60,
  uncommon: 30,
  rare: 10,
};

export function cardDef(id: string): CardDef | undefined {
  return CARDS[id];
}

export interface CardEffects {
  payoutMult: number;
  loserRefund: number;
}

/** Combine the passive effects of a player's owned cards (duplicates ignored). */
export function cardEffects(ownedIds: string[]): CardEffects {
  let payoutMult = 1;
  let loserRefund = 0;
  const seen = new Set<string>();
  for (const id of ownedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = CARDS[id];
    if (!c) continue;
    if (c.payoutMult) payoutMult *= c.payoutMult;
    if (c.loserRefund) loserRefund = Math.max(loserRefund, c.loserRefund);
  }
  return { payoutMult, loserRefund };
}
