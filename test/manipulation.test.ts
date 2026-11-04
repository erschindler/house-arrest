import assert from "node:assert/strict";
import test from "node:test";
import type { Approach } from "../src/sim/manipulation.ts";
import { World } from "../src/sim/world.ts";

function officers(world: World) {
  return [...world.npcs.values()].filter((npc) => world.assess(npc.id).police);
}

function firstTarget(world: World) {
  const target = [...world.npcs.values()].find(
    (npc) => npc.id !== world.playerId && !world.relationships.get(npc.id, world.playerId).family,
  );
  if (!target) throw new Error("no eligible character generated");
  return target;
}

test("police exist as people with their own leverage", () => {
  const world = World.create({ seed: "manip-officer", npcCount: 24 });
  const list = officers(world);
  assert.ok(list.length >= 2, `${list.length} officers`);

  const officer = list[0];
  if (!officer) throw new Error("no officer");
  const assessment = world.assess(officer.id);
  assert.ok(assessment.leverage.length > 0);
  assert.ok(assessment.resistance > 0);
  assert.equal(assessment.police, true);
});

test("pressure compounds across attempts", () => {
  const world = World.create({ seed: "manip-pressure", npcCount: 20 });
  const approaches: Approach[] = ["threat", "charm", "blackmail", "burden", "favour"];

  // A person with no lever at all is genuinely immune to pressure — their floor is
  // zero and stays there. The mechanic is about wearing down someone who has one.
  let targetId: string | null = null;
  let approach: Approach = "threat";
  let first = 0;

  for (const npc of world.npcs.values()) {
    if (npc.id === world.playerId) continue;
    if (world.relationships.get(npc.id, world.playerId).family) continue;

    for (const candidate of approaches) {
      const outcome = world.press(npc.id, candidate);
      if (outcome.compliance > 0.1) {
        targetId = npc.id;
        approach = candidate;
        first = outcome.compliance;
        break;
      }
    }
    if (targetId) break;
  }

  if (!targetId) throw new Error("nobody in the world had a usable lever");

  let last = first;
  for (let attempt = 0; attempt < 5; attempt += 1) last = world.press(targetId, approach).compliance;

  assert.ok(last > first, `${first} -> ${last}`);
});

test("badge recruitment is blocked without dark themes", () => {
  const world = World.create({ seed: "manip-gate", npcCount: 20, settings: { darkThemes: false } });
  const officer = officers(world)[0];
  if (!officer) throw new Error("no officer");

  for (let attempt = 0; attempt < 6; attempt += 1) world.press(officer.id, "threat");
  const result = world.recruit(officer.id, "badge");

  assert.equal(result.ok, false);
  assert.match(result.reason, /dark themes/);
});

test("an officer can be turned, and can take the heat off", () => {
  const world = World.create({ seed: "manip-cover", npcCount: 20, settings: { darkThemes: true } });
  const officer = officers(world)[0];
  if (!officer) throw new Error("no officer");

  let recruited = false;
  for (let attempt = 0; attempt < 10 && !recruited; attempt += 1) {
    world.press(officer.id, "threat");
    recruited = world.recruit(officer.id, "badge").ok;
  }
  if (!recruited) throw new Error("the officer never turned");

  world.investigation.heat = 40;
  const order = world.order(officer.id, "coverTracks");

  assert.equal(order.ok, true);
  assert.ok(world.investigation.heat < 40, `heat was ${world.investigation.heat}`);
});

test("delivery is refused until the room exists", () => {
  const world = World.create({ seed: "manip-delivery", npcCount: 20, settings: { darkThemes: true } });
  const officer = officers(world)[0];
  if (!officer) throw new Error("no officer");

  let recruited = false;
  for (let attempt = 0; attempt < 10 && !recruited; attempt += 1) {
    world.press(officer.id, "threat");
    recruited = world.recruit(officer.id, "badge").ok;
  }
  if (!recruited) throw new Error("the officer never turned");

  const order = world.order(officer.id, "deliverVictim");
  assert.equal(order.ok, false);
  assert.match(order.summary, /nowhere to put them/);
});

test("suspicion eventually turns an accomplice", () => {
  const world = World.create({ seed: "manip-betrayal", npcCount: 20, settings: { darkThemes: true } });
  const officer = officers(world)[0];
  if (!officer) throw new Error("no officer");

  let recruited = false;
  for (let attempt = 0; attempt < 10 && !recruited; attempt += 1) {
    world.press(officer.id, "threat");
    recruited = world.recruit(officer.id, "badge").ok;
  }
  if (!recruited) throw new Error("the officer never turned");

  for (let day = 0; day < 20; day += 1) world.manipulation.daily(100);
  const betrayals = world.manipulation.takeBetrayals();

  assert.ok(betrayals.length >= 1, "nobody turned");
  assert.equal(world.manipulation.accomplicesList()[0]?.status, "gone");
});
