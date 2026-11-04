import assert from "node:assert/strict";
import test from "node:test";
import { World } from "../src/sim/world.ts";

function stranger(world: World) {
  const npc = [...world.npcs.values()].find((entry) => entry.alive && entry.homeLocation === "elsewhere");
  if (!npc) throw new Error("no eligible character generated");
  return npc;
}

test("only people who live elsewhere can be taken", () => {
  const world = World.create({ seed: "custody-take", npcCount: 20 });
  const family = [...world.npcs.values()].find((npc) => world.relationships.get(npc.id, world.playerId).family);
  if (!family) throw new Error("no family generated");

  assert.equal(world.custody.take(family.id), false);
  assert.equal(world.custody.take(world.playerId), false);

  const target = stranger(world);
  assert.equal(world.custody.take(target.id), true);
  assert.equal(world.custody.take(target.id), false);
});

test("gagging reduces the noise the room has to contain", () => {
  const world = World.create({ seed: "custody-noise", npcCount: 20 });
  const target = stranger(world);
  world.custody.take(target.id);

  world.custody.restrain(target.id, "gag", false);
  const openNoise = world.custody.noiseLevel();

  world.custody.restrain(target.id, "gag", true);
  const gaggedNoise = world.custody.noiseLevel();

  assert.ok(openNoise > 0);
  assert.ok(gaggedNoise < openNoise, `${openNoise} -> ${gaggedNoise}`);
});

test("feeding and releasing are real state changes", () => {
  const world = World.create({ seed: "custody-feed", npcCount: 20 });
  const target = stranger(world);
  world.custody.take(target.id);

  assert.equal(world.custody.feed(target.id), true);
  assert.equal(world.custody.holds(target.id), true);
  assert.equal(world.custody.release(target.id), true);
  assert.equal(world.custody.holds(target.id), false);
});

test("a captive is placed in the room, not by their own schedule", () => {
  const world = World.create({ seed: "custody-placement", npcCount: 20 });
  const target = stranger(world);
  world.custody.take(target.id);

  const room = world.facility.roomId;
  assert.equal(room, null, "no room chosen yet, so nobody should be placed");

  world.chooseHiddenRoom("basement");
  const placement = world.placements().find((entry) => entry.npcId === target.id);
  if (!placement) throw new Error("captive was not placed");
  assert.equal(placement.room, "basement");
});

test("custody survives a save and restore", () => {
  const world = World.create({ seed: "custody-save", npcCount: 20 });
  const target = stranger(world);
  world.custody.take(target.id);
  world.custody.restrain(target.id, "gag", true);

  const saved = world.snapshot();
  const restored = World.fromSnapshot(saved);

  assert.equal(restored.custody.holds(target.id), true);
  assert.equal(restored.custody.list()[0]?.restraints.gag, true);
  assert.equal(restored.hash(), world.hash());
});
