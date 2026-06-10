/**
 * Smoke test for the testing grounds: a month of bot play on the synthetic
 * town, through the production core, with every invariant checked. If a rule
 * can be bent by ordinary (or random) play, this is where it screams in CI.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { newGame, applyAction, tick, defaultConfig, type GameState } from "../shared/core";
import { syntheticWorld, sampleEvents, sampleQuakes, makeRng } from "./world";
import { PERSONAS } from "./bots";

test("30 bot-days on the synthetic town hold every invariant", () => {
  const world = syntheticWorld(6, 42);
  const bots = Object.values(PERSONAS).map((make) => make());
  const ids = bots.map((_, i) => String(i + 1));
  const config = defaultConfig(world.board, ids);
  const rng = makeRng(99);
  let state: GameState = newGame(config, 42);

  for (let day = 0; day < 30; day++) {
    for (let i = 0; i < bots.length; i++) {
      for (let step = 0; step < 6; step++) {
        const a = bots[i].nextAction({ state, config, me: ids[i], world, rng });
        if (!a) break;
        try {
          state = applyAction(state, config, ids[i], a);
        } catch {
          break;
        }
      }
    }
    const owned = Object.keys(state.hexes).filter((h) => state.hexes[h].ownerId);
    state = tick(state, config, sampleEvents(world, owned, day, rng, sampleQuakes(rng)), {
      weeklyFree: day % 7 === 1,
    });

    for (const p of Object.values(state.players)) {
      assert.ok(Number.isFinite(p.crude) && p.crude >= -1e-6, "cash stays real");
      assert.ok(p.workOrders >= -1e-6 && p.workOrders <= config.workOrders.cap + 1e-6, "orders in range");
    }
    for (const hx of Object.values(state.hexes)) {
      assert.ok(hx.degradation >= 0 && hx.degradation <= 100, "degradation in range");
      if (hx.ownerId) assert.ok((hx.price ?? 0) >= 0, "assessments stay sane");
    }
  }

  // The town saw real play.
  const claimed = Object.values(state.hexes).filter((h) => h.ownerId).length;
  assert.ok(claimed > 10, `bots actually played (${claimed} parcels claimed)`);
});

test("the same seed replays to the identical world (determinism)", () => {
  const run = () => {
    const world = syntheticWorld(5, 7);
    const bots = [PERSONAS.rentier(), PERSONAS.sprawler()];
    const ids = ["1", "2"];
    const config = defaultConfig(world.board, ids);
    const rng = makeRng(123);
    let state = newGame(config, 7);
    for (let day = 0; day < 10; day++) {
      for (let i = 0; i < bots.length; i++) {
        for (let step = 0; step < 4; step++) {
          const a = bots[i].nextAction({ state, config, me: ids[i], world, rng });
          if (!a) break;
          try {
            state = applyAction(state, config, ids[i], a);
          } catch {
            break;
          }
        }
      }
      const owned = Object.keys(state.hexes).filter((h) => state.hexes[h].ownerId);
      state = tick(state, config, sampleEvents(world, owned, day, rng, []), {});
    }
    return JSON.stringify({ p: state.players, h: state.hexes });
  };
  assert.equal(run(), run());
});
