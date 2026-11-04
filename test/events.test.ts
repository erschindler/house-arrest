import assert from "node:assert/strict";
import test from "node:test";
import { World } from "../src/sim/world.ts";

test("content-gated events never generate while disabled", () => {
  const world = World.create({
    seed: "gated",
    npcCount: 80,
    settings: { darkThemes: false, violence: "standard" },
  });

  // Make the world as provocative as possible for the gated events.
  world.player.paranoia = 70;
  world.player.guilt = 70;
  for (const npc of world.npcs.values()) {
    if (npc.id === world.playerId) continue;
    world.relationships.apply(npc.id, world.playerId, { resentment: 90 }, 0);
  }

  world.tick(1440 * 30);

  const gated = world.log.filter((entry) => entry.kind === "authority" || entry.kind === "violence");
  assert.equal(gated.length, 0, `gated events fired while disabled: ${JSON.stringify(gated.map((e) => e.summary))}`);
});

test("the event engine still produces ordinary life", () => {
  const world = World.create({ seed: "events", npcCount: 80 });
  world.tick(1440 * 30);

  const kinds = new Set(world.log.map((entry) => entry.kind));
  assert.ok(
    kinds.has("social") || kinds.has("household"),
    `expected ordinary events, got: ${[...kinds].join(", ")}`,
  );
});

test("household problems arise without being scripted", () => {
  const world = World.create({ seed: "household", npcCount: 40 });
  world.tick(1440 * 60);

  assert.ok(world.household.issues.length > 0, "a month of house upkeep should produce issues");
  assert.ok(world.houseCondition <= 100);
});
