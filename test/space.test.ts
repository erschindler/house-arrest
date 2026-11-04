import assert from "node:assert/strict";
import test from "node:test";
import { HOUSE_ANCHORS, HOUSE_ROOMS, Space, FLOOR_HEIGHT } from "../src/sim/space.ts";
import { HOUSE_LOCATIONS, blockAt, isOnProperty } from "../src/sim/schedule.ts";
import { World } from "../src/sim/world.ts";

test("every scheduled house location exists as a room", () => {
  const space = new Space();
  for (const location of HOUSE_LOCATIONS) {
    assert.ok(space.hasRoom(location), `${location} has no room`);
  }
});

test("off-site locations are not rooms", () => {
  const space = new Space();
  for (const location of ["workplace", "store", "gym", "elsewhere"]) {
    assert.equal(space.hasRoom(location), false, `${location} should not be a room in the house`);
  }
});

test("every anchor sits inside its own room", () => {
  const space = new Space();
  for (const anchor of HOUSE_ANCHORS) {
    const room = space.room(anchor.room);
    if (!room) throw new Error(`${anchor.id} references an unknown room`);
    const { x, y, width, depth } = room.bounds;
    assert.ok(anchor.position.x >= x && anchor.position.x <= x + width, `${anchor.id} x=${anchor.position.x} outside ${anchor.room}`);
    assert.ok(anchor.position.y >= y && anchor.position.y <= y + depth, `${anchor.id} y=${anchor.position.y} outside ${anchor.room}`);
    assert.equal(anchor.position.z, room.level * FLOOR_HEIGHT, `${anchor.id} is not on its room's floor`);
  }
});

test("room bounds do not overlap on the same level", () => {
  for (const room of HOUSE_ROOMS) {
    for (const other of HOUSE_ROOMS) {
      if (room.id === other.id || room.level !== other.level) continue;
      const a = room.bounds;
      const b = other.bounds;
      const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
      const overlapY = a.y < b.y + b.depth && b.y < a.y + a.depth;
      assert.equal(overlapX && overlapY, false, `${room.id} overlaps ${other.id}`);
    }
  }
});

test("privacy is declared where it matters", () => {
  const space = new Space();
  assert.equal(space.isPrivate("bathroom"), true);
  assert.equal(space.isPrivate("masterBedroom"), true);
  assert.equal(space.isPrivate("backyard"), false);
  assert.equal(space.isIndoors("backyard"), false);
  assert.equal(space.isIndoors("kitchen"), true);
});

test("placement is stable across space instances and across calls", () => {
  const world = World.create({ seed: "space-stable", npcCount: 20 });
  const npc = [...world.npcs.values()].find((entry) => entry.id !== world.playerId);
  if (!npc) throw new Error("no other character was generated");

  const first = world.space.placementOf(npc, 600);
  const second = new Space().placementOf(npc, 600);
  assert.deepEqual(first, second);
});

test("every character on the property has a transform", () => {
  const world = World.create({ seed: "space-coverage", npcCount: 40 });
  for (const minute of [0, 200, 480, 1000, 1200]) {
    for (const npc of world.npcs.values()) {
      if (!npc.alive) continue;
      if (!isOnProperty(npc, minute)) continue;
      assert.ok(world.space.placementOf(npc, minute), `${npc.id} is on the property at ${minute} but unplaced`);
    }
  }
});

test("only residents appear in the world's transforms", () => {
  const world = World.create({ seed: "space-residents", npcCount: 60 });
  const residents = world.residents();
  assert.ok(residents.length >= 1 && residents.length <= 4, `${residents.length} residents`);

  for (const placement of world.placements()) {
    assert.ok(residents.some((npc) => npc.id === placement.npcId), `${placement.npcId} is not a resident`);
  }
});

test("the whole population does not live in one house", () => {
  const world = World.create({ seed: "space-population", npcCount: 60 });
  assert.ok(world.residents().length < world.npcs.size / 4, `${world.residents().length} of ${world.npcs.size}`);
});

test("occupants groups characters by the room their schedule puts them in", () => {
  const world = World.create({ seed: "space-occupants", npcCount: 30 });
  const minute = 600;
  const occupants = world.space.occupants(minute, world.npcs.values());
  for (const npc of world.npcs.values()) {
    const block = blockAt(npc, minute);
    const room = world.space.room(block.location);
    if (!room || !npc.alive) continue;
    assert.ok(occupants.get(room.id)?.includes(npc.id), `${npc.id} missing from ${room.id}`);
  }
});

test("transforms only include placed characters", () => {
  const world = World.create({ seed: "space-transforms", npcCount: 50 });
  world.tick(360);
  const transforms = world.placements();
  assert.ok(transforms.length > 0);
  for (const placement of transforms) {
    assert.ok(world.space.hasRoom(placement.room));
    assert.ok(placement.anchorId.startsWith(placement.room));
  }
});
