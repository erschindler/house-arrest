import assert from "node:assert/strict";
import test from "node:test";
import { ContentGate } from "../src/content/gate.ts";
import { createRng } from "../src/core/rng.ts";
import { BUILD_ORDER } from "../src/sim/facility.ts";
import {
  DIGITS,
  LIMB_IDS,
  ORGAN_IDS,
  advanceTorture,
  applyAct,
  createTortureSession,
  stabilise,
} from "../src/sim/torture.ts";
import { World } from "../src/sim/world.ts";

function buildRoom(world: World): void {
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

function prepareWorld(seed: string, violence: "graphic" | "extreme" = "extreme") {
  const world = World.create({
    seed,
    npcCount: 12,
    settings: { violence, darkThemes: true, nudity: "full" },
  });
  const victim = [...world.npcs.values()].find((npc) => npc.alive && npc.homeLocation === "elsewhere");
  if (!victim) throw new Error("no eligible character generated");

  buildRoom(world);
  if (!world.custody.take(victim.id)) throw new Error("could not take the victim");
  return { world, victim };
}

test("the detailed body starts whole", () => {
  const world = World.create({ seed: "torture-whole", npcCount: 8 });
  const victim = [...world.npcs.values()].find((npc) => npc.id !== world.playerId);
  if (!victim) throw new Error("no character");

  const session = createTortureSession(victim, 0);
  assert.equal(ORGAN_IDS.every((organ) => session.organs[organ].integrity === 1), true);
  assert.equal(LIMB_IDS.every((limb) => session.limbs[limb].attached), true);
  assert.equal(DIGITS.every((digit) => session.nails[digit] === false), true);
  assert.equal(session.vitals.blood > 0, true);
});

test("content gating refuses the act rather than softening it", () => {
  const { world, victim } = prepareWorld("torture-gate", "graphic");
  world.beginSession(victim.id);

  assert.throws(
    () => world.tortureAct({ kind: "nail", digit: "leftThumb", tool: "pliers" }),
    /needs violence at "extreme"/,
  );

  assert.equal(world.torture?.nails.leftThumb, false);
});

test("a stab can reach the heart and end it", () => {
  const { world, victim } = prepareWorld("torture-heart");
  world.beginSession(victim.id);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    world.tortureAct({ kind: "stab", region: "chest", depth: 1, tool: "drill" });
    if (world.torture?.ended) break;
  }

  const session = world.torture;
  if (!session) throw new Error("no session");
  assert.equal(session.ended, true, "a chest full of deep stab wounds should be fatal");
  assert.ok(session.causeOfDeath);
  assert.equal(victim.alive, false);
  assert.ok(world.investigation.evidence.some((entry) => entry.kind === "body"));
});

test("cautery closes a bleed and buys an infection", () => {
  const { world, victim } = prepareWorld("torture-cautery");
  world.beginSession(victim.id);

  world.tortureAct({ kind: "cut", region: "leftThigh", depth: 1, tool: "blade" });
  const wound = world.torture?.wounds[0];
  if (!wound) throw new Error("no wound was created");

  const before = wound.bleeding;
  world.tortureAct({ kind: "cauterize", woundId: wound.id });

  assert.ok(wound.bleeding < before * 0.2, `${before} -> ${wound.bleeding}`);
  assert.ok((world.torture?.vitals.infection ?? 0) > 0);
});

test("a tourniquet stops the bleed but starts a clock", () => {
  const world = World.create({ seed: "torture-tourniquet", npcCount: 8 });
  const npc = [...world.npcs.values()].find((entry) => entry.id !== world.playerId);
  if (!npc) throw new Error("no character");

  const gate = new ContentGate({ violence: "extreme", darkThemes: true });
  const cut: Parameters<typeof applyAct>[2] = { kind: "cut", region: "leftThigh", depth: 1, tool: "blade" };

  const free = createTortureSession(npc, 0);
  applyAct(free, gate, cut, 0, createRng("free"));
  const start = free.vitals.blood;
  advanceTorture(free, 5, 5);
  const freeLoss = start - free.vitals.blood;

  const tied = createTortureSession(npc, 0);
  applyAct(tied, gate, cut, 0, createRng("tied"));
  applyAct(tied, gate, { kind: "tourniquet", limb: "leftLeg" }, 0, createRng("tied"));
  const tiedStart = tied.vitals.blood;
  advanceTorture(tied, 5, 5);
  const tiedLoss = tiedStart - tied.vitals.blood;

  assert.ok(freeLoss > 0);
  assert.ok(tiedLoss < freeLoss * 0.2, `free ${freeLoss}, tied ${tiedLoss}`);
});

test("an unrestrained victim can get free", () => {
  const world = World.create({ seed: "torture-escape", npcCount: 8 });
  const npc = [...world.npcs.values()].find((entry) => entry.id !== world.playerId);
  if (!npc) throw new Error("no character");

  const gate = new ContentGate({ violence: "extreme", darkThemes: true });
  const rng = createRng("torture-escape");
  const session = createTortureSession(npc, 0, { wrists: false });

  for (let attempt = 0; attempt < 200 && !session.ended; attempt += 1) {
    applyAct(session, gate, { kind: "cut", region: "leftForearm", depth: 0.4, tool: "scalpel" }, 0, rng);
  }

  assert.equal(session.ended, true);
  assert.equal(session.causeOfDeath, null);
});

test("stabilising stops the bleeding before it kills", () => {
  const world = World.create({ seed: "torture-stabilise", npcCount: 8 });
  const npc = [...world.npcs.values()].find((entry) => entry.id !== world.playerId);
  if (!npc) throw new Error("no character");

  const gate = new ContentGate({ violence: "extreme", darkThemes: true });
  const rng = createRng("torture-stabilise");
  const session = createTortureSession(npc, 0);

  for (const region of ["leftThigh", "rightThigh", "abdomen"] as const) {
    applyAct(session, gate, { kind: "cut", region, depth: 0.9, tool: "blade" }, 0, rng);
  }

  const treated = stabilise(session);
  assert.ok(treated >= 3);
  advanceTorture(session, 10, 10);
  assert.equal(session.ended, false);
});

test("the same session is deterministic", () => {
  const first = prepareWorld("torture-deterministic");
  const second = prepareWorld("torture-deterministic");

  for (const { world, victim } of [first, second]) {
    world.beginSession(victim.id, "undressed");
    world.tortureAct({ kind: "cut", region: "leftForearm", depth: 0.5, tool: "scalpel" });
    world.tortureAct({ kind: "tourniquet", limb: "leftLeg" });
    world.tick(5);
  }

  assert.equal(first.world.hash(), second.world.hash());
});
