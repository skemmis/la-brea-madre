/**
 * Tests for the LMSR prediction-market core. Pure math — no DB, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  newGame,
  defaultConfig,
  openMarket,
  buyContracts,
  resolveMarket,
  marketPrices,
  quoteCost,
  sharesForBudget,
  openMarkets,
  type GameConfig,
} from "./index";

const cfg: GameConfig = defaultConfig({}, ["1", "2"]);
const SPEC = {
  id: "toyota-vs-honda",
  question: "More Toyotas than Hondas ticketed?",
  outcomes: ["YES", "NO"],
  baseRates: [0.6, 0.4],
};

function game() {
  return openMarket(newGame(cfg, 1), cfg, SPEC);
}

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("opening prices equal the seeded base rates", () => {
  const s = game();
  const [yes, no] = marketPrices(s.markets[SPEC.id]);
  approx(yes, 0.6, 1e-4);
  approx(no, 0.4, 1e-4);
});

test("buying YES raises the YES price and costs crude", () => {
  let s = game();
  const before = marketPrices(s.markets[SPEC.id])[0];
  const startCrude = s.players["1"].crude;
  const cost = quoteCost(s.markets[SPEC.id], 0, 10);
  s = buyContracts(s, cfg, "1", SPEC.id, 0, 10);
  const after = marketPrices(s.markets[SPEC.id])[0];
  assert.ok(after > before, "YES price should rise after buying YES");
  approx(s.players["1"].crude, startCrude - cost);
  assert.deepEqual(s.markets[SPEC.id].holdings["1"], [10, 0]);
});

test("a share never costs more than its max payout (bounded)", () => {
  const s = game();
  const shares = 25;
  const cost = quoteCost(s.markets[SPEC.id], 0, shares);
  assert.ok(cost > 0 && cost < shares * cfg.market.payoutPerShare, `0 < ${cost} < ${shares}`);
});

test("sharesForBudget is the inverse of quoteCost", () => {
  const s = game();
  const budget = 12;
  const shares = sharesForBudget(s.markets[SPEC.id], 0, budget);
  approx(quoteCost(s.markets[SPEC.id], 0, shares), budget, 1e-4);
});

test("resolving pays winning shares 1 crude each and reports profit", () => {
  let s = game();
  const start = s.players["1"].crude;
  const spent = quoteCost(s.markets[SPEC.id], 0, 10);
  s = buyContracts(s, cfg, "1", SPEC.id, 0, 10); // 10 YES
  s = resolveMarket(s, cfg, SPEC.id, 0); // YES wins

  approx(s.players["1"].crude, start - spent + 10); // paid out 10
  assert.equal(s.markets[SPEC.id].status, "resolved");
  const entry = s.lastSettlement!.perPlayer["1"];
  assert.equal(entry.shares, 10);
  assert.equal(entry.payout, 10);
  approx(entry.profit, 10 - spent);
});

test("a wrong bet pays nothing", () => {
  let s = game();
  const start = s.players["1"].crude;
  s = buyContracts(s, cfg, "1", SPEC.id, 0, 10); // 10 YES
  s = resolveMarket(s, cfg, SPEC.id, 1); // NO wins
  assert.ok(s.players["1"].crude < start, "should have lost the stake");
  assert.equal(s.lastSettlement!.perPlayer["1"].payout, 0);
});

test("buying is rejected when the player can't afford it", () => {
  let s = game();
  s.players["1"].crude = 1;
  assert.throws(() => buyContracts(s, cfg, "1", SPEC.id, 0, 1000));
});

test("closed markets reject further trades and resolution", () => {
  let s = game();
  s = resolveMarket(s, cfg, SPEC.id, 0);
  assert.throws(() => buyContracts(s, cfg, "1", SPEC.id, 0, 1));
  assert.throws(() => resolveMarket(s, cfg, SPEC.id, 1));
  assert.equal(openMarkets(s).length, 0);
});

test("the maker stays solvent across lopsided trading (bounded loss)", () => {
  let s = game();
  const m0 = s.markets[SPEC.id];
  // Everyone piles into YES; the maker's payout liability vs. crude taken in
  // must never exceed the LMSR bound b·ln(n).
  let taken = 0;
  for (let i = 0; i < 50; i++) {
    s.players["1"].crude = 1e9; // ignore affordability for the stress test
    const c = quoteCost(s.markets[SPEC.id], 0, 5);
    taken += c;
    s = buyContracts(s, cfg, "1", SPEC.id, 0, 5);
  }
  const liability = s.markets[SPEC.id].holdings["1"][0] * cfg.market.payoutPerShare;
  const makerLoss = liability - taken;
  const bound = m0.b * Math.log(m0.outcomes.length);
  assert.ok(makerLoss <= bound + 1e-6, `maker loss ${makerLoss} ≤ bound ${bound}`);
});
