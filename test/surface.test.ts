import assert from "node:assert/strict";
import test from "node:test";
import { createRng } from "../src/core/rng.ts";
import { ContentGate } from "../src/content/gate.ts";
import {
  coverageAt,
  cutClothing,
  expressionFor,
  garmentsFor,
  pullOff,
  resolveContact,
  severanceStep,
  sprayFor,
  voiceFor,
} from "../src/sim/surface.ts";
import {
  advanceTorture,
  applyAct,
  createTortureSession,
  normaliseSession,
} from "../src/sim/torture.ts";
import type { TortureSessionState } from "../src/sim/torture.ts";
import { World } from "../src/sim/world.ts";

function bareChest(depth: number) {
  return {
    region: "chest" as const,
    tool: "blade" as const,
    pointX: 0.52,
    angleDeg: 5,
    forceN: 140,
    commandedCm: depth,
    clothing: 0,
  };
}

test("a deep chest wound reaches the heart; a shallow one does not", () => {
  const deep = resolveContact(bareChest(10));
  assert.equal(deep.organ, "heart", deep.description);

  const shallow = resolveContact({ ...bareChest(2), forceN: 20 });
  assert.equal(shallow.organ, null);
  assert.ok(shallow.depthCm < deep.depthCm);
});

test("clothing costs depth, and cutting it restores it", () => {
  const garments = garmentsFor("dressed");
  const clothed = resolveContact({ ...bareChest(10), clothing: coverageAt(garments, "chest") });
  const bare = resolveContact(bareChest(10));
  assert.ok(clothed.depthCm < bare.depthCm, `${clothed.depthCm} vs ${bare.depthCm}`);

  for (let pass = 0; pass < 8; pass += 1) cutClothing(garments, "chest", "blade");
  assert.equal(coverageAt(garments, "chest"), 0);
  assert.equal(cutClothing(garments, "chest", "blade"), 0);
});

test("pulling clothing off is deterministic and can tear it", () => {
  const garments = garmentsFor("dressed");
  const result = pullOff(garments, "top", 20);
  assert.equal(result.removed, true);
  assert.equal(result.torn, true);
  assert.equal(coverageAt(garments, "chest"), 0);
  assert.equal(pullOff(garments, "top", 20).removed, false);
});

test("a glancing blow on the shin turns on bone", () => {
  const straight = resolveContact({
    region: "leftShin",
    tool: "blade",
    pointX: 0.42,
    angleDeg: 5,
    forceN: 150,
    commandedCm: 10,
    clothing: 0,
  });
  assert.equal(straight.deflectionDeg, 0);
  assert.ok(straight.tissues.includes("bone"));

  const glancing = resolveContact({
    region: "leftShin",
    tool: "blade",
    pointX: 0.42,
    angleDeg: 70,
    forceN: 150,
    commandedCm: 10,
    clothing: 0,
  });
  assert.ok(glancing.deflectionDeg > 0);
  assert.ok(glancing.depthCm < straight.depthCm);
});

test("an artery sprays and a vein does not", () => {
  const arterial = resolveContact({
    region: "neck",
    tool: "scalpel",
    pointX: 0.2,
    angleDeg: 0,
    forceN: 120,
    commandedCm: 4,
    clothing: 0,
  });
  assert.equal(arterial.organ, "carotid");
  const spray = sprayFor(arterial.bleedMlMin, 110);
  assert.equal(spray.pulsatile, true);
  assert.ok(spray.velocity > 0.5);

  const venous = sprayFor(30, 60);
  assert.equal(venous.pulsatile, false);
});

test("a joint cannot be severed in one pass, and a saw is faster than a knife", () => {
  const knife = severanceStep(0, "leftShoulder", "blade", 120);
  assert.equal(knife.done, false);
  assert.ok(knife.progressMm > 0);

  let sawProgress = 0;
  let sawPasses = 0;
  while (sawProgress < 78) {
    sawProgress = severanceStep(sawProgress, "leftShoulder", "saw", 140).progressMm;
    sawPasses += 1;
  }

  let knifeProgress = 0;
  let knifePasses = 0;
  while (knifeProgress < 78) {
    knifeProgress = severanceStep(knifeProgress, "leftShoulder", "blade", 140).progressMm;
    knifePasses += 1;
  }

  assert.ok(sawPasses < knifePasses, `saw ${sawPasses}, knife ${knifePasses}`);
});

test("voice and face follow state instead of being picked at random", () => {
  const calm = { pain: 5, terror: 10, shock: 5, consciousness: 100, adrenaline: 10 };
  assert.equal(voiceFor(calm, "male").cue, "whimper");
  assert.equal(voiceFor(calm, "female").assetClass, "audio.voice.female");
  assert.equal(expressionFor(calm), "neutral");

  const agony = { pain: 90, terror: 80, shock: 60, consciousness: 90, adrenaline: 30 };
  assert.equal(voiceFor(agony, "male").cue, "shriek");
  assert.equal(expressionFor(agony), "agony");

  const out = { pain: 90, terror: 80, shock: 90, consciousness: 0, adrenaline: 0 };
  assert.equal(voiceFor(out, "female").cue, "silence");
  assert.equal(expressionFor(out), "blank");
});

test("sawing a shoulder off takes many passes and then opens the artery", () => {
  const world = World.create({ seed: "surface-sever", npcCount: 10 });
  const npc = [...world.npcs.values()].find((entry) => entry.id !== world.playerId);
  if (!npc) throw new Error("no character");

  const gate = new ContentGate({ violence: "extreme", darkThemes: true, nudity: "full" });
  const rng = createRng("surface-sever");
  const session = createTortureSession(npc, 0);

  let guard = 0;
  while (session.limbs.rightArm.attached && guard < 200) {
    applyAct(session, gate, { kind: "sever", joint: "rightShoulder", tool: "saw", force: 150 }, 0, rng);
    guard += 1;
  }

  assert.equal(session.limbs.rightArm.attached, false);
  assert.ok(guard > 1, `it should take several passes, took ${guard}`);
  assert.ok(session.blood.sprays >= 1);
  assert.ok(session.vitals.shock > 20);

  const before = session.vitals.blood;
  advanceTorture(session, 5, 5);
  assert.ok(session.vitals.blood < before);
});

test("a session saved before clothing existed still loads", () => {
  const world = World.create({ seed: "surface-save", npcCount: 8 });
  const npc = [...world.npcs.values()].find((entry) => entry.id !== world.playerId);
  if (!npc) throw new Error("no character");

  const current = createTortureSession(npc, 0);
  const legacy = { ...current } as Record<string, unknown>;
  for (const field of ["garments", "joints", "blood", "voice", "expression", "sex"]) delete legacy[field];

  const restored = normaliseSession(legacy as unknown as TortureSessionState);
  if (!restored) throw new Error("the session did not come back");
  assert.ok(restored.garments.length > 0);
  assert.ok(restored.voice.cue.length > 0);
  assert.ok(restored.joints.leftShoulder === 0);
  assert.ok(restored.blood.systolic > 0);
});

test("clothing is cut before skin in a session", () => {
  const world = World.create({ seed: "surface-clothed", npcCount: 10, settings: { violence: "extreme", darkThemes: true, nudity: "full" } });
  const npc = [...world.npcs.values()].find((entry) => entry.id !== world.playerId);
  if (!npc) throw new Error("no character");

  const gate = new ContentGate({ violence: "extreme", darkThemes: true, nudity: "full" });
  const rng = createRng("surface-clothed");
  const session = createTortureSession(npc, 0, undefined, "dressed");
  assert.ok(coverageAt(session.garments, "chest") > 0.5);

  const first = applyAct(session, gate, { kind: "cut", region: "chest", depth: 0.8, tool: "blade" }, 0, rng);
  assert.ok(first.summary.includes("clothing"), first.summary);

  for (let pass = 0; pass < 6; pass += 1) {
    applyAct(session, gate, { kind: "cutClothing", region: "chest", tool: "scalpel" }, 0, rng);
  }
  assert.equal(coverageAt(session.garments, "chest"), 0);
});
