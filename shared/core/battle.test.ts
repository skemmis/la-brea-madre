/**
 * Tests for the deck-fight layer: the resolver's arithmetic, and the raid
 * lifecycle through the real core (escrow, nightly resolution, the finite
 * army, burn/rest regimes).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { latLngToCell, gridDisk } from "h3-js";
import {
  newGame,
  applyAction,
  applyActionMut,
  tick,
  defaultConfig,
  resolveBattle,
  buyPackMut,
  CARD_BY_ID,
  type BoardHex,
  type GameConfig,
  type Terrain,
} from "./index";

const NOWHERE: Terrain = { carrion: false, machine: false, tremor: false };
const card = (id: string) => CARD_BY_ID[id];

// A small real board: a center hex and its 6 neighbours, all worthless dirt.
const CENTER = latLngToCell(34.05, -118.24, 7);
const RING = gridDisk(CENTER, 1);
const board: Record<string, BoardHex> = {};
for (const h of RING) board[h] = { wells: 0 };

function raidConfig(over: Partial<GameConfig["raids"]> = {}): GameConfig {
  const cfg = defaultConfig(board, ["1", "2"]);
  return { ...cfg, raids: { ...cfg.raids, enabled: true, ...over } };
}

// ─── The resolver ─────────────────────────────────────────────────────────────

test("higher power takes the lane; most lanes takes the battle; ties defend", () => {
  const r = resolveBattle(
    [card("m10"), card("m04"), card("t02")], // 9, 4, 2
    [card("t07"), card("t07"), card("t07")], // 5, 5, 5 (machine counters tremor +2)
    NOWHERE,
    3
  );
  // Lane 1: 9+2 vs 5 attacker. Lane 2: 4+2 vs 5 attacker. Lane 3: 2 vs 5+2 defender.
  assert.equal(r.attackerLanes, 2);
  assert.equal(r.defenderLanes, 1);
  assert.equal(r.winner, "attacker");

  const tie = resolveBattle([card("m04")], [card("m04")], NOWHERE, 1);
  assert.equal(tie.winner, "defender", "equal power defends the deed");
});

test("the counter triangle pays +3, home ground +2", () => {
  // Carrion 1 vs machine 1: possum gets +3 counter (+1 pack needs friends).
  const r = resolveBattle([card("c01")], [card("m01")], NOWHERE, 1);
  assert.equal(r.lanes[0].attackerPower, 4);
  assert.equal(r.lanes[0].defenderPower, 1);

  // Same fight on machine ground: the meter holds home turf and surges.
  const home = resolveBattle([card("c01")], [card("m01")], { ...NOWHERE, machine: true }, 1);
  assert.equal(home.lanes[0].defenderPower, 5, "1 base + 2 affinity + 2 surge");
});

test("the pack runs together and LA MADRE takes both", () => {
  const swarm = resolveBattle(
    [card("c09"), card("c01"), card("c02")], // rats 2 + 2/other-carrion = 6
    [card("m06"), card("m06"), card("m06")],
    NOWHERE,
    3
  );
  // Rats: 2 base + 3 counter(machine) + 2×2 pack = 9 vs THE BOOT 5.
  assert.equal(swarm.lanes[0].attackerPower, 9);

  const sink = resolveBattle([card("t10")], [card("m10")], NOWHERE, 1);
  assert.equal(sink.lanes[0].winner, "none");
  assert.ok(sink.lanes[0].sunk);
  assert.equal(sink.winner, "defender", "a fully sunk battle defends");
});

test("phoenixes are never among the beaten; empty lanes lose to anyone", () => {
  const r = resolveBattle([card("m10")], [card("c04")], NOWHERE, 2); // coyote loses lane 1
  assert.equal(r.beaten.defender.length, 0, "el coyote walks away");
  assert.equal(r.lanes[1].winner, "none", "two empty lanes score nothing");
  const scraps = resolveBattle([card("m01")], [], NOWHERE, 1);
  assert.equal(scraps.winner, "attacker", "an empty garrison falls");
});

// ─── The raid lifecycle ───────────────────────────────────────────────────────

function armed(cfg: GameConfig, attackerCards: string[], defenderCards: string[]) {
  let s = newGame(cfg, 42);
  s = applyAction(s, cfg, "2", { type: "expand", h3: CENTER }); // defender deeds CENTER
  const other = RING.find((h) => h !== CENTER)!;
  s = applyAction(s, cfg, "1", { type: "expand", h3: other }); // attacker lands nearby
  s.players["1"].binder = attackerCards.map((def) => ({ def }));
  s.players["2"].binder = defenderCards.map((def) => ({ def }));
  return s;
}

test("a won raid takes the deed and pays the loser half their own price", () => {
  const cfg = raidConfig();
  let s = armed(cfg, Array(5).fill("m10"), Array(5).fill("t02")); // 9s vs 2s
  const cashBefore = { a: s.players["1"].crude, d: s.players["2"].crude };
  s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
  assert.equal(s.players["1"].crude, cashBefore.a - 50, "escrow = half the $100 ask");
  s = tick(s, cfg, []);
  assert.equal(s.hexes[CENTER].ownerId, "1", "the deed falls");
  const raid = s.lastReport!.raids![0];
  assert.ok(raid.attackerWon);
  // Defender got the $50 comp, then both paid their $1 county tax (1 parcel each... attacker now holds 2).
  assert.ok(s.players["2"].crude > cashBefore.d, "the loser is compensated");
});

test("a failed raid forfeits the stake to the defender and refunds the rest", () => {
  const cfg = raidConfig();
  let s = armed(cfg, Array(5).fill("t02"), Array(5).fill("m10")); // 2s vs 9s
  const cashBefore = { a: s.players["1"].crude, d: s.players["2"].crude };
  s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
  s = tick(s, cfg, []);
  assert.equal(s.hexes[CENTER].ownerId, "2", "the walls hold");
  const taxA = s.lastReport!.perPlayer["1"].taxPaid;
  const taxD = s.lastReport!.perPlayer["2"].taxPaid;
  assert.equal(s.players["1"].crude, cashBefore.a - 25 - taxA, "stake lost, remainder refunded");
  assert.equal(s.players["2"].crude, cashBefore.d + 25 - taxD, "the defender keeps the stake");
});

test("the finite army: a drained binder fights the next front on scraps", () => {
  const cfg = raidConfig({ battleSize: 5 });
  // Defender owns CENTER and a neighbour; only 7 cards — one full defense + scraps.
  let s = armed(cfg, Array(10).fill("m04"), Array(7).fill("m10"));
  const second = RING.find((h) => h !== CENTER && s.hexes[h]?.ownerId !== "1")!;
  s.players["2"].workOrders = 1;
  applyActionMut(s, cfg, "2", { type: "expand", h3: second });
  s.players["1"].workOrders = 2;
  s.players["1"].crude = 10_000;
  applyActionMut(s, cfg, "1", { type: "raid", h3: CENTER });
  applyActionMut(s, cfg, "1", { type: "raid", h3: second });
  s = tick(s, cfg, []);
  const [first, scraps] = s.lastReport!.raids!;
  assert.equal(first.defenderCards, 5, "the first front gets a full garrison");
  assert.equal(scraps.defenderCards, 2, "the second fights on scraps");
  assert.ok(!first.attackerWon, "five GRIDLOCKs hold the first wall");
  assert.ok(scraps.attackerWon, "the drained front falls");
});

test("burn and rest regimes discipline the beaten", () => {
  const burn = raidConfig({ burnBeaten: true });
  let s = armed(burn, Array(5).fill("m10"), Array(5).fill("t02"));
  s = applyAction(s, burn, "1", { type: "raid", h3: CENTER });
  s = tick(s, burn, []);
  assert.equal(s.players["2"].binder!.length, 0, "five beaten cards burned");
  assert.equal(s.players["1"].binder!.length, 5, "the victors all came home");

  const rest = raidConfig({ beatenRestDays: 3 });
  let r = armed(rest, Array(5).fill("m10"), Array(5).fill("t02"));
  r = applyAction(r, rest, "1", { type: "raid", h3: CENTER });
  r = tick(r, rest, []);
  const resting = r.players["2"].binder!.filter((c) => (c.restUntil ?? 0) > r.tick);
  assert.equal(resting.length, 5, "the beaten rest");
});

test("buyouts are closed when raids are open (and vice versa)", () => {
  const cfg = raidConfig();
  let s = armed(cfg, ["m01"], ["m01"]);
  assert.throws(() => applyAction(s, cfg, "1", { type: "buyout", h3: CENTER }), /window is closed/);
  const peace = defaultConfig(board, ["1", "2"]);
  let p = newGame(peace, 1);
  p = applyAction(p, peace, "2", { type: "expand", h3: CENTER });
  assert.throws(() => applyAction(p, peace, "1", { type: "raid", h3: CENTER }), /not open/);
});

test("packs cost scrip and respect the binder cap; same seed, same pulls", () => {
  const cfg = raidConfig();
  const s = newGame(cfg, 7);
  assert.throws(() => buyPackMut(s, cfg, "1"), /scrip/);
  s.players["1"].scrip = 1000;
  const pulls = buyPackMut(s, cfg, "1");
  assert.equal(pulls.length, cfg.packs.size);
  assert.equal(s.players["1"].binder!.length, cfg.raids.starterCards + 5);
  assert.equal(s.players["1"].scrip, 900);

  const t = newGame(cfg, 7);
  t.players["1"].scrip = 1000;
  assert.deepEqual(buyPackMut(t, cfg, "1"), pulls, "the rip is seeded");

  s.players["1"].binder = Array(cfg.raids.collectionCap - 2).fill({ def: "m01" });
  assert.throws(() => buyPackMut(s, cfg, "1"), /binder/);
});

test("raid nights replay identically from the same seed", () => {
  const run = () => {
    const cfg = raidConfig();
    let s = armed(cfg, Array(8).fill("m06"), Array(8).fill("t07"));
    s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
    s = tick(s, cfg, []);
    return JSON.stringify({ h: s.hexes, p: s.players, r: s.lastReport!.raids });
  };
  assert.equal(run(), run());
});
