/**
 * Bot personas — opposing strategies that stress different rules.
 *
 *   rentier    plays "correctly": prime ticket land, upgrades, prompt repairs
 *   scavenger  chases carrion to snowball Work Orders
 *   sprawler   expands every order, never maintains (tests empire restriction)
 *   exploiter  exploits everything, repairs never (tests degradation economics)
 *   warlord    thin economy, sealed-bid raids (tests combat pricing)
 *   drifter    random legal actions (chaos baseline + crash fuzzing)
 *
 * A bot proposes one action at a time; the runner applies it through the real
 * core (applyAction) so illegal ideas fail exactly as they would in prod.
 */
import { gridDisk } from "h3-js";
import { claimPrice, type Action, type GameConfig, type GameState, type PlayerId } from "../shared/core";
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
  /** $ to commit when one of the bot's parcels is contested (0 = concede). */
  defendBid(ctx: BotCtx, h3: string): number;
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
    defendBid(ctx, h3) {
      return Math.min(cash(ctx.state, ctx.me) * 0.5, Math.max(100, incomeOf(ctx, h3) * 5));
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
    defendBid(ctx, h3) {
      return Math.min(cash(ctx.state, ctx.me) * 0.4, Math.max(60, incomeOf(ctx, h3) * 4));
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
      const f = frontier(ctx, owned).filter((h) => cash(ctx.state, ctx.me) >= claimPrice(ctx.config, h));
      const claim = best(f, (h) => fineOf(ctx, h));
      return claim ? { type: "expand", h3: claim } : null;
    },
    defendBid() {
      return 0; // spread thin, concede everything
    },
  };
}

export function exploiter(): Bot {
  return {
    name: "exploiter",
    nextAction(ctx) {
      const owned = mine(ctx.state, ctx.me);
      // Free stance flips don't cost orders: exploit everything not yet burning.
      const calm = owned.find(
        (h) => !ctx.state.hexes[h].exploited && ctx.state.hexes[h].degradation < 100
      );
      if (calm) return { type: "setExploit", h3: calm, on: true };

      if (orders(ctx.state, ctx.me) < 1) return null;
      if (!owned.length) {
        const h = bestUnowned(ctx, ctx.world.byFine);
        return h ? { type: "expand", h3: h } : null;
      }
      const f = frontier(ctx, owned).filter((h) => cash(ctx.state, ctx.me) >= claimPrice(ctx.config, h));
      const claim = best(f, (h) => fineOf(ctx, h));
      return claim ? { type: "expand", h3: claim } : null;
    },
    defendBid(ctx, h3) {
      return Math.min(cash(ctx.state, ctx.me) * 0.3, incomeOf(ctx, h3) * 2);
    },
  };
}

export function warlord(): Bot {
  return {
    name: "warlord",
    nextAction(ctx) {
      const owned = mine(ctx.state, ctx.me);
      if (orders(ctx.state, ctx.me) < 1) return null;
      // A small economic base first.
      if (owned.length < 3) {
        if (!owned.length) {
          const h = bestUnowned(ctx, ctx.world.byFine);
          return h ? { type: "expand", h3: h } : null;
        }
        const f = frontier(ctx, owned).filter((h) => cash(ctx.state, ctx.me) >= claimPrice(ctx.config, h));
        const claim = best(f, (h) => fineOf(ctx, h));
        return claim ? { type: "expand", h3: claim } : null;
      }
      // Then take what others built: richest adjacent enemy parcel, war chest
      // sized to its income.
      const targets = enemyFrontier(ctx, owned).filter((h) => !ctx.state.contests?.[h]);
      const target = best(targets, (h) => incomeOf(ctx, h));
      if (target) {
        const bid = Math.min(
          cash(ctx.state, ctx.me) * 0.6,
          Math.max(ctx.config.combat.minBid, incomeOf(ctx, target) * 4)
        );
        if (bid >= ctx.config.combat.minBid && cash(ctx.state, ctx.me) >= bid) {
          return { type: "contest", h3: target, bid: Math.round(bid) };
        }
      }
      const f = frontier(ctx, owned).filter((h) => cash(ctx.state, ctx.me) >= claimPrice(ctx.config, h));
      const claim = best(f, (h) => fineOf(ctx, h));
      return claim ? { type: "expand", h3: claim } : null;
    },
    defendBid(ctx, h3) {
      return Math.min(cash(ctx.state, ctx.me) * 0.6, Math.max(150, incomeOf(ctx, h3) * 6));
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
      if (roll < 0.5 && affordable.length) {
        return { type: "expand", h3: affordable[Math.floor(ctx.rng() * affordable.length)] };
      }
      if (roll < 0.7) {
        const h = owned[Math.floor(ctx.rng() * owned.length)];
        if (ctx.state.hexes[h].upgradeLevel < ctx.config.maxUpgrade) return { type: "upgrade", h3: h };
      }
      if (roll < 0.85) {
        const targets = enemyFrontier(ctx, owned).filter((h) => !ctx.state.contests?.[h]);
        if (targets.length) {
          const h = targets[Math.floor(ctx.rng() * targets.length)];
          const bid = ctx.config.combat.minBid + Math.floor(ctx.rng() * 300);
          if (cash(ctx.state, ctx.me) >= bid) return { type: "contest", h3: h, bid };
        }
      }
      return null;
    },
    defendBid(ctx) {
      return ctx.rng() < 0.5 ? 0 : Math.round(ctx.rng() * cash(ctx.state, ctx.me) * 0.3);
    },
  };
}

export const PERSONAS: Record<string, () => Bot> = {
  rentier,
  scavenger,
  sprawler,
  exploiter,
  warlord,
  drifter,
};
