import assert from "node:assert/strict";
import test from "node:test";
import { assignTiers, countTiers } from "../src/sim/lod.ts";
import { World } from "../src/sim/world.ts";

test("tier assignment never exceeds the budget", () => {
  const world = World.create({ seed: "lod", npcCount: 60 });
  const npcs = [...world.npcs.values()];
  const assignment = assignTiers({
    npcs,
    budget: { full: 5, coarse: 10 },
    isOnProperty: (npc) => Number(npc.id.split("-")[1] ?? 0) % 3 === 0,
    isExpected: (npc) => Number(npc.id.split("-")[1] ?? 0) % 2 === 0,
  });
  const counts = countTiers(assignment);
  assert.ok(counts.full <= 5, `full tier exceeded budget: ${counts.full}`);
  assert.ok(counts.coarse <= 10, `coarse tier exceeded budget: ${counts.coarse}`);
  assert.ok(counts.statistical > 0, "most of the city should be on the cheap tier");
  assert.equal(assignment.size, npcs.length, "every character must be assigned a tier");
});

test("off-screen characters keep living", () => {
  const world = World.create({ seed: "offscreen", npcCount: 40 });
  const npc = [...world.npcs.values()].find((candidate) => candidate.id !== world.playerId);
  if (!npc) throw new Error("no npc generated");

  const needsBefore = { ...npc.needs };
  const lastBefore = npc.lastSimulatedMinute;
  world.tick(1440 * 2);

  assert.ok(npc.lastSimulatedMinute > lastBefore, "an off-screen character must still be simulated");
  assert.notDeepEqual(npc.needs, needsBefore, "needs must decay off-screen");
});

test("a month of 400 characters stays inside a simulation budget", () => {
  const world = World.create({ seed: "perf", npcCount: 400 });
  const started = performance.now();
  world.tick(1440 * 30);
  const elapsed = performance.now() - started;
  console.log(`    400 characters x 30 days: ${elapsed.toFixed(0)} ms`);
  assert.ok(elapsed < 30000, `30 simulated days took ${elapsed.toFixed(0)} ms`);
});
