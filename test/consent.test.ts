import assert from "node:assert/strict";
import test from "node:test";
import type { ContentSettings } from "../src/content/gate.ts";
import type { Npc } from "../src/sim/types.ts";
import { World } from "../src/sim/world.ts";

function fixture(settings?: Partial<ContentSettings>): { world: World; partner: Npc } {
  const world = World.create({
    seed: "consent-test",
    npcCount: 20,
    settings: settings ?? { sexual: "explicit" },
  });
  const partner = [...world.npcs.values()].find(
    (npc) => npc.id !== world.playerId && !world.relationships.get(npc.id, world.playerId).family,
  );
  if (!partner) throw new Error("fixture generated no eligible partner");
  world.relationships.apply(world.playerId, partner.id, { trust: 80, attraction: 60, familiarity: 50 }, 0);
  return { world, partner };
}

function beginScene(world: World, partner: Npc, ceiling = 6) {
  const scene = world.openScene(world.playerId, partner.id);
  scene.negotiate({ categories: [], intensityCeiling: ceiling, safewords: ["red"], conditions: [] });
  scene.affirm(world.playerId);
  scene.affirm(partner.id);
  scene.begin();
  return scene;
}

test("nothing happens before both participants affirm", () => {
  const { world, partner } = fixture();
  const scene = world.openScene(world.playerId, partner.id);
  scene.negotiate({ categories: [], intensityCeiling: 5, safewords: [], conditions: [] });

  assert.throws(() => scene.begin(), /both participants must affirm/);
  scene.affirm(world.playerId);
  assert.throws(() => scene.begin(), /both participants must affirm/);
  scene.affirm(partner.id);
  assert.equal(scene.state, "affirmed");
  scene.begin();
  assert.equal(scene.state, "active");
});

test("a safeword is a hard stop and cannot be resumed", () => {
  const { world, partner } = fixture();
  const scene = beginScene(world, partner);
  scene.requestIntensity(4);

  scene.safeword(partner.id, "red");
  assert.equal(scene.state, "safeworded");
  assert.ok(scene.isFinished);

  assert.throws(() => scene.requestIntensity(5), /consent is/);
  assert.throws(() => scene.begin(), /consent state/);
  assert.throws(() => scene.aftercare(1), /consent state/);
});

test("withdrawal ends the scene and costs the relationship", () => {
  const { world, partner } = fixture();
  const scene = beginScene(world, partner);
  const trustBefore = world.relationships.get(world.playerId, partner.id).axes.trust;

  scene.withdraw(partner.id, "changed their mind");
  assert.equal(scene.state, "withdrawn");

  const rel = world.relationships.get(world.playerId, partner.id);
  assert.ok(rel.axes.trust < trustBefore, "trust should fall after a withdrawal");
  assert.ok(rel.axes.resentment > 0, "resentment should rise");
  assert.ok(scene.ticks === 0);
});

test("intensity may not exceed the negotiated ceiling", () => {
  const { world, partner } = fixture();
  const scene = beginScene(world, partner, 9);
  assert.throws(() => scene.requestIntensity(12), /exceeds the negotiated ceiling/);
});

test("consent is re-checked and the scene can end itself", () => {
  const { world, partner } = fixture();
  for (const npc of [world.player, partner]) {
    npc.stress = 100;
    npc.sexual.comfort = 0.05;
    npc.mood = -40;
  }
  const scene = beginScene(world, partner, 8);
  scene.requestIntensity(4);

  let beats = 0;
  while (scene.state === "active" && beats < 500) {
    scene.tick(world.rng);
    beats += 1;
  }

  assert.notEqual(scene.state, "active", "a scene with stressed, low-trust participants should stop itself");
  assert.match(scene.endedReason ?? "", /changed their mind/);
});

test("content settings are enforced live, mid-scene", () => {
  const { world, partner } = fixture();
  const scene = beginScene(world, partner);
  world.gate.setSettings({ sexual: "suggestive" });
  scene.tick(world.rng);
  assert.equal(scene.state, "withdrawn");
  assert.match(scene.endedReason ?? "", /content settings changed/);
});

test("family members can never be sexual partners", () => {
  const { world } = fixture();
  const family = [...world.npcs.values()].find((npc) =>
    world.relationships.get(npc.id, world.playerId).family,
  );
  if (!family) throw new Error("fixture generated no family member");
  assert.throws(() => world.openScene(world.playerId, family.id), /family relationships can never/);
});

test("nothing sexual can open while explicit content is off", () => {
  const { world, partner } = fixture({ sexual: "off" });
  assert.throws(() => world.openScene(world.playerId, partner.id), /disabled in content settings/);
});

test("a kink category switched off is refused, and accepted once enabled", () => {
  const { world, partner } = fixture({ sexual: "explicit" });
  // Both sides of a negotiation are checked, including the player's own limits.
  for (const npc of [world.player, partner]) {
    npc.sexual.interests = ["bondage"];
    npc.sexual.curiosities = [];
    npc.sexual.hardLimits = [];
  }

  const blocked = world.openScene(world.playerId, partner.id);
  const refused = blocked.negotiate({
    categories: ["bondage"],
    intensityCeiling: 5,
    safewords: [],
    conditions: [],
  });
  assert.equal(refused.declined, true);
  assert.equal(refused.refusals.length, 1);
  assert.match(refused.refusals[0].reason, /disabled in content settings/);
  assert.equal(blocked.state, "closed");

  world.gate.setFetish("bondage", true);
  const allowed = world.openScene(world.playerId, partner.id);
  const accepted = allowed.negotiate({
    categories: ["bondage"],
    intensityCeiling: 5,
    safewords: [],
    conditions: [],
  });
  assert.equal(accepted.declined, false);
  assert.deepEqual(accepted.accepted.categories, ["bondage"]);
  assert.ok(accepted.accepted.safewords.includes("red"));
});
