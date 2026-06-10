/**
 * Alliances — a SIM-ONLY prototype of the tithe-and-vote layer.
 *
 * The proposal under test: players join an alliance, tithe a share of their
 * daily ticket income into a common treasury, and vote weekly on what the
 * treasury buys. The tithe is the leveling mechanism — big landlords pay in
 * proportion to income, while two of the three programs pay out per *member*:
 *
 *   stipend   split the treasury equally — straight redistribution
 *   works     retrofit members' most valuable unprotected parcels
 *   orders    buy Work Orders for the members who have none
 *
 * Voting is one-member-one-vote (a whale funds the treasury but cannot
 * outvote the rank and file). Bots vote their needs, not their ideals.
 *
 * Nothing here touches the production core: tithes and benefits are applied
 * by direct state mutation after each tick, exactly the way a shell-level
 * alliance service would. If the experiment levels the table without killing
 * the incentive to earn, it graduates to shared/core.
 */
import { claimPrice, type GameConfig, type GameState, type PlayerId } from "../shared/core";
import type { SimWorld } from "./world";

export interface Alliance {
  id: string;
  name: string;
  members: PlayerId[];
  /** Fraction of each member's daily parcel income tithed to the treasury. */
  titheRate: number;
  treasury: number;
  // Running tallies for the report.
  tithed: number;
  paid: { stipend: number; works: number; orders: number };
  wins: { stipend: number; works: number; orders: number };
}

const NAMES = [
  "The Tar Court",
  "Sons of the Slick",
  "The Meter Maids",
  "La Hermandad",
  "The Carrion Guild",
  "Orden del Temblor",
  "The Sepulveda Ring",
  "Hijos de la Brea",
];

const ORDER_PRICE = 150; // $ the treasury pays per purchased Work Order

/**
 * Found `n` alliances over the population. Tithe rates climb 5% → 25% so a
 * single run shows the dose-response curve; every 4th player stays
 * unaffiliated as the control group.
 */
export function makeAlliances(n: number, ids: PlayerId[]): Alliance[] {
  const alliances: Alliance[] = [];
  for (let i = 0; i < n; i++) {
    alliances.push({
      id: String(i),
      name: NAMES[i % NAMES.length],
      members: [],
      titheRate: Math.min(0.25, 0.05 + 0.05 * i),
      treasury: 0,
      tithed: 0,
      paid: { stipend: 0, works: 0, orders: 0 },
      wins: { stipend: 0, works: 0, orders: 0 },
    });
  }
  let seat = 0;
  ids.forEach((id, i) => {
    if (i % 4 === 3) return; // the unaffiliated control group
    alliances[seat % n].members.push(id);
    seat++;
  });
  return alliances;
}

type Program = "stipend" | "works" | "orders";

/** A member votes their needs: broke → stipend, idle → orders, exposed → works. */
function voteOf(
  state: GameState,
  world: SimWorld,
  memberCashMedian: number,
  id: PlayerId,
  unprotectedValue: number
): Program {
  const p = state.players[id];
  if (!p) return "stipend";
  if (Math.floor(p.workOrders) < 1) return "orders";
  if (p.crude < memberCashMedian * 0.5) return "stipend";
  if (unprotectedValue > 500) return "works";
  return "stipend";
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const v = [...xs].sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

/** Tithe daily; vote and spend weekly. Mutates state (sim-shell privilege). */
export function runAllianceDay(
  state: GameState,
  config: GameConfig,
  world: SimWorld,
  alliances: Alliance[],
  day: number
): void {
  for (const a of alliances) {
    // ── The tithe: a cut of today's parcel income, never of the principal ──
    for (const id of a.members) {
      const p = state.players[id];
      const gained = state.lastReport?.perPlayer[id]?.gained ?? 0;
      if (!p || gained <= 0) continue;
      const tithe = Math.min(Math.max(0, p.crude), Math.round(gained * a.titheRate));
      p.crude -= tithe;
      a.treasury += tithe;
      a.tithed += tithe;
    }

    // ── The weekly meeting ──
    if (day % 7 !== 1 || a.treasury < 1 || !a.members.length) continue;

    // Each member's most valuable unretrofitted holding (for works votes).
    const unprotectedBest = new Map<PlayerId, { h3: string; fine: number }>();
    for (const [h3, hx] of Object.entries(state.hexes)) {
      if (!hx.ownerId || hx.retrofitted || !a.members.includes(hx.ownerId)) continue;
      const fine = world.fineRate.get(h3) ?? 0;
      const cur = unprotectedBest.get(hx.ownerId);
      if (!cur || fine > cur.fine) unprotectedBest.set(hx.ownerId, { h3, fine });
    }

    const cashMedian = median(a.members.map((id) => state.players[id]?.crude ?? 0));
    const ballots: Record<Program, number> = { stipend: 0, works: 0, orders: 0 };
    for (const id of a.members) {
      ballots[voteOf(state, world, cashMedian, id, unprotectedBest.get(id)?.fine ?? 0)]++;
    }
    const program = (Object.entries(ballots) as [Program, number][]).reduce((best, cur) =>
      cur[1] > best[1] ? cur : best
    )[0]; // ties keep insertion order — stipend, the leveling default
    a.wins[program]++;

    if (program === "stipend") {
      const cut = Math.floor(a.treasury / a.members.length);
      if (cut < 1) continue;
      for (const id of a.members) {
        const p = state.players[id];
        if (!p) continue;
        p.crude += cut;
        a.treasury -= cut;
        a.paid.stipend += cut;
      }
    } else if (program === "orders") {
      // Fewest-first, one order per member per meeting, while funds last.
      const needy = a.members
        .filter((id) => state.players[id])
        .sort((x, y) => state.players[x].workOrders - state.players[y].workOrders);
      for (const id of needy) {
        if (a.treasury < ORDER_PRICE) break;
        const p = state.players[id];
        if (p.workOrders >= config.workOrders.cap) continue;
        p.workOrders = Math.min(config.workOrders.cap, p.workOrders + 1);
        a.treasury -= ORDER_PRICE;
        a.paid.orders += ORDER_PRICE;
      }
    } else {
      // Works: bolt down members' crown jewels, most valuable first.
      const jobs = [...unprotectedBest.entries()].sort((x, y) => y[1].fine - x[1].fine);
      for (const [, job] of jobs) {
        const cost = Math.round(claimPrice(config, job.h3) * config.works.retrofitCostFraction);
        if (cost > a.treasury) continue;
        state.hexes[job.h3].retrofitted = true;
        a.treasury -= cost;
        a.paid.works += cost;
      }
    }
  }
}

/** The alliance section of the end-of-run report. */
export function allianceReport(
  state: GameState,
  alliances: Alliance[],
  ids: PlayerId[],
  allied: Set<PlayerId>,
  last: { cash: number; parcels: number }[]
): string {
  const lines: string[] = ["\nTHE ALLIANCES"];
  lines.push("name                tithe  members  collected$  treasury$  stipend$  works$  orders$  votes(s/w/o)");
  for (const a of alliances) {
    const memberCash = a.members.map((id) => state.players[id]?.crude ?? 0);
    lines.push(
      `${a.name.padEnd(19)} ${(a.titheRate * 100).toFixed(0).padStart(4)}% ` +
        `${String(a.members.length).padStart(8)} ${String(Math.round(a.tithed)).padStart(11)} ` +
        `${String(Math.round(a.treasury)).padStart(10)} ${String(Math.round(a.paid.stipend)).padStart(9)} ` +
        `${String(Math.round(a.paid.works)).padStart(7)} ${String(Math.round(a.paid.orders)).padStart(8)}  ` +
        `${a.wins.stipend}/${a.wins.works}/${a.wins.orders}` +
        `   med$ ${Math.round(median(memberCash))}`
    );
  }

  const gini = (values: number[]): number => {
    const v = [...values].sort((x, y) => x - y);
    const n = v.length;
    const sum = v.reduce((x, y) => x + y, 0);
    if (!sum || n < 2) return 0;
    let acc = 0;
    for (let i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * v[i];
    return acc / (n * sum);
  };
  const alliedCash = ids.filter((id) => allied.has(id)).map((id, _i) => state.players[id]?.crude ?? 0);
  const loneIdx = ids.map((id, i) => [id, i] as const).filter(([id]) => !allied.has(id));
  const loneCash = loneIdx.map(([id]) => state.players[id]?.crude ?? 0);
  lines.push(
    `\nLEVELING CHECK   allied: n=${alliedCash.length} gini=${gini(alliedCash).toFixed(2)} ` +
      `med$=${Math.round(median(alliedCash))}   unaffiliated: n=${loneCash.length} ` +
      `gini=${gini(loneCash).toFixed(2)} med$=${Math.round(median(loneCash))}`
  );
  return lines.join("\n");
}
