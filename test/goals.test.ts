import assert from "node:assert/strict";
import test from "node:test";
import {
  ARREST_HEAT,
  CONDEMNED_CONDITION,
  EVICTION_BALANCE,
  ISOLATION_DAY,
  STABLE_DAY,
  evaluateEnding,
  evaluateObjectives,
  overallProgress,
} from "../src/sim/goals.ts";
import type { GoalInput } from "../src/sim/goals.ts";
import { World } from "../src/sim/world.ts";

function healthy(overrides: Partial<GoalInput> = {}): GoalInput {
  return {
    balance: 900,
    houseCondition: 92,
    heat: 4,
    employed: true,
    reputation: 12,
    day: 10,
    relationships: [{ familiarity: 70, trust: 62, friendship: 58 }],
    ...overrides,
  };
}

test("there are six weighted objectives that together sum to one", () => {
  const objectives = evaluateObjectives(healthy());
  assert.equal(objectives.length, 6);
  const total = objectives.reduce((sum, objective) => sum + objective.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
  for (const objective of objectives) {
    assert.ok(objective.progress >= 0 && objective.progress <= 1);
  }
});

test("a healthy world scores well and a ruined one scores badly", () => {
  const good = overallProgress(evaluateObjectives(healthy()));
  const bad = overallProgress(
    evaluateObjectives({
      balance: -2400,
      houseCondition: 20,
      heat: 80,
      employed: false,
      reputation: -80,
      day: 40,
      relationships: [],
    }),
  );
  assert.ok(good > 0.9, `healthy progress was ${good}`);
  assert.ok(bad < 0.15, `ruined progress was ${bad}`);
});

test("no ending before the world has had time to reach one", () => {
  assert.equal(evaluateEnding(healthy({ day: 2 })), null);
});

test("arrest outranks everything else", () => {
  const ending = evaluateEnding(healthy({ heat: ARREST_HEAT, balance: EVICTION_BALANCE - 1, houseCondition: 0 }));
  assert.equal(ending?.ending, "arrested");
});

test("bankruptcy, condemnation and isolation each end the run", () => {
  assert.equal(evaluateEnding(healthy({ balance: EVICTION_BALANCE }))?.ending, "evicted");
  assert.equal(evaluateEnding(healthy({ houseCondition: CONDEMNED_CONDITION }))?.ending, "condemned");
  assert.equal(
    evaluateEnding(healthy({ day: ISOLATION_DAY, relationships: [{ familiarity: 5, trust: 10, friendship: 2 }] }))?.ending,
    "isolated",
  );
});

test("holding everything together past day 45 is the stable ending", () => {
  assert.equal(evaluateEnding(healthy({ day: STABLE_DAY }))?.ending, "stable");
});

test("the world exposes its own objectives and ending", () => {
  const world = World.create({ seed: "goals-world", npcCount: 20 });
  const objectives = world.objectives();
  // Six pressures plus the threshold, which only exists in agoraphobic mode.
  assert.equal(objectives.length, 7);
  assert.ok(objectives.some((objective) => objective.id === "threshold"));
  assert.ok(world.progress() > 0);
  assert.equal(world.ending(), null);
});
