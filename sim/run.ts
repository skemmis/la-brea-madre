/**
 * The testing grounds: bot-vs-bot Monte Carlo over the real rules.
 *
 *   npm run sim                          # 120 days, all six personas, LA board
 *   npm run sim -- --days 365 --seed 9
 *   npm run sim -- --bots rentier,sprawler,warlord --world synthetic
 *
 * Every action goes through the production core (applyAction/tick), so an
 * exploit found here is an exploit in prod. Invariants are checked after
 * every tick and throw loudly. A balance report prints at the end and the
 * full day-by-day metrics land in sim/out/.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  newGame,
  applyAction,
  tick,
  defaultConfig,
  type Action,
  type GameConfig,
  type GameState,
} from "../shared/core";
import { loadLaWorld, syntheticWorld, sampleEvents, sampleQuakes, makeRng, type SimWorld } from "./world";
import { PERSONAS, type Bot, type BotCtx } from "./bots";

// ─── CLI ──────────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DAYS = parseInt(arg("days", "120"), 10);
const SEED = parseInt(arg("seed", "7"), 10);
const WORLD = arg("world", "la");
const BOTS = arg("bots", "rentier,scavenger,sprawler,exploiter,warlord,drifter").split(",");
const MAX_ACTIONS_PER_DAY = 8;

// ─── Invariants: the rulebook can't bend ──────────────────────────────────────

function checkInvariants(state: GameState, config: GameConfig, day: number): void {
  for (const [id, p] of Object.entries(state.players)) {
    if (!Number.isFinite(p.crude)) throw new Error(`day ${day}: ${id} has non-finite cash`);
    if (p.crude < -1e-6) throw new Error(`day ${day}: ${id} has negative cash (${p.crude})`);
    if (p.workOrders < -1e-6) throw new Error(`day ${day}: ${id} has negative orders`);
    if (p.workOrders > config.workOrders.cap + 1e-6)
      throw new Error(`day ${day}: ${id} exceeds the order cap (${p.workOrders})`);
  }
  for (const [h3, hx] of Object.entries(state.hexes)) {
    if (hx.degradation < 0 || hx.degradation > 100)
      throw new Error(`day ${day}: ${h3} degradation out of range (${hx.degradation})`);
    if (hx.upgradeLevel < 0 || hx.upgradeLevel > config.maxUpgrade)
      throw new Error(`day ${day}: ${h3} upgrade out of range`);
  }
  if (Object.keys(state.contests ?? {}).length)
    throw new Error(`day ${day}: contests survived the tick`);
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

interface BotStats {
  bot: string;
  cash: number;
  parcels: number;
  orders: number;
  incomeToday: number;
  ordersEarnedToday: number;
}

interface BotTally {
  actions: Record<string, number>;
  rejected: number;
  contestsWon: number;
  contestsLost: number;
  defensesHeld: number;
  parcelsLostToWar: number;
  quakeDamageTaken: number;
  repairsSpent: number;
}

function gini(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const sum = v.reduce((a, c) => a + c, 0);
  if (!sum || n < 2) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * v[i];
  return acc / (n * sum);
}

// ─── The run ──────────────────────────────────────────────────────────────────

async function main() {
  const world: SimWorld = WORLD === "synthetic" ? syntheticWorld(10, SEED) : loadLaWorld();
  const rng = makeRng(SEED * 7919 + 1);

  const bots: Bot[] = BOTS.map((b) => {
    const make = PERSONAS[b.trim()];
    if (!make) throw new Error(`No such persona: ${b} (have: ${Object.keys(PERSONAS).join(", ")})`);
    return make();
  });
  const ids = bots.map((_, i) => String(i + 1));
  const config = defaultConfig(world.board, ids);
  let state = newGame(config, SEED);

  const tallies: Record<string, BotTally> = {};
  for (const id of ids)
    tallies[id] = {
      actions: {},
      rejected: 0,
      contestsWon: 0,
      contestsLost: 0,
      defensesHeld: 0,
      parcelsLostToWar: 0,
      quakeDamageTaken: 0,
      repairsSpent: 0,
    };

  const daily: BotStats[][] = [];
  console.log(
    `\nLA BREA MADRE TESTING GROUNDS — ${DAYS} days, seed ${SEED}, world=${WORLD}\n` +
      `bots: ${bots.map((b, i) => `${ids[i]}=${b.name}`).join("  ")}\n`
  );

  for (let day = 0; day < DAYS; day++) {
    // ── Action phase (rotating start order so nobody owns the morning) ──
    const order = ids.map((_, i) => (i + day) % ids.length);
    for (const idx of order) {
      const bot = bots[idx];
      const me = ids[idx];
      for (let step = 0; step < MAX_ACTIONS_PER_DAY; step++) {
        const ctx: BotCtx = { state, config, me, world, rng };
        const action = bot.nextAction(ctx);
        if (!action) break;
        try {
          const before = state.players[me].crude;
          state = applyAction(state, config, me, action);
          tallies[me].actions[action.type] = (tallies[me].actions[action.type] ?? 0) + 1;
          if (action.type === "repair") tallies[me].repairsSpent += before - state.players[me].crude;
        } catch {
          tallies[me].rejected++;
          break; // the bot believed something false about the rules — stop
        }
      }
    }

    // ── Defense phase: respond to today's declarations ──
    for (const [h3, c] of Object.entries(state.contests ?? {})) {
      const idx = ids.indexOf(c.defenderId);
      if (idx === -1 || c.defenderBid > 0) continue;
      const bid = Math.round(bots[idx].defendBid({ state, config, me: c.defenderId, world, rng }, h3));
      if (bid > 0 && state.players[c.defenderId].crude >= bid) {
        try {
          state = applyAction(state, config, c.defenderId, { type: "defend", h3, bid });
        } catch {
          tallies[c.defenderId].rejected++;
        }
      }
    }

    // ── The world happens ──
    const owned = Object.keys(state.hexes).filter((h) => state.hexes[h].ownerId);
    const quakes = sampleQuakes(rng);
    const events = sampleEvents(world, owned, day, rng, quakes);
    for (const e of events) {
      if (e.kind === "quake") {
        const owner = state.hexes[e.h3]?.ownerId;
        if (owner) tallies[owner].quakeDamageTaken += e.magnitude;
      }
    }
    state = tick(state, config, events, { weeklyFree: day % 7 === 1 });
    checkInvariants(state, config, day);

    for (const r of state.lastReport?.contests ?? []) {
      if (r.winnerId === r.attackerId) {
        tallies[r.attackerId].contestsWon++;
        tallies[r.defenderId].contestsLost++;
        tallies[r.defenderId].parcelsLostToWar++;
      } else {
        tallies[r.attackerId].contestsLost++;
        tallies[r.defenderId].defensesHeld++;
      }
    }

    daily.push(
      ids.map((id, i) => ({
        bot: bots[i].name,
        cash: Math.round(state.players[id].crude),
        parcels: Object.values(state.hexes).filter((h) => h.ownerId === id).length,
        orders: Math.floor(state.players[id].workOrders),
        incomeToday: Math.round(state.lastReport?.perPlayer[id]?.gained ?? 0),
        ordersEarnedToday: state.lastReport?.perPlayer[id]?.ordersEarned ?? 0,
      }))
    );
  }

  // ── The report ──
  const last = daily[daily.length - 1];
  const incomes = ids.map((id, i) => {
    const tail = daily.slice(-28).map((d) => d[i].incomeToday);
    return Math.round(tail.reduce((a, c) => a + c, 0) / tail.length);
  });

  console.log("FINAL STANDINGS (day " + DAYS + ")");
  console.log(
    "bot        parcels   cash($)    $/day(28d)  orders  won/lost(war)  held  rejected"
  );
  ids.forEach((id, i) => {
    const t = tallies[id];
    console.log(
      `${bots[i].name.padEnd(10)} ${String(last[i].parcels).padStart(7)} ` +
        `${String(last[i].cash).padStart(9)} ${String(incomes[i]).padStart(11)} ` +
        `${String(last[i].orders).padStart(7)} ${String(t.contestsWon).padStart(7)}/${t.contestsLost}` +
        `${String(t.defensesHeld).padStart(9)} ${String(t.rejected).padStart(9)}`
    );
  });

  console.log("\nACTION MIX");
  ids.forEach((id, i) => {
    const t = tallies[id];
    const mix = Object.entries(t.actions)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    console.log(`${bots[i].name.padEnd(10)} ${mix}`);
  });

  const cashGini = gini(last.map((b) => b.cash));
  const parcelGini = gini(last.map((b) => b.parcels));
  const totalParcels = last.reduce((a, b) => a + b.parcels, 0);
  const quakeDmg = ids.reduce((a, id) => a + tallies[id].quakeDamageTaken, 0);
  const repairs = ids.reduce((a, id) => a + tallies[id].repairsSpent, 0);

  console.log("\nBALANCE SIGNALS");
  console.log(`parcels claimed: ${totalParcels}   cash gini: ${cashGini.toFixed(2)}   parcel gini: ${parcelGini.toFixed(2)}`);
  console.log(`quake damage dealt: ${Math.round(quakeDmg)} pts   repair $ spent: ${Math.round(repairs)}`);

  const flags: string[] = [];
  const leader = last.reduce((a, b) => (b.parcels > a.parcels ? b : a));
  if (leader.parcels > totalParcels * 0.5)
    flags.push(`RUNAWAY: ${leader.bot} holds ${leader.parcels}/${totalParcels} parcels — expansion is under-restricted.`);
  const exploiterIdx = bots.findIndex((b) => b.name === "exploiter");
  const rentierIdx = bots.findIndex((b) => b.name === "rentier");
  if (exploiterIdx !== -1 && rentierIdx !== -1 && last[exploiterIdx].cash > last[rentierIdx].cash * 1.3)
    flags.push(`EXPLOIT OP: never-repairing exploiter out-earns the careful rentier by >30%.`);
  const warlordIdx = bots.findIndex((b) => b.name === "warlord");
  if (warlordIdx !== -1 && tallies[ids[warlordIdx]].contestsWon === 0 && (tallies[ids[warlordIdx]].actions["contest"] ?? 0) > 3)
    flags.push(`WAR DEAD LETTER: the warlord declared ${tallies[ids[warlordIdx]].actions["contest"]} contests and won none.`);
  if (quakeDmg > 0 && repairs < quakeDmg * 0.5)
    flags.push(`QUAKES SHRUGGED OFF: repair spending ($${Math.round(repairs)}) is small vs damage dealt — maintenance isn't binding.`);
  if (!flags.length) flags.push("none — the table looks honest at these settings");
  console.log("\nFINDINGS");
  for (const f of flags) console.log("  • " + f);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, "out", `sim-${WORLD}-s${SEED}-d${DAYS}.json`);
  fs.writeFileSync(out, JSON.stringify({ days: DAYS, seed: SEED, world: WORLD, bots: bots.map((b) => b.name), daily, tallies }, null, 1));
  console.log(`\nfull series → ${path.relative(process.cwd(), out)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
