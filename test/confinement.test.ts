import assert from "node:assert/strict";
import test from "node:test";
import { Confinement } from "../src/sim/confinement.ts";
import { evaluateEnding } from "../src/sim/goals.ts";
import { World } from "../src/sim/world.ts";
import { deserializeWorld, serializeWorld } from "../src/save/serialize.ts";

test("a new agoraphobic run starts afraid and inside", () => {
  const world = World.create({ seed: "conf-fresh", npcCount: 8 });
  assert.equal(world.confinement.mode, "agoraphobic");
  assert.ok(world.confinement.fear > 30, `fear was ${world.confinement.fear}`);
  assert.equal(world.confinement.outsideMinutes, 0);
});

test("walking to the door at low resolve eventually panics", () => {
  const world = World.create({ seed: "conf-panic", npcCount: 8 });
  let panicked = false;
  for (let attempt = 0; attempt < 3 && !panicked; attempt += 1) {
    panicked = world.approachDoor(1, 0).panicked;
  }
  assert.equal(panicked, true);
  assert.equal(world.confinement.panicAttacks > 0, true);
  assert.equal(world.confinement.outsideMinutes, 0);
});

test("exposure practice lowers fear and eventually opens the door", () => {
  const conf = new Confinement({ mode: "agoraphobic" });
  const before = conf.fear;

  for (let session = 0; session < 40; session += 1) {
    conf.practiseExposure(30, session * 1440);
    conf.tickMinute(120);
  }

  assert.ok(conf.fear < before, `fear went ${before} -> ${conf.fear}`);
  const out = conf.stepOutside(30, 40 * 1440);
  assert.equal(out.crossed, true, out.summary);
});

test("legal confinement records the breach instead of panicking", () => {
  const world = World.create({ seed: "conf-legal", npcCount: 8, confinement: "legal" });
  const before = world.investigation.heat;
  const out = world.stepOutside(60);

  assert.equal(out.crossed, true);
  assert.equal(out.trippedMonitor, true);
  assert.ok(world.investigation.heat > before);
});

test("fear compounds during a long stretch indoors", () => {
  const conf = new Confinement({ mode: "agoraphobic" });
  const before = conf.fear;
  for (let day = 0; day < 20; day += 1) conf.daily(day);
  assert.ok(conf.fear > before, `fear went ${before} -> ${conf.fear}`);
  assert.ok(conf.insideStreak >= 20);
});

test("the shut-in ending needs sustained fear, not one bad day", () => {
  const base = {
    balance: 500,
    houseCondition: 80,
    heat: 0,
    employed: true,
    reputation: 0,
    day: 30,
    relationships: [{ familiarity: 60, trust: 60, friendship: 50 }],
  };

  const collapsed = evaluateEnding({
    ...base,
    confinement: { mode: "agoraphobic", fear: 95, insideStreak: 25, outsideMinutes: 0 },
  });
  assert.equal(collapsed?.ending, "shutIn");

  const oneBadDay = evaluateEnding({
    ...base,
    confinement: { mode: "agoraphobic", fear: 95, insideStreak: 2, outsideMinutes: 0 },
  });
  assert.notEqual(oneBadDay?.ending, "shutIn");
});

test("confinement survives a save and restore", () => {
  const world = World.create({ seed: "conf-save", npcCount: 8 });
  world.approachDoor(1, 0);
  const saved = serializeWorld(world.snapshot());
  const restored = World.fromSnapshot(deserializeWorld(saved));

  assert.equal(restored.confinement.fear, world.confinement.fear);
  assert.equal(restored.confinement.panicAttacks, world.confinement.panicAttacks);
});
