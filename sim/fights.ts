/**
 * The fight lab: archetype binders against each other, thousands of draws,
 * across every terrain. Answers the construction question before any UI
 * exists: does building a BALANCED deck beat stuffing the binder with big
 * numbers? How much does home ground matter? How swingy is a 5-card draw?
 *
 *   npx tsx sim/fights.ts
 *   npx tsx sim/fights.ts --fights 10000 --battle 3 --copies 5
 */
import {
  CATALOG,
  CARD_BY_ID,
  resolveBattle,
  type CardDef,
  type Suit,
  type Terrain,
} from "../shared/core";
import { makeRng, type Rng } from "./world";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FIGHTS = parseInt(arg("fights", "4000"), 10);
const BATTLE = parseInt(arg("battle", "5"), 10);
const COPIES = parseInt(arg("copies", "3"), 10);
const CAP = parseInt(arg("cap", "50"), 10);
const SEED = parseInt(arg("seed", "11"), 10);

// ─── Archetype binders (idealized 50-card builds under the copy cap) ──────────

/**
 * League rules: copies are capped by rarity (the pack economy is the real
 * cost curve — mythics are 3% pulls, and the binder rule should match).
 * Commons use the --copies dial.
 */
function copyCap(c: CardDef): number {
  if (c.rarity === "mythic") return 1;
  if (c.rarity === "rare") return 2;
  if (c.rarity === "uncommon") return Math.max(2, COPIES - 1);
  return COPIES;
}

function build(score: (c: CardDef) => number, filter?: (c: CardDef) => boolean): string[] {
  const pool = (filter ? CATALOG.filter(filter) : CATALOG.slice()).sort(
    (a, b) => score(b) - score(a)
  );
  const out: string[] = [];
  const counts = new Map<string, number>();
  while (out.length < CAP) {
    let placed = false;
    for (const c of pool) {
      if ((counts.get(c.id) ?? 0) >= copyCap(c)) continue;
      out.push(c.id);
      counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
      placed = true;
      if (out.length >= CAP) break;
    }
    if (!placed) break; // pool exhausted under the cap — fight understrength
  }
  return out;
}

const riteValue = (c: CardDef): number =>
  c.rite ? { surge: 2, phoenix: 2.5, sink: 1.5, pack: 2, predator: 2 }[c.rite.kind] : 0;

function balancedBuild(): string[] {
  // Even suit spread, rites valued as highly as raw power.
  const out: string[] = [];
  for (const suit of ["carrion", "machine", "tremor"] as Suit[]) {
    const third = build((c) => c.power + riteValue(c) * 1.5, (c) => c.suit === suit);
    out.push(...third.slice(0, Math.ceil(CAP / 3)));
  }
  return out.slice(0, CAP);
}

const ARCHETYPES: Record<string, () => string[]> = {
  goodstuff: () => build((c) => c.power), // five biggest numbers, every time
  balanced: balancedBuild,
  swarm: () => build((c) => (c.rite?.kind === "pack" ? 10 + c.power : c.suit === "carrion" ? c.power : 0)),
  tremorist: () => build((c) => c.power + riteValue(c), (c) => c.suit === "tremor"),
};

const TERRAINS: Record<string, Terrain> = {
  neutral: { carrion: false, machine: false, tremor: false },
  corridor: { carrion: false, machine: true, tremor: false },
  fringe: { carrion: true, machine: false, tremor: false },
  "broken ground": { carrion: false, machine: false, tremor: true },
};

// ─── The bouts ────────────────────────────────────────────────────────────────

function drawHand(binder: string[], rng: Rng, n: number): CardDef[] {
  const pool = binder.slice();
  const hand: CardDef[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    hand.push(CARD_BY_ID[pool.splice(Math.floor(rng() * pool.length), 1)[0]]);
  }
  return hand;
}

function bout(a: string[], d: string[], terrain: Terrain, rng: Rng): boolean {
  return (
    resolveBattle(drawHand(a, rng, BATTLE), drawHand(d, rng, BATTLE), terrain, BATTLE).winner ===
    "attacker"
  );
}

const names = Object.keys(ARCHETYPES);
const binders = Object.fromEntries(names.map((n) => [n, ARCHETYPES[n]()]));

console.log(
  `\nTHE FIGHT LAB — ${FIGHTS} bouts/pairing, battle size ${BATTLE}, ` +
    `copy cap ${COPIES}, binder cap ${CAP}\n`
);
for (const [tname, terrain] of Object.entries(TERRAINS)) {
  console.log(`ON ${tname.toUpperCase()} — attacker win % (row attacks column)`);
  console.log("            " + names.map((n) => n.padStart(10)).join(""));
  for (const a of names) {
    const rng = makeRng(SEED + tname.length * 1000 + names.indexOf(a));
    const row = names.map((d) => {
      let wins = 0;
      for (let i = 0; i < FIGHTS; i++) if (bout(binders[a], binders[d], terrain, rng)) wins++;
      return ((100 * wins) / FIGHTS).toFixed(1).padStart(10);
    });
    console.log(a.padEnd(12) + row.join(""));
  }
  console.log("");
}

// Mirror check: how big is the defender's tie advantage?
const rng = makeRng(SEED);
let mirrorWins = 0;
for (let i = 0; i < FIGHTS; i++) {
  if (bout(binders.balanced, binders.balanced, TERRAINS.neutral, rng)) mirrorWins++;
}
console.log(
  `MIRROR (balanced vs balanced, neutral): attacker wins ${((100 * mirrorWins) / FIGHTS).toFixed(1)}% — the rest is the defender's tie edge\n`
);
