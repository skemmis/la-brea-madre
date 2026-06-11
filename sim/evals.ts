/**
 * The fun evals — measuring CHOICES, not balance.
 *
 * The fight lab answers "what wins?". This answers the designer questions:
 *
 *   HARD CHOICES   Is there ever a real decision at the cutting table? A
 *                  choice is hard when context flips the answer: card A over
 *                  B on the corridor, B over A on the fringe. We measure each
 *                  card's value in 8 contexts (4 grounds × attack/defend),
 *                  count cards with a home, cards that are dead weight
 *                  everywhere, and the context-flip rate between card pairs.
 *
 *   FUN COMBOS     Do cards work together beyond their sum? For every pair
 *                  that appears in a hand we measure LIFT: win rate together
 *                  minus what the two cards' solo rates predict. Big positive
 *                  lift = a discoverable combo. We also measure CLUTCH: how
 *                  often a card's rite flips its lane (or the whole battle)
 *                  vs how often it's a dead letter on cardboard.
 *
 *   npx tsx sim/evals.ts --battles 30000
 */
import { CATALOG, resolveBattle, type CardDef, type Terrain } from "../shared/core";
import { makeRng, type Rng } from "./world";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const BATTLES = parseInt(arg("battles", "30000"), 10);
const SEED = parseInt(arg("seed", "17"), 10);
const LANES = 5;

const TERRAINS: [string, Terrain][] = [
  ["neutral", { black: false, blue: false, white: false }],
  ["broken", { black: true, blue: false, white: false }],
  ["corridor", { black: false, blue: true, white: false }],
  ["fringe", { black: false, blue: false, white: true }],
];

// ─── Sampling ─────────────────────────────────────────────────────────────────

/** Five distinct cards, uniform over the catalog, arranged light-to-heavy. */
function randomHand(rng: Rng): CardDef[] {
  const picked = new Set<number>();
  while (picked.size < LANES) picked.add(Math.floor(rng() * CATALOG.length));
  return [...picked]
    .map((i) => CATALOG[i])
    .sort((x, y) => x.weight - y.weight || x.id.localeCompare(y.id));
}

const stripped = new Map<string, CardDef>();
function withoutRite(c: CardDef): CardDef {
  let s = stripped.get(c.id);
  if (!s) {
    s = { ...c, rite: undefined };
    stripped.set(c.id, s);
  }
  return s;
}

// ─── Tallies ──────────────────────────────────────────────────────────────────

interface CardStat {
  plays: number;
  sideWins: number;
  byContext: Map<string, { plays: number; wins: number }>;
  riteLaneFlips: number; // its rite changed its lane's outcome
  riteBattleFlips: number; // its rite changed who took the deed
  riteDead: number; // rite present, contributed nothing at all
  ritePlays: number;
}
const cards = new Map<string, CardStat>();
for (const c of CATALOG)
  cards.set(c.id, {
    plays: 0,
    sideWins: 0,
    byContext: new Map(),
    riteLaneFlips: 0,
    riteBattleFlips: 0,
    riteDead: 0,
    ritePlays: 0,
  });

const pairs = new Map<string, { plays: number; wins: number }>();
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const rng = makeRng(SEED);
let defenderWins = 0;

for (let k = 0; k < BATTLES; k++) {
  const [tname, terrain] = TERRAINS[k % TERRAINS.length];
  const aHand = randomHand(rng);
  const dHand = randomHand(rng);
  const res = resolveBattle(aHand, dHand, terrain, LANES);
  if (res.winner === "defender") defenderWins++;

  const record = (hand: CardDef[], side: "attacker" | "defender") => {
    const won = res.winner === side;
    const ctx = `${tname}/${side}`;
    for (const c of hand) {
      const st = cards.get(c.id)!;
      st.plays++;
      if (won) st.sideWins++;
      let cs = st.byContext.get(ctx);
      if (!cs) st.byContext.set(ctx, (cs = { plays: 0, wins: 0 }));
      cs.plays++;
      if (won) cs.wins++;
    }
    for (let i = 0; i < hand.length; i++) {
      for (let j = i + 1; j < hand.length; j++) {
        const key = pairKey(hand[i].id, hand[j].id);
        let ps = pairs.get(key);
        if (!ps) pairs.set(key, (ps = { plays: 0, wins: 0 }));
        ps.plays++;
        if (won) ps.wins++;
      }
    }
  };
  record(aHand, "attacker");
  record(dHand, "defender");

  // Clutch: re-resolve with each rited card silenced, one at a time.
  const probe = (hand: CardDef[], side: "attacker" | "defender", lane: number) => {
    const c = hand[lane];
    if (!c.rite) return;
    const st = cards.get(c.id)!;
    st.ritePlays++;
    const mut = hand.slice();
    mut[lane] = withoutRite(c);
    const alt =
      side === "attacker"
        ? resolveBattle(mut, dHand, terrain, LANES)
        : resolveBattle(aHand, mut, terrain, LANES);
    const laneFlipped = alt.lanes[lane].winner !== res.lanes[lane].winner || alt.lanes[lane].sunk !== res.lanes[lane].sunk;
    const battleFlipped = alt.winner !== res.winner;
    if (battleFlipped) st.riteBattleFlips++;
    if (laneFlipped) st.riteLaneFlips++;
    if (!laneFlipped && !battleFlipped) {
      // Did it at least move a number anywhere? If not, the rite was dead ink.
      const same = res.lanes.every(
        (l, i) =>
          l.attackerPower === alt.lanes[i].attackerPower &&
          l.defenderPower === alt.lanes[i].defenderPower
      );
      if (same) st.riteDead++;
    }
  };
  for (let i = 0; i < LANES; i++) {
    probe(aHand, "attacker", i);
    probe(dHand, "defender", i);
  }
}

// ─── The report ───────────────────────────────────────────────────────────────

const overall = 0.5; // each battle records one winning and one losing side
console.log(
  `\nTHE FUN EVALS — ${BATTLES} battles, random 5-card hands, seed ${SEED}` +
    `   (defender wins ${((100 * defenderWins) / BATTLES).toFixed(1)}% of raids)\n`
);

// 1. Clutch & dead ink.
console.log("CLUTCH — how often each rite DECIDES (battle flips / lane flips / dead ink, % of its plays)");
const FATE_SIDE = new Set(["phoenix", "medic", "poach"]);
const byClutch = CATALOG.filter((c) => c.rite && !FATE_SIDE.has(c.rite.kind)).map((c) => {
  const st = cards.get(c.id)!;
  return {
    c,
    battle: (100 * st.riteBattleFlips) / Math.max(1, st.ritePlays),
    lane: (100 * st.riteLaneFlips) / Math.max(1, st.ritePlays),
    dead: (100 * st.riteDead) / Math.max(1, st.ritePlays),
  };
}).sort((x, y) => y.battle - x.battle);
for (const r of byClutch) {
  console.log(
    `  ${r.c.name.padEnd(32)} battle ${r.battle.toFixed(1).padStart(5)}%   lane ${r.lane
      .toFixed(1)
      .padStart(5)}%   dead ${r.dead.toFixed(1).padStart(5)}%   (${r.c.rite!.kind})`
  );
}
const meanBattleFlip = byClutch.reduce((a, r) => a + r.battle, 0) / byClutch.length;
console.log(
  `  (phoenix / medic / poach are PAID AT DAWN — in cards kept, healed, and stolen — and are not measured here)`
);
console.log(`  → a rite decides the deed in ${meanBattleFlip.toFixed(1)}% of its appearances on average\n`);

// 2. Hard choices: context ranks.
const contexts: string[] = [];
for (const [t] of TERRAINS) for (const s of ["attacker", "defender"]) contexts.push(`${t}/${s}`);
const rankIn = new Map<string, Map<string, number>>(); // ctx -> card -> rank
for (const ctx of contexts) {
  const rated = CATALOG.map((c) => {
    const cs = cards.get(c.id)!.byContext.get(ctx);
    return { id: c.id, wr: cs ? cs.wins / cs.plays : 0 };
  }).sort((x, y) => y.wr - x.wr);
  const m = new Map<string, number>();
  rated.forEach((r, i) => m.set(r.id, i + 1));
  rankIn.set(ctx, m);
}
const homes = CATALOG.map((c) => {
  const ranks = contexts.map((ctx) => rankIn.get(ctx)!.get(c.id)!);
  return { c, best: Math.min(...ranks), worst: Math.max(...ranks), spread: Math.max(...ranks) - Math.min(...ranks) };
});
const TOP = 10;
const withHome = homes.filter((h) => h.best <= TOP);
const deadWeight = homes.filter((h) => h.best > CATALOG.length - 12);
const dominant = homes.filter((h) => h.worst <= TOP);
console.log("HARD CHOICES — does context change the right answer?");
console.log(`  cards with a home (top ${TOP} in ≥1 of 8 contexts): ${withHome.length}/${CATALOG.length}`);
console.log(`  strictly dominant (top ${TOP} in ALL contexts):     ${dominant.length}  ${dominant.map((h) => h.c.name).join(", ") || ""}`);
console.log(`  dead weight (never above the bottom dozen):        ${deadWeight.length}  ${deadWeight.map((h) => h.c.name).join(", ") || ""}`);
// Context-flip rate among all pairs.
let flips = 0;
let comparisons = 0;
for (let i = 0; i < CATALOG.length; i++) {
  for (let j = i + 1; j < CATALOG.length; j++) {
    let iAhead = false;
    let jAhead = false;
    for (const ctx of contexts) {
      const ri = rankIn.get(ctx)!.get(CATALOG[i].id)!;
      const rj = rankIn.get(ctx)!.get(CATALOG[j].id)!;
      if (ri < rj) iAhead = true;
      else if (rj < ri) jAhead = true;
    }
    comparisons++;
    if (iAhead && jAhead) flips++;
  }
}
console.log(`  context-flip rate (pairs whose order inverts somewhere): ${((100 * flips) / comparisons).toFixed(1)}%`);
const biggestSwings = [...homes].sort((x, y) => y.spread - x.spread).slice(0, 5);
console.log(
  `  biggest context swings: ${biggestSwings.map((h) => `${h.c.name} (#${h.best}→#${h.worst})`).join(", ")}\n`
);

// 3. Fun combos: pair lift.
const solo = new Map<string, number>();
for (const c of CATALOG) {
  const st = cards.get(c.id)!;
  solo.set(c.id, st.sideWins / Math.max(1, st.plays));
}
const MIN_N = Math.max(60, BATTLES / 400);
const lifts = [...pairs.entries()]
  .filter(([, v]) => v.plays >= MIN_N)
  .map(([key, v]) => {
    const [a, b] = key.split("|");
    const expected = solo.get(a)! + solo.get(b)! - overall;
    return { a, b, n: v.plays, lift: 100 * (v.wins / v.plays - expected) };
  })
  .sort((x, y) => y.lift - x.lift);
const name = (id: string) => CATALOG.find((c) => c.id === id)!.name;
console.log(`COMBOS — pair lift vs what the two cards predict alone (n ≥ ${Math.round(MIN_N)})`);
console.log("  the dozen that sing:");
for (const l of lifts.slice(0, 12)) {
  console.log(`    +${l.lift.toFixed(1).padStart(4)}  ${name(l.a)}  ✕  ${name(l.b)}   (n=${l.n})`);
}
console.log("  the worst marriages:");
for (const l of lifts.slice(-5)) {
  console.log(`    ${l.lift.toFixed(1).padStart(5)}  ${name(l.a)}  ✕  ${name(l.b)}   (n=${l.n})`);
}
const singing = lifts.filter((l) => l.lift > 5).length;
console.log(`\nVERDICTS`);
console.log(`  • rites decide deeds ${meanBattleFlip.toFixed(1)}% of the time they appear (want 8–25%: below = wallpaper, above = chaos)`);
console.log(`  • ${withHome.length}/${CATALOG.length} cards have a home context; ${deadWeight.length} are dead weight; ${dominant.length} are always-right picks (want 0)`);
console.log(`  • ${singing} pairs lift more than +5 points — discoverable combos (want a dozen or more)`);
console.log("");
