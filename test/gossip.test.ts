import assert from "node:assert/strict";
import test from "node:test";
import type { GossipDeps } from "../src/sim/gossip.ts";
import { spreadRumor } from "../src/sim/gossip.ts";
import { World } from "../src/sim/world.ts";

function depsFor(world: World): GossipDeps {
  return {
    relationships: world.relationships,
    memories: world.memories,
    npcs: world.npcs,
    rng: world.rng,
    now: () => world.clock.minutes,
    log: () => {},
    playerId: world.playerId,
  };
}

test("a rumor travels the social graph and leaves memories", () => {
  const world = World.create({ seed: "gossip", npcCount: 40 });
  const circle = [...world.npcs.values()].slice(0, 10);

  // A dense circle so the propagation is not at the mercy of a sparse graph.
  for (let i = 0; i < circle.length; i += 1) {
    for (let j = i + 1; j < circle.length; j += 1) {
      world.relationships.apply(circle[i].id, circle[j].id, { friendship: 70, trust: 70 }, 0);
    }
  }

  const origin = circle[0];
  const subject = circle[1];
  const result = spreadRumor(depsFor(world), origin.id, {
    subject: subject.id,
    summary: "Something happened at the house and it is being talked about.",
    tags: ["incident"],
    salience: 0.9,
    valence: -0.7,
  });

  assert.ok(result.heardBy.length >= 3, `expected the rumor to spread, heard by ${result.heardBy.length}`);
  assert.ok(world.memories.count() >= result.heardBy.length);
  assert.ok(!result.heardBy.includes(origin.id));
  assert.ok(!result.heardBy.includes(subject.id));
});

test("salience decays with each hop", () => {
  const world = World.create({ seed: "gossip-decay", npcCount: 20 });
  const circle = [...world.npcs.values()].slice(0, 8);
  for (let i = 0; i < circle.length; i += 1) {
    for (let j = i + 1; j < circle.length; j += 1) {
      world.relationships.apply(circle[i].id, circle[j].id, { friendship: 80, trust: 80 }, 0);
    }
  }

  spreadRumor(depsFor(world), circle[0].id, {
    subject: circle[1].id,
    summary: "A quiet rumor.",
    tags: ["test"],
    salience: 0.8,
    valence: -0.2,
  });

  const rumorMemories = world.memories.all().filter((memory) => memory.tags.includes("rumor"));
  assert.ok(rumorMemories.length > 0);
  for (const memory of rumorMemories) {
    assert.ok(memory.salience < 0.8, "no retelling may be stronger than the original");
  }
});
