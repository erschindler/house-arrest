import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_ORDER } from "../src/sim/facility.ts";
import { World } from "../src/sim/world.ts";

function buildAll(world: World): void {
  world.economy.balance = 50000;
  if (!world.chooseHiddenRoom("basement")) throw new Error("could not choose the basement");

  for (const stage of BUILD_ORDER) {
    const started = world.beginBuild(stage);
    if (!started.ok) throw new Error(`${stage}: ${started.reason}`);

    let guard = 0;
    while (world.facility.activeProject) {
      world.tick(60);
      guard += 1;
      if (guard > 240) throw new Error(`${stage} never finished`);
    }
  }
}

test("only rooms with somewhere to hide qualify", () => {
  const world = World.create({ seed: "fac-rooms", npcCount: 6 });
  assert.equal(world.chooseHiddenRoom("kitchen"), false);
  assert.equal(world.chooseHiddenRoom("guestBedroom"), true);
  assert.equal(world.chooseHiddenRoom("basement"), false);
});

test("a stage cannot start before what it sits on", () => {
  const world = World.create({ seed: "fac-order", npcCount: 6 });
  world.economy.balance = 50000;
  assert.equal(world.chooseHiddenRoom("basement"), true);

  const early = world.beginBuild("soundproof");
  assert.equal(early.ok, false);
  assert.match(early.reason, /finished first/);
});

test("a stage is refused when the money is not there", () => {
  const world = World.create({ seed: "fac-money", npcCount: 6 });
  world.economy.balance = 100;
  assert.equal(world.chooseHiddenRoom("basement"), true);

  const started = world.beginBuild("frame");
  assert.equal(started.ok, false);
  assert.match(started.reason, /afford/);
});

test("a finished room is operational and contains noise", () => {
  const world = World.create({ seed: "fac-ready", npcCount: 6 });
  buildAll(world);

  assert.equal(world.tortureReady, true);
  assert.ok(world.facility.soundRating > 40, `sound rating ${world.facility.soundRating}`);
  assert.ok(world.facility.noiseContained(80) < 80);
});

test("using the room wears it down", () => {
  const world = World.create({ seed: "fac-wear", npcCount: 6 });
  buildAll(world);

  const concealment = world.facility.concealment;
  const sound = world.facility.soundRating;
  world.facility.registerUse(5);

  assert.ok(world.facility.concealment < concealment);
  assert.ok(world.facility.soundRating < sound);
});

test("the build is recorded in the world hash", () => {
  const a = World.create({ seed: "fac-hash", npcCount: 6 });
  const b = World.create({ seed: "fac-hash", npcCount: 6 });
  buildAll(a);
  buildAll(b);
  assert.equal(a.hash(), b.hash());
});
