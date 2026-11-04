import assert from "node:assert/strict";
import test from "node:test";
import { World } from "../src/sim/world.ts";

test("identical seeds produce identical worlds", () => {
  const a = World.create({ seed: "alpha", npcCount: 40 });
  const b = World.create({ seed: "alpha", npcCount: 40 });
  assert.equal(a.hash(), b.hash());
});

test("a week of simulation stays deterministic", () => {
  const settings = { darkThemes: true, violence: "graphic" as const };
  const a = World.create({ seed: "alpha", npcCount: 40, settings });
  const b = World.create({ seed: "alpha", npcCount: 40, settings });
  a.tick(1440 * 7);
  b.tick(1440 * 7);
  assert.equal(a.hash(), b.hash());
  assert.ok(a.log.length > 0, "the simulated week should have produced events");
});

test("different seeds diverge", () => {
  const a = World.create({ seed: "alpha", npcCount: 40 });
  const b = World.create({ seed: "beta", npcCount: 40 });
  assert.notEqual(a.hash(), b.hash());
});

test("the rng is serializable and resumes identically", () => {
  const a = World.create({ seed: "stream", npcCount: 10 });
  const state = a.rng.getState();
  const first = [a.rng.next(), a.rng.next(), a.rng.next()];
  a.rng.setState(state);
  const second = [a.rng.next(), a.rng.next(), a.rng.next()];
  assert.deepEqual(first, second);
});
