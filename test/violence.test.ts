import assert from "node:assert/strict";
import test from "node:test";
import type { ContentSettings } from "../src/content/gate.ts";
import { World } from "../src/sim/world.ts";

function fixture(seed: string, settings: Partial<ContentSettings>) {
  const world = World.create({ seed, npcCount: 20, settings });
  const victims = [...world.npcs.values()].filter((npc) => npc.id !== world.playerId).slice(0, 10);
  return { world, victims };
}

test("violence below graphic produces no wounds at all", () => {
  const { world, victims } = fixture("violence-standard", { violence: "standard" });
  for (const victim of victims) world.assault(world.playerId, victim.id, "blade");

  const wounds = victims.reduce((sum, npc) => sum + npc.injury.wounds.length, 0);
  assert.equal(wounds, 0, "no wound objects may exist, so no gore assets have anything to attach to");

  const entries = world.log.filter((entry) => entry.kind === "violence");
  assert.ok(entries.length > 0);
  assert.ok(entries.every((entry) => entry.gated));
});

test("graphic violence creates wounds, evidence and psychological cost", () => {
  const { world, victims } = fixture("violence-graphic", { violence: "graphic" });
  const guiltBefore = world.player.guilt;

  let woundCount = 0;
  for (const victim of victims) {
    const outcome = world.assault(world.playerId, victim.id, "firearm");
    if (outcome.victimWoundId) woundCount += 1;
  }

  assert.ok(woundCount > 0, "graphic violence should produce injury state");
  assert.ok(world.investigation.evidence.length > 0, "physical evidence must be recorded");
  assert.ok(world.player.guilt > guiltBefore, "the attacker's state of mind must degrade");
  assert.ok(world.player.detachment > 0);
});

test("the same assault sequence is deterministic", () => {
  const a = fixture("violence-deterministic", { violence: "graphic" });
  const b = fixture("violence-deterministic", { violence: "graphic" });

  for (const victim of a.victims) a.world.assault(a.world.playerId, victim.id, "blade");
  for (const victim of b.victims) b.world.assault(b.world.playerId, victim.id, "blade");

  assert.equal(a.world.hash(), b.world.hash());
});

test("a victim who dies stops being available", () => {
  const { world, victims } = fixture("violence-lethal", { violence: "extreme" });
  const target = victims[0];

  for (let attempt = 0; attempt < 200 && target.alive; attempt += 1) {
    world.assault(world.playerId, target.id, "firearm");
    world.tick(30);
  }

  assert.equal(target.alive, false, "sustained assault at extreme violence should be lethal");
  assert.equal(target.injury.alive, false);
  assert.ok(world.investigation.evidence.some((entry) => entry.kind === "body"));
});
