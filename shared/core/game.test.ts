/**
 * Tests for the pure game core. No DB, no network — just the rulebook.
 * Run with: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { latLngToCell, gridDisk } from "h3-js";
import {
  newGame,
  addPlayer,
  applyAction,
  legalActions,
  tick,
  defaultConfig,
  repairCost,
  type BoardHex,
} from "./index";

// A small real board: a center hex (with 2 wells) and its 6 neighbours.
const CENTER = latLngToCell(34.05, -118.24, 7);
const RING = gridDisk(CENTER, 1); // 7 cells incl. center
const board: Record<string, BoardHex> = {};
for (const h of RING) board[h] = { wells: h === CENTER ? 2 : 0 };

const cfg = defaultConfig(board, ["1"]);
const start = () => newGame(cfg, 12345);

test("new player starts with the configured crude", () => {
  const s = start();
  assert.equal(s.players["1"].crude, cfg.startingCrude);
});

test("the first claim is free", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  assert.equal(s.players["1"].crude, cfg.startingCrude);
  assert.deepEqual(Object.keys(s.hexes), [CENTER]);
});

test("a tick yields crude from wells and reports a dispatch", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = tick(s, cfg, [{ h3: CENTER, kind: "citation", magnitude: 3 }]);
  assert.equal(s.tick, 1);
  assert.ok(s.players["1"].crude > cfg.startingCrude, "crude should grow");
  const mine = s.lastReport!.perPlayer["1"];
  assert.equal(mine.entries.length, 1);
  assert.equal(mine.entries[0].h3, CENTER);
});

test("expansion is limited to the adjacent frontier", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = tick(s, cfg, []); // free up the daily action
  const targets = legalActions(s, cfg, "1")
    .filter((a) => a.type === "expand")
    .map((a) => (a as any).h3)
    .sort();
  const expected = RING.filter((h) => h !== CENTER).sort();
  assert.deepEqual(targets, expected);
});

test("actions deplete Work Orders and stop at zero", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = tick(s, cfg, []);
  const next = RING.find((h) => h !== CENTER)!;
  s = applyAction(s, cfg, "1", { type: "expand", h3: next });
  const another = RING.find((h) => h !== CENTER && h !== next)!;
  assert.throws(() => applyAction(s, cfg, "1", { type: "expand", h3: another }));
});


test("the same seed + actions produce identical state (determinism)", () => {
  const run = () => {
    let s = newGame(cfg, 999);
    s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
    return tick(s, cfg, [{ h3: CENTER, kind: "citation", magnitude: 1 }]);
  };
  assert.deepEqual(run(), run());
});


test("addPlayer adds a newcomer and is a no-op if already present", () => {
  let s = newGame({ ...cfg, players: [] }, 1);
  assert.equal(Object.keys(s.players).length, 0);
  s = addPlayer(s, cfg, "42");
  assert.equal(s.players["42"].crude, cfg.startingCrude);
  const before = JSON.stringify(s);
  s = addPlayer(s, cfg, "42");
  assert.equal(JSON.stringify(s), before, "second add should change nothing");
});

test("fine events pay real dollars to the hex owner", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  const before = s.players["1"].crude;
  s = tick(s, cfg, [{ h3: CENTER, kind: "fine", magnitude: 730 }]);
  // $730 of tickets + 2 wells × $5 flavor = $740, minus the county's tax.
  const tax = s.lastReport!.perPlayer["1"].taxPaid;
  assert.equal(s.lastReport!.perPlayer["1"].gained, 740);
  assert.ok(tax >= 1, "the county always collects");
  assert.equal(s.players["1"].crude, before + 740 - tax);
});

test("carrion in your territory earns Work Orders, capped", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  const before = s.players["1"].workOrders;
  s = tick(s, cfg, [{ h3: CENTER, kind: "deadAnimal", magnitude: 3 }]);
  assert.equal(s.players["1"].workOrders, before + 3);
  s = tick(s, cfg, [{ h3: CENTER, kind: "deadAnimal", magnitude: 99 }]);
  assert.equal(s.players["1"].workOrders, cfg.workOrders.cap);
});

test("the weekly free order arrives when the shell says it's Monday", () => {
  let s = start();
  const before = s.players["1"].workOrders;
  s = tick(s, cfg, [], { weeklyFree: true });
  assert.equal(s.players["1"].workOrders, before + cfg.workOrders.weeklyFree);
});




test("quake events deposit degradation", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = tick(s, cfg, [{ h3: CENTER, kind: "quake", magnitude: 10 }]);
  assert.equal(s.hexes[CENTER].degradation, 10);
});

test("repair clears degradation for an order plus $ per point", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = tick(s, cfg, [{ h3: CENTER, kind: "quake", magnitude: 30 }, { h3: CENTER, kind: "deadAnimal", magnitude: 1 }]);
  const cash = s.players["1"].crude;
  const orders = s.players["1"].workOrders;
  const bill = repairCost(cfg, CENTER, 30);
  s = applyAction(s, cfg, "1", { type: "repair", h3: CENTER });
  assert.equal(s.hexes[CENTER].degradation, 0);
  assert.equal(s.players["1"].crude, cash - bill);
  assert.equal(s.players["1"].workOrders, orders - 1);
});

test("a buyout pays the owner their own asking price", () => {
  const cfg2 = defaultConfig(board, ["1", "2"]);
  let s = newGame(cfg2, 7);
  s = applyAction(s, cfg2, "1", { type: "expand", h3: CENTER });
  s = applyAction(s, cfg2, "1", { type: "assess", h3: CENTER, price: 400 });
  const buyerCash = s.players["2"].crude;
  const sellerCash = s.players["1"].crude;
  s = applyAction(s, cfg2, "2", { type: "buyout", h3: CENTER });
  assert.equal(s.hexes[CENTER].ownerId, "2", "the deed transfers");
  assert.equal(s.players["2"].crude, buyerCash - 400);
  assert.equal(s.players["1"].crude, sellerCash + 400, "the owner pockets their number");
});

test("the county taxes assessments daily", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = applyAction(s, cfg, "1", { type: "assess", h3: CENTER, price: 1000 });
  const cash = s.players["1"].crude;
  s = tick(s, cfg, []);
  const yielded = s.lastReport!.perPlayer["1"].gained;
  const tax = Math.round(1000 * cfg.assessment.taxRate);
  assert.equal(s.lastReport!.perPlayer["1"].taxPaid, tax);
  assert.equal(s.players["1"].crude, cash + yielded - tax);
});

test("underpriced bravado: a low assessment means cheap taxes but a cheap parcel", () => {
  const cfg2 = defaultConfig(board, ["1", "2"]);
  let s = newGame(cfg2, 7);
  s = applyAction(s, cfg2, "1", { type: "expand", h3: CENTER });
  s = applyAction(s, cfg2, "1", { type: "assess", h3: CENTER, price: cfg2.assessment.minPrice });
  s = applyAction(s, cfg2, "2", { type: "buyout", h3: CENTER });
  assert.equal(s.hexes[CENTER].ownerId, "2", "lowballers get sniped");
});

test("foreclosure: the county takes parcels when the tax can't be paid", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = applyAction(s, cfg, "1", { type: "assess", h3: CENTER, price: 100000 });
  s.players["1"].crude = 0; // broke, with a six-figure assessment
  s = tick(s, cfg, []);
  assert.equal(s.hexes[CENTER].ownerId, null, "the county takes it");
  assert.equal(s.lastReport!.foreclosures.length, 1);
});

test("repair bills scale with the land's value", () => {
  const rich: Record<string, BoardHex> = { ...board };
  const poorHex = RING.find((h) => h !== CENTER)!;
  rich[CENTER] = { wells: 0, fineRate: 5000 }; // prime meter land
  rich[poorHex] = { wells: 0, fineRate: 0 };
  const cfg2 = defaultConfig(rich, ["1"]);
  assert.ok(
    repairCost(cfg2, CENTER, 20) > repairCost(cfg2, poorHex, 20) * 50,
    "a wrecked prime corner costs real money; a hillside is a patch job"
  );
});

test("retrofit halves quake damage, permanently", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = tick(s, cfg, [{ h3: CENTER, kind: "deadAnimal", magnitude: 1 }]); // earn an order
  s = applyAction(s, cfg, "1", { type: "retrofit", h3: CENTER });
  assert.equal(s.hexes[CENTER].retrofitted, true);
  s = tick(s, cfg, [{ h3: CENTER, kind: "quake", magnitude: 20 }]);
  assert.equal(s.hexes[CENTER].degradation, 10, "the bolts held");
});

test("a dispatched crew boosts pay for a week, then goes home", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = applyAction(s, cfg, "1", { type: "crew", h3: CENTER });
  s = tick(s, cfg, [{ h3: CENTER, kind: "fine", magnitude: 1000 }]);
  // (1000 + 2 wells × $5) × 1.5 crew = 1515, before the county's tax.
  assert.equal(s.lastReport!.perPlayer["1"].gained, 1515);
  // Fast-forward past the crew's stay.
  for (let i = 0; i < cfg.works.crewDays; i++) s = tick(s, cfg, []);
  s = tick(s, cfg, [{ h3: CENTER, kind: "fine", magnitude: 1000 }]);
  assert.equal(s.lastReport!.perPlayer["1"].gained, 1010, "the crew went home");
});
