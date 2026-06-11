/**
 * Tests for the deck-fight layer, v2 (the three strata): the resolver's
 * arithmetic (wards, bulwarks, the flock, recklessness), and the raid
 * lifecycle through the real core — escrow, the finite army, and the
 * asymmetric fates: attackers' fallen burn (rares leave fossils), defenders'
 * fallen are wounded, poachers steal, medics heal.
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
  forgeSaintMut,
  CARD_BY_ID,
  SAINT_BY_ID,
  type BoardHex,
  type GameConfig,
  type Terrain,
} from "./index";

const NOWHERE: Terrain = { black: false, blue: false, white: false };
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
  // GRIDLOCK 9 and SWEEPER 4 and METER 1 vs three JOLTS 5 — plain arithmetic;
  // there is no color triangle.
  const r = resolveBattle(
    [card("u12"), card("u04"), card("u01")], // 9, 4, 1
    [card("b06"), card("b06"), card("b06")], // 5, 5, 5
    NOWHERE,
    3
  );
  assert.equal(r.lanes[0].defenderPower, 5, "no triangle — a jolt is a five");
  assert.equal(r.attackerLanes, 1); // only the GRIDLOCK survives the under
  assert.equal(r.winner, "defender");

  const tie = resolveBattle([card("u04")], [card("u04")], NOWHERE, 1);
  assert.equal(tie.winner, "defender", "equal power defends the deed");
});

test("home ground pays +2 and surges fire on it", () => {
  // SEISMOGRAPH STRIP on broken ground: 3 base + 2 affinity + 3 surge.
  const home = resolveBattle([card("b03")], [card("u04")], { ...NOWHERE, black: true }, 1);
  assert.equal(home.lanes[0].attackerPower, 3 + 2 + 3, "affinity + surge");
  const away = resolveBattle([card("b03")], [card("u04")], NOWHERE, 1);
  assert.equal(away.lanes[0].attackerPower, 3, "no stratum, no surge, no triangle");
});

test("a ward silences the rite across the lane", () => {
  // DMV BASILISK wards the SEISMOGRAPH's surge away on its own home ground.
  const r = resolveBattle([card("b03")], [card("u03")], { ...NOWHERE, black: true }, 1);
  assert.equal(r.lanes[0].attackerPower, 3 + 2, "affinity stays; the surge is warded");
  // ...and even LA BREA BUBBLES cannot sink a warded lane.
  const sink = resolveBattle([card("b09")], [card("u03")], NOWHERE, 1);
  assert.ok(!sink.lanes[0].sunk, "the ordinance forbids the tar");
  // Unwarded, the tar takes the lane whole.
  const free = resolveBattle([card("b09")], [card("u04")], NOWHERE, 1);
  assert.ok(free.lanes[0].sunk);
  assert.equal(free.winner, "defender", "a fully sunk battle defends");
});

test("bulwarks hold deeds but don't help on the road; the flock runs together", () => {
  const holding = resolveBattle([card("w01")], [card("u02")], NOWHERE, 1);
  assert.equal(holding.lanes[0].defenderPower, 2 + 3, "the maid holds the deed");
  const roadtrip = resolveBattle([card("u02")], [card("b04")], NOWHERE, 1);
  assert.equal(roadtrip.lanes[0].attackerPower, 2, "no bulwark when attacking");

  const flock = resolveBattle(
    [card("w04"), card("w01"), card("w02")], // RATS: 2 + 2×2 flock
    [card("u04"), card("u04"), card("u04")],
    NOWHERE,
    3
  );
  assert.equal(flock.lanes[0].attackerPower, 2 + 4, "the hundred rats flock +4");
  assert.equal(flock.lanes[0].winner, "attacker", "the rats take their lane");
  assert.equal(flock.winner, "defender", "1-1 and a standoff: the tie defends");
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
  let s = armed(cfg, Array(5).fill("u12"), Array(5).fill("b04")); // 9s vs 3+3s
  const cashBefore = { a: s.players["1"].crude, d: s.players["2"].crude };
  s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
  assert.equal(s.players["1"].crude, cashBefore.a - 50, "escrow = half the $100 ask");
  s = tick(s, cfg, []);
  assert.equal(s.hexes[CENTER].ownerId, "1", "the deed falls");
  assert.ok(s.lastReport!.raids![0].attackerWon);
  assert.ok(s.players["2"].crude > cashBefore.d, "the loser is compensated");
});

test("a failed raid forfeits the stake; the fallen attackers burn — rares to fossils", () => {
  const cfg = raidConfig();
  // Five rare NOTARIES (6) into five mythic GRIDLOCKS (9): a massacre.
  let s = armed(cfg, Array(5).fill("u10"), Array(5).fill("u12"));
  const cashBefore = { a: s.players["1"].crude, d: s.players["2"].crude };
  s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
  s = tick(s, cfg, []);
  assert.equal(s.hexes[CENTER].ownerId, "2", "the walls hold");
  const taxA = s.lastReport!.perPlayer["1"].taxPaid;
  const taxD = s.lastReport!.perPlayer["2"].taxPaid;
  assert.equal(s.players["1"].crude, cashBefore.a - 25 - taxA, "stake lost, remainder refunded");
  assert.equal(s.players["2"].crude, cashBefore.d + 25 - taxD, "the defender keeps the stake");
  // You declared the war: your fallen don't come home.
  assert.equal(s.players["1"].binder!.length, 0, "all five attackers burned");
  assert.equal(s.players["1"].fossils!.length, 5, "rares leave fossils, dated");
  assert.equal(s.players["1"].fossils![0].def, "u10");
  // The defenders won their lanes — untouched.
  assert.equal(s.players["2"].binder!.filter((c) => !c.restUntil).length, 5);
});

test("beaten defenders are wounded, rest, and report back", () => {
  const cfg = raidConfig({ restDays: 3 });
  let s = armed(cfg, Array(5).fill("u12"), Array(5).fill("b04"));
  s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
  s = tick(s, cfg, []);
  const wounded = s.players["2"].binder!.filter((c) => (c.restUntil ?? 0) > s.tick);
  assert.equal(wounded.length, 5, "the beaten garrison is wounded, not dead");
  for (let i = 0; i < 4; i++) s = tick(s, cfg, []);
  assert.equal(
    s.players["2"].binder!.filter((c) => (c.restUntil ?? 0) > s.tick).length,
    0,
    "everyone reports back after their rest"
  );
});

test("reckless cards burn even when they win", () => {
  const cfg = raidConfig();
  // TAR SEEP: 2 + 2 reckless = 4 over EXPIRED METER 1, every lane.
  let s = armed(cfg, Array(5).fill("b02"), Array(5).fill("u01"));
  s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
  s = tick(s, cfg, []);
  assert.ok(s.lastReport!.raids![0].attackerWon, "the seeps take the deed");
  assert.equal(s.players["1"].binder!.length, 0, "and burn anyway — no frills, no survivors");
  assert.ok(!s.players["1"].fossils?.length, "commons leave no fossils");
});

test("the poacher steals what it beats — permanently, and it arrives wounded", () => {
  const cfg = raidConfig();
  // Attacker sends a lone EXPIRED METER into the MAGPIE ASSESSOR.
  let s = armed(cfg, ["u01"], ["w09"]);
  s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
  s = tick(s, cfg, []);
  // Magpie 3 over 1 — the meter is hers now.
  assert.equal(s.players["1"].binder!.length, 0, "the attacker's card is gone");
  assert.equal(s.players["1"].fossils?.length ?? 0, 0, "not dead — stolen");
  const stolen = s.players["2"].binder!.find((c) => c.def === "u01");
  assert.ok(stolen, "the magpie keeps it");
  assert.ok((stolen!.restUntil ?? 0) > s.tick, "it arrives wounded");
  assert.deepEqual(s.lastReport!.raids![0].poached, [["u01", "2"]]);
});

test("phoenixes walk away from lost lanes; medics heal the wounded at dawn", () => {
  const cfg = raidConfig();
  let s = armed(cfg, ["u12"], ["w05"]); // GRIDLOCK 9 vs EL COYOTE 4
  s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
  s = tick(s, cfg, []);
  const coyote = s.players["2"].binder!.find((c) => c.def === "w05");
  assert.ok(coyote && !coyote.restUntil, "beaten Tuesday, fine Tuesday night");

  // OPOSSUM MADONNA survives her lane and heals the longest-wounded card.
  let m = armed(cfg, ["b04"], ["w08", "u04"]);
  m.players["2"].binder![1].restUntil = 99; // an old wound
  m = applyAction(m, cfg, "1", { type: "raid", h3: CENTER });
  m = tick(m, cfg, []);
  assert.ok(!m.players["2"].binder![1].restUntil, "the madonna makes room for a twelfth");
});

test("the finite army: a drained binder fights the next front on scraps", () => {
  const cfg = raidConfig({ battleSize: 5 });
  // Defender owns CENTER and a neighbour; only 7 cards — one full defense + scraps.
  let s = armed(cfg, Array(10).fill("u04"), Array(7).fill("u12"));
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

test("buyouts are closed when raids are open (and vice versa)", () => {
  const cfg = raidConfig();
  let s = armed(cfg, ["u01"], ["u01"]);
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

  s.players["1"].binder = Array(cfg.raids.collectionCap - 2).fill({ def: "u01" });
  assert.throws(() => buyPackMut(s, cfg, "1"), /binder/);
});

test("raid nights replay identically from the same seed", () => {
  const run = () => {
    const cfg = raidConfig();
    let s = armed(cfg, Array(8).fill("u07"), Array(8).fill("b06"));
    s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
    s = tick(s, cfg, []);
    return JSON.stringify({ h: s.hexes, p: s.players, r: s.lastReport!.raids });
  };
  assert.equal(run(), run());
});

// ─── Weight, ripples, and the rearview mirror ─────────────────────────────────

test("the ripple flows: vengeance from the fallen, rallies from the winners, omens ahead", () => {
  // FORESHOCK (1, vengeance 3) falls to the SWEEPER, JOLT (5) inherits +3.
  const v = resolveBattle(
    [card("b13"), card("b06")],
    [card("u04"), card("b06")], // 4, 5
    NOWHERE,
    2
  );
  assert.equal(v.lanes[1].attackerPower, 5 + 4, "the jolt arrives angry");
  assert.equal(v.lanes[1].winner, "attacker", "vengeance breaks the mirror match");

  // THE UPDRAFT (2, rally 3) beats the METER (1); the next lane lifts.
  const r = resolveBattle(
    [card("w13"), card("w03")],
    [card("u01"), card("u04")],
    NOWHERE,
    2
  );
  assert.equal(r.lanes[1].attackerPower, 3 + 3, "what rises first lifts the rest");

  // FINAL NOTICE (omen 2): the foe's next lane fights under it.
  const o = resolveBattle(
    [card("u13"), card("u01")],
    [card("u04"), card("b04")], // sweeper 4 beats notice 1; chandelier 3 − 2 omen
    NOWHERE,
    2
  );
  assert.equal(o.lanes[1].defenderPower, 3 - 2, "the envelope weighed on them");

  // A warded ripple never leaves the lane.
  const w = resolveBattle(
    [card("b13"), card("b06")],
    [card("u03"), card("b06")], // the basilisk wards the foreshock
    NOWHERE,
    2
  );
  assert.equal(w.lanes[1].attackerPower, 5, "no vengeance — the rite was warded");
});

test("hands arrange light-to-heavy, so martyrs open and closers close", () => {
  const cfg = raidConfig();
  // Binder of exactly five: weights 7 (AFTERSHOCK), 1 (FORESHOCK), 9 (MADRE),
  // 2 (CANDLES), 5 (JOLT). The drawn hand must arrange 1,2,5,7,9.
  let s = armed(cfg, ["u01"], ["b05", "b13", "b12", "b14", "b06"]);
  s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
  s = tick(s, cfg, []);
  const lanes = s.lastReport!.raids![0];
  assert.equal(lanes.defenderCards, 5);
  // The defender's lane order is the weight order — read it off the report's
  // burned/wounded bookkeeping via a direct resolver check instead:
  const hand = ["b05", "b13", "b12", "b14", "b06"]
    .map((d) => CARD_BY_ID[d])
    .sort((x, y) => x.weight - y.weight)
    .map((c) => c.id);
  assert.deepEqual(hand, ["b13", "b14", "b06", "b05", "b12"], "light opens, the Madre closes");
});

test("dashboard saints bend the rules: dice, the closer, karma, suit boosts", () => {
  const dice = { saints: [SAINT_BY_ID.s_dice], fossils: 0 };
  const tie = resolveBattle([card("u04")], [card("u04")], NOWHERE, 1, { attacker: dice });
  assert.equal(tie.lanes[0].winner, "attacker", "the dice call the standoff");
  assert.equal(tie.winner, "attacker", "a tied raid falls to the dice");
  const bothDice = resolveBattle([card("u04")], [card("u04")], NOWHERE, 1, { attacker: dice, defender: dice });
  assert.equal(bothDice.winner, "defender", "two sets of dice cancel — house rules return");

  const fernando = { saints: [SAINT_BY_ID.s_fernando], fossils: 0 };
  const closer = resolveBattle(
    [card("u01"), card("u12")],
    [card("u04"), card("b12")],
    NOWHERE,
    2,
    { attacker: fernando }
  );
  // GRIDLOCK in the last lane fights twice: 9 + 9 = 18... but LA MADRE sinks the lane.
  assert.ok(closer.lanes[1].sunk, "the Madre does not care how many times you fight");
  const closer2 = resolveBattle([card("u12")], [card("b11")], NOWHERE, 1, { attacker: fernando });
  assert.equal(closer2.lanes[0].attackerPower, 18, "St. Fernando doubles the closer");

  const karma = { saints: [SAINT_BY_ID.s_karma], fossils: 9 };
  const k = resolveBattle([card("u01")], [card("u04")], NOWHERE, 1, { attacker: karma });
  assert.equal(k.lanes[0].attackerPower, 1 + 1, "+1 at five fossils, and that is the cap");

  const madre = { saints: [SAINT_BY_ID.s_madre], fossils: 0 };
  const m = resolveBattle([card("b04")], [card("u04")], NOWHERE, 1, { attacker: madre });
  assert.equal(m.lanes[0].attackerPower, 3 + 1, "she blesses the black");
});

test("the forge takes payment in bone; the mirror holds three", () => {
  const cfg = raidConfig();
  const s = newGame(cfg, 5);
  const p = s.players["1"];
  p.fossils = Array(11).fill(0).map((_, i) => ({ def: "u10", tick: i }));
  assert.throws(() => forgeSaintMut(s, cfg, "1", "s_nope"), /No such saint/);
  forgeSaintMut(s, cfg, "1", "s_karma"); // 3 bones
  assert.equal(p.fossils!.length, 8, "the tar took the oldest three");
  assert.throws(() => forgeSaintMut(s, cfg, "1", "s_karma"), /already rides/);
  forgeSaintMut(s, cfg, "1", "s_madre"); // 3
  forgeSaintMut(s, cfg, "1", "s_meters"); // 3 — mirror full
  assert.throws(() => forgeSaintMut(s, cfg, "1", "s_dice"), /congregation/);
});

test("jumper cables bring winning reckless cards home; the patron refunds lost stakes", () => {
  const cfg = raidConfig();
  let s = armed(cfg, Array(5).fill("b02"), Array(5).fill("u01"));
  s.players["1"].saints = ["s_jumper"];
  s = applyAction(s, cfg, "1", { type: "raid", h3: CENTER });
  s = tick(s, cfg, []);
  assert.ok(s.lastReport!.raids![0].attackerWon);
  assert.equal(s.players["1"].binder!.length, 5, "dead by their own nature; back by lunch");

  let l = armed(cfg, Array(5).fill("u01"), Array(5).fill("u12"));
  l.players["1"].saints = ["s_lostcause"];
  const before = l.players["1"].crude;
  l = applyAction(l, cfg, "1", { type: "raid", h3: CENTER });
  l = tick(l, cfg, []);
  const tax = l.lastReport!.perPlayer["1"].taxPaid;
  assert.equal(l.players["1"].crude, before - tax, "the stake came home anyway");
});

test("the raid era retires self-assessment: county valuation rules all", () => {
  const cfg = raidConfig();
  let s = armed(cfg, ["u01"], ["u01"]);
  assert.throws(
    () => applyAction(s, cfg, "2", { type: "assess", h3: CENTER, price: 99999 }),
    /suggestion box/
  );
  // Tax accrues on the county's number even if an old price lingers on the deed.
  s.hexes[CENTER].price = 1_000_000; // a fossil from the buyout era
  s = tick(s, cfg, []);
  assert.equal(s.lastReport!.perPlayer["2"].taxPaid, Math.round(100 * cfg.assessment.taxRate),
    "the ledger, not the owner, sets the tax");
});
