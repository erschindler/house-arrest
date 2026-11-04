import assert from "node:assert/strict";
import test from "node:test";
import { blockAt } from "../src/sim/schedule.ts";
import type { Npc } from "../src/sim/types.ts";
import { World } from "../src/sim/world.ts";

function firstOther(world: World): Npc {
  const npc = [...world.npcs.values()].find((entry) => entry.id !== world.playerId);
  if (!npc) throw new Error("no other character was generated");
  return npc;
}

function requireNpc(world: World, npcId: string): Npc {
  const npc = world.npcs.get(npcId);
  if (!npc) throw new Error(`unknown character ${npcId}`);
  return npc;
}

function sleepingMinute(world: World, npcId: string): number {
  const npc = requireNpc(world, npcId);
  for (let minute = 0; minute < 1440; minute += 5) {
    if (blockAt(npc, minute).activity === "sleep") return minute;
  }
  throw new Error("nobody sleeps in this world");
}

function availableMinute(world: World, npcId: string): number {
  const npc = requireNpc(world, npcId);
  for (let minute = 0; minute < 1440; minute += 5) {
    const block = blockAt(npc, minute);
    if (block.activity !== "sleep" && block.location !== "workplace") return minute;
  }
  throw new Error("no free minute");
}

test("texting creates a thread and warms the relationship", () => {
  const world = World.create({ seed: "phone-text", npcCount: 20 });
  const npc = firstOther(world);
  const before = world.relationships.get(world.playerId, npc.id).axes.familiarity;

  const message = world.phone.text(npc.id, "You around?");

  assert.equal(message.direction, "out");
  assert.equal(message.kind, "text");
  assert.ok(world.relationships.get(world.playerId, npc.id).axes.familiarity > before);
  assert.equal(world.readPhone(npc.id).length, 1);
});

test("texting an unknown contact throws", () => {
  const world = World.create({ seed: "phone-unknown", npcCount: 8 });
  assert.throws(() => world.phone.text("npc-does-not-exist", "hello"), /unknown contact/);
});

test("a call to someone asleep goes to voicemail", () => {
  const world = World.create({ seed: "phone-asleep", npcCount: 20 });
  const npc = firstOther(world);
  world.clock.minutes = sleepingMinute(world, npc.id);

  const result = world.phone.call(npc.id);

  assert.equal(result.answered, false);
  assert.equal(result.reason, "asleep");
  assert.equal(result.message.kind, "voicemail");
});

test("a close friend who is awake answers", () => {
  const world = World.create({ seed: "phone-answer", npcCount: 20 });
  const npc = firstOther(world);
  world.relationships.apply(world.playerId, npc.id, { friendship: 100, trust: 100, familiarity: 60 }, 0);
  world.clock.minutes = availableMinute(world, npc.id);

  const result = world.phone.call(npc.id);

  assert.equal(result.answered, true);
  assert.equal(result.message.kind, "call");
});

test("blocking stops outbound texts and drops trust", () => {
  const world = World.create({ seed: "phone-block", npcCount: 12 });
  const npc = firstOther(world);
  const before = world.relationships.get(world.playerId, npc.id).axes.trust;

  world.phone.block(npc.id);

  assert.ok(world.relationships.get(world.playerId, npc.id).axes.trust < before);
  assert.throws(() => world.phone.text(npc.id, "hello"), /blocked/);
  assert.equal(world.phone.call(npc.id).answered, false);
});

test("marking a thread read clears the unread count", () => {
  const world = World.create({ seed: "phone-unread", npcCount: 24 });
  for (const npc of world.npcs.values()) {
    if (npc.id === world.playerId) continue;
    world.relationships.apply(world.playerId, npc.id, { friendship: 70, trust: 40 }, 0);
  }

  world.tick(1440 * 3);
  assert.ok(world.phone.unreadCount() > 0, "expected at least one inbound message over three days");

  for (const thread of world.phone.threads) world.phone.markRead(thread.npcId);
  assert.equal(world.phone.unreadCount(), 0);
});

test("phone messages survive a save and restore", () => {
  const world = World.create({ seed: "phone-save", npcCount: 16 });
  const npc = firstOther(world);
  world.phone.text(npc.id, "Saving this.");
  world.tick(240);

  const restored = World.fromSnapshot(world.snapshot());

  assert.equal(restored.phone.snapshot().threads.length, world.phone.snapshot().threads.length);
  assert.equal(restored.hash(), world.hash());
});
