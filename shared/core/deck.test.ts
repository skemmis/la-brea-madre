/**
 * Tests for the deck-building core: packs, card effects, and how cards bend
 * market payouts. Pure — no DB, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  newGame,
  defaultConfig,
  openPack,
  cardEffects,
  CARDS,
  openMarket,
  buyContracts,
  resolveMarket,
  type GameConfig,
} from "./index";

const cfg: GameConfig = defaultConfig({}, ["1"]);
const market = { id: "m", question: "q", outcomes: ["YES", "NO"], baseRates: [0.5, 0.5] };

function richGame(seed: number, crude = 100000) {
  const s = newGame(cfg, seed);
  s.players["1"].crude = crude;
  return s;
}

test("openPack deducts its cost and adds distinct new cards", () => {
  const { state, drawn, refund } = openPack(richGame(42, 1000), cfg, "1");
  assert.equal(drawn.length, cfg.pack.size);
  assert.equal(new Set(drawn.map((d) => d.id)).size, drawn.length, "distinct within a pack");
  assert.equal(refund, 0, "first pack has no duplicates");
  assert.equal(state.players["1"].crude, 1000 - cfg.pack.cost);
  assert.equal(state.players["1"].cards.length, cfg.pack.size);
});

test("openPack is deterministic for a given state", () => {
  const a = openPack(richGame(7, 1000), cfg, "1");
  const b = openPack(richGame(7, 1000), cfg, "1");
  assert.deepEqual(a.drawn, b.drawn);
});

test("openPack throws without enough crude", () => {
  const s = newGame(cfg, 1);
  s.players["1"].crude = 0;
  assert.throws(() => openPack(s, cfg, "1"));
});

test("duplicates come back as a refund and never overflow the catalog", () => {
  let s = richGame(3);
  let sawDup = false;
  for (let i = 0; i < 50 && !sawDup; i++) {
    const r = openPack(s, cfg, "1");
    s = r.state;
    if (r.drawn.some((d) => !d.isNew)) {
      sawDup = true;
      assert.ok(r.refund > 0, "a duplicate should refund crude");
    }
  }
  assert.ok(sawDup, "should eventually draw a duplicate once the catalog fills");
  assert.ok(s.players["1"].cards.length <= Object.keys(CARDS).length);
});

test("cardEffects multiply payouts and take the best refund", () => {
  const fx = cardEffects(["wildcatters_nerve", "sex_magick", "tar_insurance", "la_brea_pact", "tar_insurance"]);
  assert.ok(Math.abs(fx.payoutMult - 1.15 * 2) < 1e-9);
  assert.equal(fx.loserRefund, 0.75); // max, not sum
});

function settle(cards: string[], winning: number) {
  let s = openMarket(newGame(cfg, 1), cfg, market);
  s.players["1"].cards = cards;
  const before = s.players["1"].crude;
  s = buyContracts(s, cfg, "1", "m", 0, 10); // bet YES
  const spent = before - s.players["1"].crude;
  s = resolveMarket(s, cfg, "m", winning);
  return { entry: s.lastSettlement!.perPlayer["1"], spent };
}

test("Sex Magick doubles the winning payout", () => {
  const base = settle([], 0).entry.payout;
  const doubled = settle(["sex_magick"], 0).entry.payout;
  assert.ok(Math.abs(doubled - base * 2) < 1e-9, `${doubled} ≈ 2×${base}`);
});

test("Tar Insurance refunds part of a losing bet", () => {
  const { entry, spent } = settle(["tar_insurance"], 1); // NO wins → YES bet loses
  assert.ok(Math.abs(entry.payout - spent * 0.4) < 1e-6, `refund ${entry.payout} ≈ 0.4×${spent}`);
});
