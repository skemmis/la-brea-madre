/**
 * The testing grounds: bot-vs-bot Monte Carlo over the real rules.
 *
 *   npm run sim                          # 120 days, the six personas, LA board
 *   npm run sim -- --n 120               # a 120-player city (weighted persona mix)
 *   npm run sim -- --days 365 --seed 9
 *   npm run sim -- --n 100 --alliances 6 # the tithe experiment (see alliances.ts)
 *   npm run sim -- --bots rentier,sprawler --world synthetic
 *
 * Every action goes through the production core (applyActionMut, same rules
 * as applyAction), so an exploit found here is an exploit in prod. Invariants
 * are checked after every tick and throw loudly. A balance report prints at
 * the end and the full day-by-day metrics land in sim/out/.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  newGame,
  applyActionMut,
  tick,
  defaultConfig,
  type GameConfig,
  type GameState,
} from "../shared/core";
import { loadLaWorld, syntheticWorld, sampleEvents, sampleQuakes, makeRng, type SimWorld } from "./world";
import { PERSONAS, type Bot, type BotCtx } from "./bots";
import { makeAlliances, runAllianceDay, allianceReport, type Alliance } from "./alliances";

// ─── CLI ──────────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DAYS = parseInt(arg("days", "120"), 10);
const SEED = parseInt(arg("seed", "7"), 10);
const WORLD = arg("world", "la");
const N = parseInt(arg("n", "0"), 10); // population size; 0 = the classic six
const ALLIANCES = parseInt(arg("alliances", "0"), 10);
const BOTS = arg("bots", "rentier,scavenger,sprawler,flipper,drifter").split(",");
const MAX_ACTIONS_PER_DAY = 8;

/** A 100-player city is mostly ordinary landlords, with a criminal fringe. */
const POPULATION_MIX: [string, number][] = [
  ["rentier", 0.3],
  ["scavenger", 0.2],
  ["sprawler", 0.2],
  ["flipper", 0.15],
  ["drifter", 0.15],
];

function buildPopulation(): { bots: Bot[]; personaOf: string[] } {
  if (N > 0) {
    const bots: Bot[] = [];
    const personaOf: string[] = [];
    for (const [persona, share] of POPULATION_MIX) {
      const count = Math.max(1, Math.round(N * share));
      for (let i = 0; i < count; i++) {
        const b = PERSONAS[persona]();
        b.name = `${persona}-${String(i + 1).padStart(2, "0")}`;
        bots.push(b);
        personaOf.push(persona);
      }
    }
    return { bots, personaOf };
  }
  const bots = BOTS.map((b) => {
    const make = PERSONAS[b.trim()];
    if (!make) throw new Error(`No such persona: ${b} (have: ${Object.keys(PERSONAS).join(", ")})`);
    return make();
  });
  return { bots, personaOf: bots.map((b) => b.name) };
}

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
  buyoutsMade: number;
  buyoutsSuffered: number;
  buyoutIncome: number; // $ received from being bought out
  taxPaid: number;
  foreclosures: number;
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

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const v = [...xs].sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

// ─── The run ──────────────────────────────────────────────────────────────────

async function main() {
  const world: SimWorld = WORLD === "synthetic" ? syntheticWorld(10, SEED) : loadLaWorld();
  const rng = makeRng(SEED * 7919 + 1);

  const { bots, personaOf } = buildPopulation();
  const ids = bots.map((_, i) => String(i + 1));
  const config = defaultConfig(world.board, ids);
  let state = newGame(config, SEED);
  const alliances: Alliance[] = ALLIANCES > 0 ? makeAlliances(ALLIANCES, ids) : [];
  const allied = new Set(alliances.flatMap((a) => a.members));

  const tallies: Record<string, BotTally> = {};
  for (const id of ids)
    tallies[id] = {
      actions: {},
      rejected: 0,
      buyoutsMade: 0,
      buyoutsSuffered: 0,
      buyoutIncome: 0,
      taxPaid: 0,
      foreclosures: 0,
      quakeDamageTaken: 0,
      repairsSpent: 0,
    };

  const daily: BotStats[][] = [];
  console.log(
    `\nLA BREA MADRE TESTING GROUNDS — ${DAYS} days, seed ${SEED}, world=${WORLD}, ` +
      `${bots.length} players${alliances.length ? `, ${alliances.length} alliances` : ""}\n` +
      (N > 0
        ? `population: ${POPULATION_MIX.map(([p, s]) => `${p}×${Math.max(1, Math.round(N * s))}`).join("  ")}\n`
        : `bots: ${bots.map((b, i) => `${ids[i]}=${b.name}`).join("  ")}\n`)
  );

  const t0 = Date.now();
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
          const prevOwner = action.type === "buyout" ? state.hexes[action.h3]?.ownerId : null;
          applyActionMut(state, config, me, action);
          tallies[me].actions[action.type] = (tallies[me].actions[action.type] ?? 0) + 1;
          if (action.type === "repair") tallies[me].repairsSpent += before - state.players[me].crude;
          if (action.type === "buyout" && prevOwner) {
            tallies[me].buyoutsMade++;
            if (tallies[prevOwner]) {
              tallies[prevOwner].buyoutsSuffered++;
              tallies[prevOwner].buyoutIncome += before - state.players[me].crude;
            }
          }
        } catch {
          tallies[me].rejected++;
          break; // the bot believed something false about the rules — stop
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
    if (alliances.length) runAllianceDay(state, config, world, alliances, day);
    checkInvariants(state, config, day);

    for (const id of ids) tallies[id].taxPaid += state.lastReport?.perPlayer[id]?.taxPaid ?? 0;
    for (const f of state.lastReport?.foreclosures ?? []) {
      if (tallies[f.ownerId]) tallies[f.ownerId].foreclosures++;
    }

    const parcelCount: Record<string, number> = {};
    for (const hx of Object.values(state.hexes)) {
      if (hx.ownerId) parcelCount[hx.ownerId] = (parcelCount[hx.ownerId] ?? 0) + 1;
    }
    daily.push(
      ids.map((id, i) => ({
        bot: bots[i].name,
        cash: Math.round(state.players[id].crude),
        parcels: parcelCount[id] ?? 0,
        orders: Math.floor(state.players[id].workOrders),
        incomeToday: Math.round(state.lastReport?.perPlayer[id]?.gained ?? 0),
        ordersEarnedToday: state.lastReport?.perPlayer[id]?.ordersEarned ?? 0,
      }))
    );
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // ── The report ──
  const last = daily[daily.length - 1];
  const incomes = ids.map((id, i) => {
    const tail = daily.slice(-28).map((d) => d[i].incomeToday);
    return Math.round(tail.reduce((a, c) => a + c, 0) / tail.length);
  });

  if (N > 0) {
    // Population mode: aggregate by persona; individuals are weather.
    console.log(`PERSONA STANDINGS (day ${DAYS}, ${bots.length} players, ${elapsed}s)`);
    console.log(
      "persona      n   parcels   med$      top$    med$/day  bought/sold  forecl  rej"
    );
    for (const [persona] of POPULATION_MIX) {
      const ix = ids.map((_, i) => i).filter((i) => personaOf[i] === persona);
      const cashes = ix.map((i) => last[i].cash);
      const t = ix.map((i) => tallies[ids[i]]);
      console.log(
        `${persona.padEnd(10)} ${String(ix.length).padStart(3)} ` +
          `${String(ix.reduce((a, i) => a + last[i].parcels, 0)).padStart(9)} ` +
          `${String(Math.round(median(cashes))).padStart(8)} ` +
          `${String(Math.max(...cashes)).padStart(9)} ` +
          `${String(Math.round(median(ix.map((i) => incomes[i])))).padStart(9)} ` +
          `${String(t.reduce((a, c) => a + c.buyoutsMade, 0)).padStart(7)}/${t.reduce((a, c) => a + c.buyoutsSuffered, 0)}` +
          `${String(t.reduce((a, c) => a + c.foreclosures, 0)).padStart(7)} ` +
          `${String(t.reduce((a, c) => a + c.rejected, 0)).padStart(5)}`
      );
    }
    const board = ids
      .map((id, i) => ({ name: bots[i].name, cash: last[i].cash, parcels: last[i].parcels, perDay: incomes[i] }))
      .sort((a, b) => b.cash - a.cash);
    console.log("\nTOP TEN");
    for (const r of board.slice(0, 10)) {
      console.log(
        `  ${r.name.padEnd(14)} $${String(r.cash).padStart(9)}  ${String(r.parcels).padStart(4)} parcels  $${r.perDay}/day`
      );
    }
    console.log(
      `  …bottom: ${board[board.length - 1].name} $${board[board.length - 1].cash}, ` +
        `${board[board.length - 1].parcels} parcels`
    );
  } else {
    console.log(`FINAL STANDINGS (day ${DAYS}, ${elapsed}s)`);
    console.log(
      "bot        parcels   cash($)   $/day(28d)  orders  bought/sold  sale$   tax$  forecl  rej"
    );
    ids.forEach((id, i) => {
      const t = tallies[id];
      console.log(
        `${bots[i].name.padEnd(10)} ${String(last[i].parcels).padStart(7)} ` +
          `${String(last[i].cash).padStart(9)} ${String(incomes[i]).padStart(10)} ` +
          `${String(last[i].orders).padStart(7)} ${String(t.buyoutsMade).padStart(7)}/${t.buyoutsSuffered}` +
          `${String(Math.round(t.buyoutIncome)).padStart(8)} ${String(Math.round(t.taxPaid)).padStart(7)}` +
          `${String(t.foreclosures).padStart(7)} ${String(t.rejected).padStart(5)}`
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
  }

  const cashGini = gini(last.map((b) => b.cash));
  const parcelGini = gini(last.map((b) => b.parcels));
  const totalParcels = last.reduce((a, b) => a + b.parcels, 0);
  const quakeDmg = ids.reduce((a, id) => a + tallies[id].quakeDamageTaken, 0);
  const repairs = ids.reduce((a, id) => a + tallies[id].repairsSpent, 0);
  const totalTax = ids.reduce((a, id) => a + tallies[id].taxPaid, 0);
  const totalSales = ids.reduce((a, id) => a + tallies[id].buyoutIncome, 0);

  console.log("\nBALANCE SIGNALS");
  console.log(`parcels claimed: ${totalParcels}   cash gini: ${cashGini.toFixed(2)}   parcel gini: ${parcelGini.toFixed(2)}`);
  console.log(`quake damage dealt: ${Math.round(quakeDmg)} pts   repair $ spent: ${Math.round(repairs)}`);
  console.log(`county tax collected: $${Math.round(totalTax)}   forced-sale volume: $${Math.round(totalSales)}`);

  if (alliances.length) {
    console.log(allianceReport(state, alliances, ids, allied, last));
  }

  const flags: string[] = [];
  const leader = last.reduce((a, b) => (b.parcels > a.parcels ? b : a));
  if (leader.parcels > totalParcels * 0.5)
    flags.push(`RUNAWAY: ${leader.bot} holds ${leader.parcels}/${totalParcels} parcels — expansion is under-restricted.`);
  const flipperIds = ids.filter((_, i) => personaOf[i].startsWith("flipper") || bots[i].name.startsWith("flipper"));
  const flips = flipperIds.reduce((a, id) => a + tallies[id].buyoutsMade, 0);
  if (flips > totalParcels * 0.3)
    flags.push(`SNIPE CITY: flippers bought ${flips} parcels — assessments are systematically underpriced.`);
  if (quakeDmg > 0 && repairs < quakeDmg * 0.5)
    flags.push(`QUAKES SHRUGGED OFF: repair spending ($${Math.round(repairs)}) is small vs damage dealt — maintenance isn't binding.`);
  if (!flags.length) flags.push("none — the table looks honest at these settings");
  console.log("\nFINDINGS");
  for (const f of flags) console.log("  • " + f);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(
    here,
    "out",
    `sim-${WORLD}-s${SEED}-d${DAYS}${N ? `-n${bots.length}` : ""}${ALLIANCES ? `-a${ALLIANCES}` : ""}.json`
  );
  fs.writeFileSync(
    out,
    JSON.stringify(
      { days: DAYS, seed: SEED, world: WORLD, bots: bots.map((b) => b.name), daily, tallies, alliances },
      null,
      1
    )
  );
  console.log(`\nfull series → ${path.relative(process.cwd(), out)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
