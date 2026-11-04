import assert from "node:assert/strict";
import test from "node:test";
import { DARK_LISTINGS } from "../src/sim/net.ts";
import { World } from "../src/sim/world.ts";

test("the default settings refuse an explicit post", () => {
  const world = World.create({ seed: "net-default", npcCount: 10 });
  assert.throws(() => world.share("explicitPhoto"), /content settings/);
});

test("the same post is allowed once the settings permit it", () => {
  const world = World.create({
    seed: "net-allowed",
    npcCount: 10,
    settings: { sexual: "explicit", nudity: "full", fetishes: { exhibitionism: true } },
  });
  const post = world.share("explicitPhoto");
  assert.equal(post.kind, "explicitPhoto");
  assert.ok(post.tags.includes("explicit"));
});

test("posting raises exposure and a feed accumulates", () => {
  const world = World.create({ seed: "net-exposure", npcCount: 20 });
  assert.equal(world.net.exposure, 0);

  world.share("status", "Day one.");
  assert.ok(world.net.exposure > 0);

  world.tick(1440 * 2);
  assert.ok(world.feed(5).length > 0, "NPCs should have posted over two days");
});

test("listings are unavailable unless dark themes are on", () => {
  const off = World.create({ seed: "net-dark-off", npcCount: 10 });
  assert.equal(off.net.availableListings().length, 0);
  assert.throws(() => off.net.purchase("burner", off.economy, off.investigation), /dark themes/);

  const on = World.create({ seed: "net-dark-on", npcCount: 10, settings: { darkThemes: true } });
  assert.equal(on.net.availableListings().length, DARK_LISTINGS.length);
});

test("buying a handset spends money and lowers exposure", () => {
  const world = World.create({ seed: "net-buy", npcCount: 10, settings: { darkThemes: true } });
  world.share("status");
  const beforeBalance = world.economy.balance;
  const beforeExposure = world.net.exposure;

  const result = world.net.purchase("burner", world.economy, world.investigation);

  assert.equal(result.ok, true);
  assert.equal(world.economy.balance, beforeBalance - 120);
  assert.ok(world.net.exposure < beforeExposure);
});

test("disposal refuses when there is nothing to remove, and charges nothing", () => {
  const world = World.create({ seed: "net-disposal", npcCount: 10, settings: { darkThemes: true } });
  const before = world.economy.balance;

  const result = world.net.purchase("disposal", world.economy, world.investigation);

  assert.equal(result.ok, false);
  assert.equal(world.economy.balance, before);
});

test("paperwork leaves a document that points at the player", () => {
  const world = World.create({ seed: "net-docs", npcCount: 10, settings: { darkThemes: true } });

  const result = world.net.purchase("documents", world.economy, world.investigation);

  assert.equal(result.ok, true);
  assert.ok(world.investigation.evidence.some((entry) => entry.kind === "document" && entry.subject === world.playerId));
});

test("the net survives a save and restore", () => {
  const world = World.create({ seed: "net-save", npcCount: 12 });
  world.share("complaint", "The boiler again.");
  world.tick(300);

  const restored = World.fromSnapshot(world.snapshot());

  assert.equal(restored.net.posts.length, world.net.posts.length);
  assert.equal(restored.net.exposure, world.net.exposure);
  assert.equal(restored.hash(), world.hash());
});
