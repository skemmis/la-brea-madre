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
  isCracked,
  raidValue,
  repairCost,
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

/** What taking a parcel costs up front: the full ask, or the raid escrow
 * (which prices off the county valuation, not the owner's opinion). */
function takingCost(ctx: BotCtx, h3: string): number {
  return ctx.config.raids.enabled
    ? Math.round(raidValue(ctx.state, ctx.config, h3) * ctx.config.raids.compFraction)
    : assessedPrice(ctx.state, ctx.config, h3);
}

/** The action that takes someone's parcel under the current rules. */
function takeAction(ctx: BotCtx, h3: string): Action {
  return ctx.config.raids.enabled ? { type: "raid", h3 } : { type: "buyout", h3 };
}

/** Another player's parcel whose asking price most undershoots its worth. */
function bestBargain(ctx: BotCtx, discount = 0.7): string | null {
  let bestH: string | null = null;
  let bestRatio = discount; // only bother below this fraction of fair value
  for (const [h3, hx] of Object.entries(ctx.state.hexes)) {
    if (!hx.ownerId || hx.ownerId === ctx.me) continue;
    const fair = claimPrice(ctx.config, h3) * (1 + (ctx.config.yield.upgradeBonus[hx.upgradeLevel] ?? 0));
    if (fair <= ctx.config.assessment.minPrice) continue;
    const ask = assessedPrice(ctx.state, ctx.config, h3);
    if (takingCost(ctx, h3) > cash(ctx.state, ctx.me)) continue;
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
      // Keep prices honest (a hair above fair, free action — buyout era only).
      if (!ctx.config.raids.enabled) {
        const reprice = worstSelfPricing(ctx, owned, 1.2);
        if (reprice) return { type: "assess", h3: reprice.h3, price: reprice.price };
      }
      // EMERGENCY SHORING first: slam the cracked window shut on anything
      // valuable before the wolves smell it.
      const cracked = owned.filter(
        (h) => (ctx.state.hexes[h].degradation ?? 0) >= ctx.config.quake.crackedThreshold
      );
      const worst = best(cracked, (h) => incomeOf(ctx, h));
      if (worst && cash(ctx.state, ctx.me) >= repairCost(ctx.config, worst, ctx.state.hexes[worst].degradation)) {
        return { type: "repair", h3: worst };
      }
      // Bolt down the crown jewel once it's earning.
      const jewel = best(owned, (h) => fineOf(ctx, h));
      if (
        jewel &&
        !ctx.state.hexes[jewel].retrofitted &&
        fineOf(ctx, jewel) > 500 &&
        cash(ctx.state, ctx.me) >= Math.round(claimPrice(ctx.config, jewel) * ctx.config.works.retrofitCostFraction) * 3
      ) {
        return { type: "retrofit", h3: jewel };
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
      // Dodge the tax: lowball every assessment (buyout era only — the county
      // assessor stopped taking calls when the raids opened).
      if (!ctx.config.raids.enabled) {
        const lowball = owned.find(
          (h) => assessedPrice(ctx.state, ctx.config, h) > ctx.config.assessment.minPrice
        );
        if (lowball) return { type: "assess", h3: lowball, price: ctx.config.assessment.minPrice };
      }
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
      if (ctx.config.raids.enabled) {
        // The baron: there are no mispriced deeds under county valuation, so
        // hunt the richest one your escrow can reach — crown jewels first.
        let jewel: string | null = null;
        let jewelScore = 60; // not worth a Work Order below this $/day
        for (const [h3, hx] of Object.entries(ctx.state.hexes)) {
          if (!hx.ownerId || hx.ownerId === ctx.me) continue;
          // Cracked parcels are discount jewels: walls down, valuation down.
          const score = fineOf(ctx, h3) * (isCracked(ctx.state, ctx.config, h3) ? 2.5 : 1);
          if (score > jewelScore && takingCost(ctx, h3) <= cash(ctx.state, ctx.me)) {
            jewelScore = score;
            jewel = h3;
          }
        }
        if (jewel) return { type: "raid", h3: jewel };
      } else {
        // Buyout era: mark acquisitions up, hunt mispriced land.
        const reprice = worstSelfPricing(ctx, owned, 1.5);
        if (reprice) return { type: "assess", h3: reprice.h3, price: reprice.price };
        const bargain = bestBargain(ctx, 0.75);
        if (bargain) return takeAction(ctx, bargain);
      }
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
      if (roll < 0.8 && !ctx.config.raids.enabled) {
        const h = owned[Math.floor(ctx.rng() * owned.length)];
        const price = Math.max(ctx.config.assessment.minPrice, Math.round(ctx.rng() * 5000));
        return { type: "assess", h3: h, price };
      }
      const enemies = Object.entries(ctx.state.hexes).filter(
        ([, hx]) => hx.ownerId && hx.ownerId !== ctx.me
      );
      if (enemies.length) {
        const [h3] = enemies[Math.floor(ctx.rng() * enemies.length)];
        if (cash(ctx.state, ctx.me) >= takingCost(ctx, h3)) {
          return takeAction(ctx, h3);
        }
      }
      return null;
    },
  };
}

/**
 * The warlord exists to stress the finite army: every order goes into raids
 * on the single biggest landowner's cheapest parcels — many fronts, one
 * night. If wide empires don't bleed under this, the rule isn't working.
 */
export function warlord(): Bot {
  return {
    name: "warlord",
    nextAction(ctx) {
      const owned = mine(ctx.state, ctx.me);
      if (orders(ctx.state, ctx.me) < 1) return null;
      if (!owned.length) {
        const h = bestUnowned(ctx, ctx.world.byFine);
        return h ? { type: "expand", h3: h } : null;
      }
      if (!ctx.config.raids.enabled) return null; // pacifist without a battlefield

      // Find the widest empire that isn't mine.
      const holdings = new Map<string, string[]>();
      for (const [h3, hx] of Object.entries(ctx.state.hexes)) {
        if (!hx.ownerId || hx.ownerId === ctx.me) continue;
        if (!holdings.has(hx.ownerId)) holdings.set(hx.ownerId, []);
        holdings.get(hx.ownerId)!.push(h3);
      }
      let target: string[] | null = null;
      for (const parcels of holdings.values()) {
        if (!target || parcels.length > target.length) target = parcels;
      }
      if (!target || target.length < 5) return null; // no empire worth besieging

      // Hit their cheapest affordable front — cracked walls first, always.
      const affordable = target.filter((h) => takingCost(ctx, h) <= cash(ctx.state, ctx.me));
      const cheapest = best(
        affordable,
        (h) => (isCracked(ctx.state, ctx.config, h) ? 100000 : 0) - claimPrice(ctx.config, h)
      );
      return cheapest ? { type: "raid", h3: cheapest } : null;
    },
  };
}

export const PERSONAS: Record<string, () => Bot> = {
  rentier,
  scavenger,
  sprawler,
  flipper,
  drifter,
  warlord,
};
