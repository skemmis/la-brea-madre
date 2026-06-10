/**
 * Bot personas — opposing strategies that stress different rules.
 *
 *   rentier    plays "correctly": prime land, honest prices, prompt repairs
 *   scavenger  chases carrion to snowball Work Orders
 *   sprawler   expands every order, lowballs assessments to dodge tax
 *   flipper    hunts underpriced parcels and buys them out (tests Harberger)
 *   drifter    random legal actions (chaos baseline + crash fuzzing)
 *
 * A bot proposes one action at a time; the runner applies it through the real
 * core (applyAction) so illegal ideas fail exactly as they would in prod.
 */
import { gridDisk } from "h3-js";
import {
  assessedPrice,
  claimPrice,
  type Action,
  type GameConfig,
  type GameState,
  type PlayerId,
} from "../shared/core";
import type { Rng, SimWorld } from "./world";

export interface BotCtx {
  state: GameState;
  config: GameConfig;
  me: PlayerId;
  world: SimWorld;
  rng: Rng;
}

export interface Bot {
  name: string;
  /** The next action to try, or null to stop for the day. */
  nextAction(ctx: BotCtx): Action | null;
}

// ─── Shared senses ────────────────────────────────────────────────────────────

const mine = (s: GameState, me: PlayerId) =>
  Object.keys(s.hexes).filter((h) => s.hexes[h].ownerId === me);

const cash = (s: GameState, me: PlayerId) => s.players[me]?.crude ?? 0;
const orders = (s: GameState, me: PlayerId) => Math.floor(s.players[me]?.workOrders ?? 0);

function frontier(ctx: BotCtx, owned: string[]): string[] {
  const out = new Set<string>();
  for (const h of owned) {
    for (const n of gridDisk(h, 1)) {
      if (n !== h && ctx.config.board[n] && !ctx.state.hexes[n]?.ownerId) out.add(n);
    }
  }
  return [...out];
}

function enemyFrontier(ctx: BotCtx, owned: string[]): string[] {
  const out = new Set<string>();
  for (const h of owned) {
    for (const n of gridDisk(h, 1)) {
      const owner = ctx.state.hexes[n]?.ownerId;
      if (n !== h && ctx.config.board[n] && owner && owner !== ctx.me) out.add(n);
    }
  }
  return [...out];
}

const best = (hs: string[], score: (h: string) => number): string | null =>
  hs.length ? hs.reduce((a, b) => (score(b) > score(a) ? b : a)) : null;

/** First claim: the best unowned cell by `score` (bots can read the map). */
function bestUnowned(ctx: BotCtx, ranked: string[]): string | null {
  for (const h of ranked) {
    if (!ctx.state.hexes[h]?.ownerId) return h;
  }
  return null;
}

const fineOf = (ctx: BotCtx, h: string) => ctx.world.fineRate.get(h) ?? 0;

/** Another player's parcel whose asking price most undershoots its worth. */
function bestBargain(ctx: BotCtx, discount = 0.7): string | null {
  let bestH: string | null = null;
  let bestRatio = discount; // only bother below this fraction of fair value
  for (const [h3, hx] of Object.entries(ctx.state.hexes)) {
    if (!hx.ownerId || hx.ownerId === ctx.me) continue;
    const fair = claimPrice(ctx.config, h3) * (1 + (ctx.config.yield.upgradeBonus[hx.upgradeLevel] ?? 0));
    if (fair <= ctx.config.assessment.minPrice) continue;
    const ask = assessedPrice(ctx.state, ctx.config, h3);
    if (ask > cash(ctx.state, ctx.me)) continue;
    const ratio = ask / fair;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      bestH = h3;
    }
  }
  return bestH;
}

/** My most badly underpriced parcel (vs fair value), or null if priced fine. */
function worstSelfPricing(ctx: BotCtx, owned: string[], target = 1.0): { h3: string; price: number } | null {
  for (const h of owned) {
    const fair = Math.max(
      ctx.config.assessment.minPrice,
      Math.round(claimPrice(ctx.config, h) * (1 + (ctx.config.yield.upgradeBonus[ctx.state.hexes[h].upgradeLevel] ?? 0)) * target)
    );
    const current = assessedPrice(ctx.state, ctx.config, h);
    if (Math.abs(current - fair) / fair > 0.15) return { h3: h, price: fair };
  }
  return null;
}
const carrionOf = (ctx: BotCtx, h: string) => ctx.world.carrionRate.get(h) ?? 0;

/** A parcel's rough daily income at its current upgrade/degradation. */
function incomeOf(ctx: BotCtx, h: string): number {
  const hx = ctx.state.hexes[h];
  const up = 1 + (ctx.config.yield.upgradeBonus[hx?.upgradeLevel ?? 0] ?? 0);
  const deg = 1 - (hx?.degradation ?? 0) / 100;
  return fineOf(ctx, h) * up * deg;
}

// ─── Personas ─────────────────────────────────────────────────────────────────

export function rentier(): Bot {
  return {
    name: "rentier",
    nextAction(ctx) {
      const owned = mine(ctx.state, ctx.me);
      if (orders(ctx.state, ctx.me) < 1) return null;

      if (!owned.length) {
        const h = bestUnowned(ctx, ctx.world.byFine);
        return h ? { type: "expand", h3: h } : null;
      }
      // Keep prices honest (a hair above fair, free action).
      const reprice = worstSelfPricing(ctx, owned, 1.2);
      if (reprice) return { type: "assess", h3: reprice.h3, price: reprice.price };
      // Repair anything badly shaken first — protect the income.
      const wounded = owned.filter((h) => (ctx.state.hexes[h].degradation ?? 0) >= 20);
      const worst = best(wounded, (h) => incomeOf(ctx, h));
      if (worst && cash(ctx.state, ctx.me) >= ctx.state.hexes[worst].degradation * ctx.config.quake.repairPerPoint) {
        return { type: "repair", h3: worst };
      }
      // Upgrade the best earner if affordable.
      const upgradable = owned.filter(
        (h) =>
          ctx.state.hexes[h].upgradeLevel < ctx.config.maxUpgrade &&
          cash(ctx.state, ctx.me) >= ctx.config.costs.upgrade[ctx.state.hexes[h].upgradeLevel] * 2
      );
      const target = best(upgradable, (h) => fineOf(ctx, h));
      if (target) return { type: "upgrade", h3: target };
      // Otherwise grow toward money — the best parcel we can pay for.
      const f = frontier(ctx, owned).filter((h) => cash(ctx.state, ctx.me) >= claimPrice(ctx.config, h));
      const claim = best(f, (h) => fineOf(ctx, h));
      return claim ? { type: "expand", h3: claim } : null;
    },
  };
}

export function scavenger(): Bot {
  return {
    name: "scavenger",
    nextAction(ctx) {
      const owned = mine(ctx.state, ctx.me);
      if (orders(ctx.state, ctx.me) < 1) return null;
      if (!owned.length) {
        const h = bestUnowned(ctx, ctx.world.byCarrion);
        return h ? { type: "expand", h3: h } : null;
      }
      const f = frontier(ctx, owned);
      // Carrion first; tie-break toward money.
      const affordable = f.filter((h) => cash(ctx.state, ctx.me) >= claimPrice(ctx.config, h));
      const claim = best(affordable, (h) => carrionOf(ctx, h) * 1000 + fineOf(ctx, h));
      return claim ? { type: "expand", h3: claim } : null;
    },
  };
}

export function sprawler(): Bot {
  return {
    name: "sprawler",
    nextAction(ctx) {
      const owned = mine(ctx.state, ctx.me);
      if (orders(ctx.state, ctx.me) < 1) return null;
      if (!owned.length) {
        const h = bestUnowned(ctx, ctx.world.byFine);
        return h ? { type: "expand", h3: h } : null;
      }
      // Dodge the tax: lowball every assessment (and learn why that's bad).
      const lowball = owned.find(
        (h) => assessedPrice(ctx.state, ctx.config, h) > ctx.config.assessment.minPrice
      );
      if (lowball) return { type: "assess", h3: lowball, price: ctx.config.assessment.minPrice };
      const f = frontier(ctx, owned).filter((h) => cash(ctx.state, ctx.me) >= claimPrice(ctx.config, h));
      const claim = best(f, (h) => fineOf(ctx, h));
      return claim ? { type: "expand", h3: claim } : null;
    },
  };
}

export function flipper(): Bot {
  return {
    name: "flipper",
    nextAction(ctx) {
      const owned = mine(ctx.state, ctx.me);
      if (orders(ctx.state, ctx.me) < 1) return null;
      if (!owned.length) {
        const h = bestUnowned(ctx, ctx.world.byFine);
        return h ? { type: "expand", h3: h } : null;
      }
      // Mark acquisitions up to a fat ask immediately.
      const reprice = worstSelfPricing(ctx, owned, 1.5);
      if (reprice) return { type: "assess", h3: reprice.h3, price: reprice.price };
      // Hunt mispriced land anywhere on the map.
      const bargain = bestBargain(ctx, 0.75);
      if (bargain) return { type: "buyout", h3: bargain };
      // Nothing cheap on the board: grow normally.
      const f = frontier(ctx, owned).filter((h) => cash(ctx.state, ctx.me) >= claimPrice(ctx.config, h));
      const claim = best(f, (h) => fineOf(ctx, h));
      return claim ? { type: "expand", h3: claim } : null;
    },
  };
}

export function drifter(): Bot {
  return {
    name: "drifter",
    nextAction(ctx) {
      const owned = mine(ctx.state, ctx.me);
      if (orders(ctx.state, ctx.me) < 1) return null;
      if (!owned.length) {
        const ranked = ctx.world.byFine;
        const h = ranked[Math.floor(ctx.rng() * Math.min(200, ranked.length))];
        return h && !ctx.state.hexes[h]?.ownerId ? { type: "expand", h3: h } : null;
      }
      const roll = ctx.rng();
      const f = frontier(ctx, owned);
      const affordable = f.filter((h) => cash(ctx.state, ctx.me) >= claimPrice(ctx.config, h));
      if (roll < 0.4 && affordable.length) {
        return { type: "expand", h3: affordable[Math.floor(ctx.rng() * affordable.length)] };
      }
      if (roll < 0.6) {
        const h = owned[Math.floor(ctx.rng() * owned.length)];
        if (ctx.state.hexes[h].upgradeLevel < ctx.config.maxUpgrade) return { type: "upgrade", h3: h };
      }
      if (roll < 0.8) {
        const h = owned[Math.floor(ctx.rng() * owned.length)];
        const price = Math.max(ctx.config.assessment.minPrice, Math.round(ctx.rng() * 5000));
        return { type: "assess", h3: h, price };
      }
      const enemies = Object.entries(ctx.state.hexes).filter(
        ([, hx]) => hx.ownerId && hx.ownerId !== ctx.me
      );
      if (enemies.length) {
        const [h3] = enemies[Math.floor(ctx.rng() * enemies.length)];
        if (cash(ctx.state, ctx.me) >= assessedPrice(ctx.state, ctx.config, h3)) {
          return { type: "buyout", h3 };
        }
      }
      return null;
    },
  };
}

export const PERSONAS: Record<string, () => Bot> = {
  rentier,
  scavenger,
  sprawler,
  flipper,
  drifter,
};
