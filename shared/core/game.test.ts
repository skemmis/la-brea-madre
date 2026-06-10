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

test("setExploit is a free stance and degrades the hex on tick", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = tick(s, cfg, []);
  // Toggling exploit does not consume the daily action...
  s = applyAction(s, cfg, "1", { type: "setExploit", h3: CENTER, on: true });
  assert.equal(s.hexes[CENTER].exploited, true);
  // ...and we can still take a daily action this tick.
  const next = RING.find((h) => h !== CENTER)!;
  assert.doesNotThrow(() => applyAction(s, cfg, "1", { type: "expand", h3: next }));
  // Exploiting accrues degradation on the next tick.
  s = tick(s, cfg, []);
  assert.equal(s.hexes[CENTER].degradation, cfg.yield.exploitDegradePerTick);
});

test("the same seed + actions produce identical state (determinism)", () => {
  const run = () => {
    let s = newGame(cfg, 999);
    s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
    return tick(s, cfg, [{ h3: CENTER, kind: "citation", magnitude: 1 }]);
  };
  assert.deepEqual(run(), run());
});

test("relics modify yield (Wildcatter's Nerve adds +1 per held hex)", () => {
  const c2 = defaultConfig(board, ["1"]);
  const baseRun = () => {
    let s = newGame(c2, 7);
    s = applyAction(s, c2, "1", { type: "expand", h3: CENTER });
    return tick(s, c2, []).lastReport!.perPlayer["1"].gained;
  };
  const relicRun = () => {
    let s = newGame(c2, 7);
    s.players["1"].relics = ["wildcatter"];
    s = applyAction(s, c2, "1", { type: "expand", h3: CENTER });
    return tick(s, c2, []).lastReport!.perPlayer["1"].gained;
  };
  assert.equal(relicRun(), baseRun() + 1);
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
  // $730 of tickets + 2 wells × $5 flavor = $740, no dice.
  assert.equal(s.players["1"].crude, before + 740);
  assert.equal(s.lastReport!.perPlayer["1"].gained, 740);
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

test("a sealed-bid contest: higher purse takes the hex, loser gets half back", () => {
  const cfg2 = defaultConfig(board, ["1", "2"]);
  let s = newGame(cfg2, 7);
  s = applyAction(s, cfg2, "1", { type: "expand", h3: CENTER });
  const enemyHex = RING.find((h) => h !== CENTER)!;
  s = applyAction(s, cfg2, "2", { type: "expand", h3: enemyHex });

  // Player 1 declares war with $200; player 2 commits $120 in defense.
  const cash1 = s.players["1"].crude;
  const cash2 = s.players["2"].crude;
  s = applyAction(s, cfg2, "1", { type: "contest", h3: enemyHex, bid: 200 });
  assert.equal(s.players["1"].crude, cash1 - 200);
  s = applyAction(s, cfg2, "2", { type: "defend", h3: enemyHex, bid: 120 });

  s = tick(s, cfg2, []);
  assert.equal(s.hexes[enemyHex].ownerId, "1", "attacker takes the hex");
  assert.equal(s.players["2"].crude, cash2 - 120 + 60, "defender recovers half");
  assert.equal(s.lastReport!.contests[0].winnerId, "1");
  assert.deepEqual(s.contests, {}, "the war is over");
});

test("the defender wins ties and the attacker forfeits half the chest", () => {
  const cfg2 = defaultConfig(board, ["1", "2"]);
  let s = newGame(cfg2, 7);
  s = applyAction(s, cfg2, "1", { type: "expand", h3: CENTER });
  const enemyHex = RING.find((h) => h !== CENTER)!;
  s = applyAction(s, cfg2, "2", { type: "expand", h3: enemyHex });
  const cash1 = s.players["1"].crude;
  s = applyAction(s, cfg2, "1", { type: "contest", h3: enemyHex, bid: 150 });
  s = applyAction(s, cfg2, "2", { type: "defend", h3: enemyHex, bid: 150 });
  s = tick(s, cfg2, []);
  assert.equal(s.hexes[enemyHex].ownerId, "2", "defender holds on a tie");
  const yielded = s.lastReport!.perPlayer["1"].gained; // CENTER's well money
  assert.equal(s.players["1"].crude, cash1 - 150 + 75 + yielded);
});

test("an undefended hex falls to any legal bid", () => {
  const cfg2 = defaultConfig(board, ["1", "2"]);
  let s = newGame(cfg2, 7);
  s = applyAction(s, cfg2, "1", { type: "expand", h3: CENTER });
  const enemyHex = RING.find((h) => h !== CENTER)!;
  s = applyAction(s, cfg2, "2", { type: "expand", h3: enemyHex });
  s = applyAction(s, cfg2, "1", { type: "contest", h3: enemyHex, bid: cfg2.combat.minBid });
  s = tick(s, cfg2, []);
  assert.equal(s.hexes[enemyHex].ownerId, "1");
});

test("quake events deposit degradation, doubled when exploited", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = tick(s, cfg, [{ h3: CENTER, kind: "quake", magnitude: 10 }]);
  assert.equal(s.hexes[CENTER].degradation, 10);

  s = applyAction(s, cfg, "1", { type: "setExploit", h3: CENTER, on: true });
  s = tick(s, cfg, [{ h3: CENTER, kind: "quake", magnitude: 10 }]);
  // +20 (doubled) +20 exploit-degrade from the stance itself
  assert.equal(s.hexes[CENTER].degradation, 50);
});

test("repair clears degradation for an order plus $ per point", () => {
  let s = start();
  s = applyAction(s, cfg, "1", { type: "expand", h3: CENTER });
  s = tick(s, cfg, [{ h3: CENTER, kind: "quake", magnitude: 30 }, { h3: CENTER, kind: "deadAnimal", magnitude: 1 }]);
  const cash = s.players["1"].crude;
  const orders = s.players["1"].workOrders;
  s = applyAction(s, cfg, "1", { type: "repair", h3: CENTER });
  assert.equal(s.hexes[CENTER].degradation, 0);
  assert.equal(s.players["1"].crude, cash - 30 * cfg.quake.repairPerPoint);
  assert.equal(s.players["1"].workOrders, orders - 1);
});
