/**
 * Runnable demonstration of the simulation core.
 *
 * This is not a game. It is the headless machinery a game would sit on top of:
 * days pass, people live their schedules, appliances fail, relationships drift,
 * rumors travel, and the consent machine can be driven end to end. Nothing here
 * produces explicit text — the adult systems are modelled as state and
 * consequence, which is what the engine actually has to guarantee.
 */

import { ContentGate, assertHardInvariants } from "./content/gate.ts";
import { PresentationGate, UE5_ASSET_MANIFEST } from "./content/presentation.ts";
import type { AssetClass } from "./content/presentation.ts";
import { devUnrestrictedSettings } from "./content/presets.ts";
import { formatClock } from "./core/clock.ts";
import { deserializeWorld, serializeWorld } from "./save/serialize.ts";
import { World } from "./sim/world.ts";
import { conditionScore } from "./sim/household.ts";
import { needComfortIndex } from "./sim/needs.ts";

function line(text = ""): void {
  console.log(text);
}

function banner(title: string): void {
  line();
  line("=".repeat(72));
  line(title);
  line("=".repeat(72));
}

function scenarioMain(): void {
  banner("1. THE WORLD RUNS ON ITS OWN");

  const world = World.create({
    seed: "house-arrest-demo",
    npcCount: 120,
    settings: {
      sexual: "explicit",
      violence: "graphic",
      darkThemes: true,
      fetishes: { powerExchange: true, bondage: true, roleplayCostume: true },
    },
  });

  line(`settings: ${world.gate.describe()}`);
  line(`population: ${world.npcs.size} characters, all adults, all fictional`);
  line(`starting balance: $${world.economy.balance}`);

  const start = performance.now();
  world.tick(1440 * 30);
  const elapsed = performance.now() - start;

  const openIssues = world.household.issues.filter((issue) => !issue.fixed).length;

  line(`30 days simulated in ${elapsed.toFixed(0)} ms (${world.log.length} logged events)`);
  line(`house condition: ${conditionScore(world.household)}/100, ${openIssues} open issue${openIssues === 1 ? "" : "s"}`);
  line(
    `player money: $${world.economy.balance}` +
      (world.economy.balance < 0 ? " (overdrawn — bills outrun income in this build; there is no job system yet)" : ""),
  );
  line();
  line("chronicle (most recent first):");

  const interesting = world.log
    .filter((entry) => entry.kind !== "gossip" && entry.kind !== "economy")
    .slice(-12)
    .reverse();

  for (const entry of interesting) {
    line(`  ${formatClock({ minutes: entry.atMinute })}  [${entry.kind}] ${entry.summary}`);
  }

  line();
  line("sample NPC lives after a month off-screen:");
  const sample = [...world.npcs.values()].filter((npc) => npc.id !== world.playerId).slice(0, 4);
  for (const npc of sample) {
    const comfort = needComfortIndex(npc);
    line(
      `  ${npc.givenName} ${npc.familyName}, ${npc.age}, ${npc.occupation} — ` +
        `comfort ${comfort.toFixed(0)}/100, mood ${npc.mood.toFixed(0)}, stress ${npc.stress.toFixed(0)}`,
    );
  }
}

function scenarioConsent(): void {
  banner("2. CONSENT IS A LIVE STATE");

  const world = World.create({
    seed: "consent-demo",
    npcCount: 24,
    settings: { sexual: "explicit", fetishes: { bondage: true, powerExchange: true } },
  });

  const other = [...world.npcs.values()].find(
    (npc) => npc.id !== world.playerId && !world.relationships.get(npc.id, world.playerId).family,
  );
  if (!other) throw new Error("no eligible partner generated");

  world.relationships.apply(world.playerId, other.id, { trust: 74, attraction: 60, familiarity: 55 }, world.clock.minutes);
  for (const npc of [world.player, other]) {
    npc.sexual.interests = ["bondage"];
    npc.sexual.curiosities = [];
    npc.sexual.hardLimits = [];
    npc.sexual.comfort = 0.6;
  }
  line(`${other.givenName} ${other.familyName}, ${other.age} — trust 74 after months of contact.`);

  const scene = world.openScene(world.playerId, other.id);
  line(`opened: ${scene.state}`);

  const outcome = scene.negotiate({
    categories: ["bondage", "humiliation"],
    intensityCeiling: 9,
    safewords: ["red"],
    conditions: [],
  });
  line(`negotiated: ceiling ${outcome.accepted.intensityCeiling}/10, accepted ${outcome.accepted.categories.length} category/categories`);
  for (const refusal of outcome.refusals) line(`  refused — ${refusal.category}: ${refusal.reason}`);
  for (const condition of outcome.accepted.conditions) line(`  condition: ${condition}`);

  try {
    scene.begin();
  } catch (error) {
    line(`begin before affirmation: blocked (${(error as Error).message})`);
  }

  scene.affirm(world.playerId);
  scene.affirm(other.id);
  scene.begin();
  line(`begun: ${scene.describe()}`);

  scene.requestIntensity(4);
  line(`escalated: ${scene.describe()}`);

  try {
    scene.requestIntensity(12);
  } catch (error) {
    line(`escalation beyond the ceiling: blocked (${(error as Error).message})`);
  }

  scene.safeword(other.id, "red");
  line(`after safeword: ${scene.state} — ${scene.endedReason}`);

  try {
    scene.requestIntensity(5);
  } catch (error) {
    line(`attempt to continue after a stop: blocked (${(error as Error).message})`);
  }

  const rel = world.relationships.get(world.playerId, other.id);
  line(`relationship after the stop: trust ${rel.axes.trust.toFixed(0)}, satisfaction ${rel.axes.satisfaction.toFixed(0)}`);

  line();
  line("a scene that ends by itself, because consent is re-checked every beat:");
  const second = [...world.npcs.values()].find(
    (npc) => npc.id !== world.playerId && npc.id !== other.id && !world.relationships.get(npc.id, world.playerId).family,
  );
  if (second) {
    world.player.stress = 95;
    second.stress = 95;
    world.player.sexual.comfort = 0.5;
    second.sexual.comfort = 0.5;
    world.relationships.apply(world.playerId, second.id, { trust: 12, attraction: 20 }, world.clock.minutes);
    const low = world.openScene(world.playerId, second.id);
    low.negotiate({ categories: [], intensityCeiling: 8, safewords: [], conditions: [] });
    low.affirm(world.playerId);
    low.affirm(second.id);
    low.begin();
    low.requestIntensity(Math.min(3, low.terms?.intensityCeiling ?? 1));
    let beats = 0;
    while (low.state === "active" && beats < 200) {
      low.tick(world.rng);
      beats += 1;
    }
    line(`  ${second.givenName}: state ${low.state} after ${beats} beat(s) — ${low.endedReason}`);
    line(`  willingness at the time: ${low.willingness().toFixed(2)} (stressed, low trust, high intensity)`);
  }

  line();
  line("content toggles are live: switching explicit content off ends any running scene");
  const third = [...world.npcs.values()].find(
    (npc) => npc.id !== world.playerId && npc.id !== other.id && !world.relationships.get(npc.id, world.playerId).family,
  );
  if (third) {
    world.player.sexual.comfort = 0.6;
    third.sexual.comfort = 0.6;
    world.relationships.apply(world.playerId, third.id, { trust: 80, attraction: 55 }, world.clock.minutes);
    const live = world.openScene(world.playerId, third.id);
    live.negotiate({ categories: [], intensityCeiling: 5, safewords: [], conditions: [] });
    live.affirm(world.playerId);
    live.affirm(third.id);
    live.begin();
    world.gate.setSettings({ sexual: "suggestive" });
    live.tick(world.rng);
    line(`  state after toggle: ${live.state} — ${live.endedReason}`);
    world.gate.setSettings({ sexual: "explicit" });
  }
}

function scenarioSaveLoad(): void {
  banner("3. THE WHOLE WORLD SAVES AND RESTORES");

  const original = World.create({ seed: "save-demo", npcCount: 60 });
  original.tick(1440 * 5);
  const saved = serializeWorld(original.snapshot());
  const before = original.hash();

  const restored = World.fromSnapshot(deserializeWorld(saved));
  const after = restored.hash();

  line(`world hash before save: ${before}`);
  line(`world hash after load:  ${after}`);
  line(`identical: ${before === after ? "yes" : "NO"}`);
  line(`save size: ${(saved.length / 1024).toFixed(1)} KiB for 61 characters, ${original.memories.count()} memories, ${original.log.length} log entries`);

  original.tick(1440 * 5);
  restored.tick(1440 * 5);
  line(`after 5 more days both worlds: ${original.hash()} / ${restored.hash()} — ${original.hash() === restored.hash() ? "still identical" : "DIVERGED"}`);
}

function scenarioPerformance(): void {
  banner("4. OFF-SCREEN SIMULATION COST");

  for (const count of [120, 400]) {
    const world = World.create({ seed: `perf-${count}`, npcCount: count });
    const start = performance.now();
    world.tick(1440 * 30);
    const elapsed = performance.now() - start;
    const perMinute = elapsed / (1440 * 30);
    const tiers = world.tierCounts();
    line(
      `${count} characters × 30 days: ${elapsed.toFixed(0)} ms total, ` +
        `${perMinute.toFixed(3)} ms per simulated minute`,
    );
    line(`  tiers — full: ${tiers.full}, coarse: ${tiers.coarse}, statistical: ${tiers.statistical}`);
  }
  line();
  line("All characters keep living at every tier: needs decay, schedules advance,");
  line("moods drift. The tier only controls how often the same functions run.");
}

function scenarioContentFramework(devMode: boolean): void {
  banner("5. CONTENT FRAMEWORK FOR UE5 ASSETS");

  const baseline = new PresentationGate(new ContentGate());
  const unrestricted = new PresentationGate(new ContentGate(devUnrestrictedSettings()));

  line(`manifest entries: ${UE5_ASSET_MANIFEST.length}`);
  line(`loadable at default settings: ${baseline.available().length}`);
  line(`loadable with the dev preset ${devMode ? "(active)" : "(inactive — pass --dev-unrestricted)"}: ${unrestricted.available().length}`);
  line();
  line("per asset class               default   all-limits-off");

  const probe: AssetClass[] = [
    "gore.blood.decal",
    "gore.organ.decal",
    "gore.dismemberment",
    "violence.torture.sequence",
    "death.agony.animation",
    "body.nudity.full",
    "intimacy.animation.explicit",
    "kink.prop.bondage",
  ];
  for (const assetClass of probe) {
    const left = baseline.allows(assetClass) ? "on" : "off";
    const right = unrestricted.allows(assetClass) ? "on" : "off";
    line(`  ${assetClass.padEnd(28)}  ${left.padEnd(8)}  ${right}`);
  }

  line();
  line("The dev preset raises content limits only. These are code, not settings:");
  for (const subject of [
    { id: "minor", age: 17, isMinor: true },
    { id: "relative", age: 41, isMinor: false, isFamilyOfPlayer: true },
  ]) {
    try {
      assertHardInvariants(subject, "sexual");
      line(`  BUG: ${subject.id} was allowed through`);
    } catch (error) {
      line(`  blocked: ${(error as Error).message}`);
    }
  }
}

function main(): void {
  const devMode = process.argv.includes("--dev-unrestricted");

  line("HOUSE ARREST — simulation core");
  line("Headless, deterministic, content-neutral. No explicit text is produced.");
  scenarioMain();
  scenarioConsent();
  scenarioSaveLoad();
  scenarioPerformance();
  scenarioContentFramework(devMode);
  line();
  line("Done.");
}

main();
