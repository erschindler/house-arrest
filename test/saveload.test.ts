import assert from "node:assert/strict";
import test from "node:test";
import { deserializeWorld, serializeWorld } from "../src/save/serialize.ts";
import { World } from "../src/sim/world.ts";

test("a saved world restores byte-identically", () => {
  const original = World.create({ seed: "save", npcCount: 30 });
  original.tick(1440 * 7);

  const text = serializeWorld(original.snapshot());
  const restored = World.fromSnapshot(deserializeWorld(text));

  assert.equal(restored.hash(), original.hash());
  assert.equal(restored.npcs.size, original.npcs.size);
  assert.equal(restored.log.length, original.log.length);
  assert.equal(restored.memories.count(), original.memories.count());
});

test("a restored world continues on exactly the same trajectory", () => {
  const original = World.create({ seed: "save", npcCount: 30, settings: { darkThemes: true } });
  original.tick(1440 * 3);

  const restored = World.fromSnapshot(deserializeWorld(serializeWorld(original.snapshot())));

  original.tick(1440 * 7);
  restored.tick(1440 * 7);

  assert.equal(restored.hash(), original.hash());
});

test("the save format is canonical", () => {
  const world = World.create({ seed: "canon", npcCount: 12 });
  const first = serializeWorld(world.snapshot());
  const second = serializeWorld(world.snapshot());
  assert.equal(first, second);

  const parsed = deserializeWorld(first);
  assert.equal(serializeWorld(parsed), first);
});

test("an unknown save version is rejected", () => {
  const world = World.create({ seed: "version", npcCount: 8 });
  const snapshot = world.snapshot();
  snapshot.version = 99;
  assert.throws(() => deserializeWorld(JSON.stringify(snapshot)), /unsupported save version/);
});
