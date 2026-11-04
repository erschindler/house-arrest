import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceInjury,
  applyWound,
  bloodFraction,
  createInjuryState,
  isDying,
  treat,
} from "../src/sim/injury.ts";

test("a severe wound drains blood and eventually kills", () => {
  const state = createInjuryState();
  applyWound(state, "blade", "torso", 0.9, 0);

  const progress = advanceInjury(state, 2400, 2400);
  assert.equal(progress.died, true);
  assert.equal(state.alive, false);
  assert.equal(state.causeOfDeath, "exsanguination");
  assert.equal(state.vitals.blood, 0);
});

test("the dying state is entered well before death", () => {
  const state = createInjuryState();
  applyWound(state, "blade", "torso", 0.9, 0);

  advanceInjury(state, 900, 900);
  assert.equal(state.alive, true, "dying is drawn out, not instant");
  assert.equal(isDying(state), true);
  assert.ok(bloodFraction(state) < 0.55);
});

test("treatment slows the bleed substantially", () => {
  const untreated = createInjuryState();
  const treated = createInjuryState();
  applyWound(untreated, "blade", "torso", 0.8, 0);
  const wound = applyWound(treated, "blade", "torso", 0.8, 0);

  assert.equal(treat(treated, wound.id, 1), true);

  advanceInjury(untreated, 300, 300);
  advanceInjury(treated, 300, 300);

  assert.ok(treated.vitals.blood > untreated.vitals.blood);
  assert.ok(treated.vitals.pain < untreated.vitals.pain);
});

test("an untreated significant wound becomes infected after hours", () => {
  const state = createInjuryState();
  applyWound(state, "improvised", "arm", 0.7, 0);

  const early = advanceInjury(state, 300, 300);
  assert.equal(early.newlyInfected, 0);

  const later = advanceInjury(state, 120, 420);
  assert.equal(later.newlyInfected, 1);
  assert.ok(state.vitals.infection > 0);
});

test("coarse and fine integration agree on blood loss", () => {
  const coarse = createInjuryState();
  const fine = createInjuryState();
  applyWound(coarse, "blade", "leg", 0.6, 0);
  applyWound(fine, "blade", "leg", 0.6, 0);

  advanceInjury(coarse, 600, 600);
  for (let minute = 1; minute <= 600; minute += 1) advanceInjury(fine, 1, minute);

  const delta = Math.abs(coarse.vitals.blood - fine.vitals.blood);
  assert.ok(delta < 30, `off-screen and on-screen injury diverged by ${delta} ml`);
});
