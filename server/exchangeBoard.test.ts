/**
 * The rotating board generator is pure: same day → same slate, with the
 * staples always present and the rotation drawing from the catalog.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { boardSpecsFor, MAKE_LABELS } from "./exchangeBoard";

test("a day's board is deterministic and well-formed", () => {
  const a = boardSpecsFor("2026-06-10");
  const b = boardSpecsFor("2026-06-10");
  assert.deepEqual(
    a.map((s) => s.specId),
    b.map((s) => s.specId)
  );

  assert.ok(a.length >= 12, "a full slate");
  const ids = new Set(a.map((s) => s.specId));
  assert.equal(ids.size, a.length, "unique spec ids");

  // Staples present every day.
  for (const staple of ["citations", "fines", "dead_animals", "viol_SWEEP", "weekday"]) {
    assert.ok(ids.has(staple), `${staple} on the board`);
  }

  // Face-offs carry both legs and labels.
  for (const s of a.filter((x) => x.kind === "faceoff")) {
    assert.ok(s.metricB && s.labelA && s.labelB);
  }

  // Questions render with a line plugged in.
  for (const s of a) {
    assert.ok(s.question(1234).length > 10);
    assert.ok(s.rules.length > 10);
  }
});

test("the rotation actually rotates across days", () => {
  const days = ["2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"];
  const slates = days.map((d) => boardSpecsFor(d).map((s) => s.specId).join("|"));
  assert.ok(new Set(slates).size > 1, "different days draw different slates");
});

test("make props avoid the day's face-off makes", () => {
  for (const day of ["2026-06-10", "2026-07-01", "2026-08-15"]) {
    const specs = boardSpecsFor(day);
    const faceoffMakes = new Set(
      specs
        .filter((s) => s.kind === "faceoff" && s.specId.startsWith("mfo_"))
        .flatMap((s) => [s.metricA, s.metricB!])
    );
    for (const prop of specs.filter((s) => s.specId.startsWith("mou_"))) {
      assert.ok(!faceoffMakes.has(prop.metricA), `${prop.metricA} not doubled on ${day}`);
      assert.ok(MAKE_LABELS[prop.metricA.replace("make:", "")]);
    }
  }
});
