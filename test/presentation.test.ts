import assert from "node:assert/strict";
import test from "node:test";
import { ContentGate, assertHardInvariants } from "../src/content/gate.ts";
import { PresentationGate, UE5_ASSET_MANIFEST } from "../src/content/presentation.ts";
import type { AssetClass } from "../src/content/presentation.ts";
import { DEV_PRESETS_ENABLED, devUnrestrictedSettings, presetFor } from "../src/content/presets.ts";
import { RelationshipStore } from "../src/sim/relationship.ts";

test("default settings load no gore, nudity or intimacy assets", () => {
  const gate = new PresentationGate(new ContentGate());

  assert.equal(gate.available().length, 0);
  assert.equal(gate.report().length, UE5_ASSET_MANIFEST.length);
  assert.ok(gate.report().every((entry) => entry.missing.length > 0));
});

test("each level opens exactly the classes it should", () => {
  const graphic = new PresentationGate(new ContentGate({ violence: "graphic" }));
  assert.equal(graphic.allows("gore.blood.decal"), true);
  assert.equal(graphic.allows("gore.dismemberment"), false, "dismemberment is extreme only");
  assert.equal(graphic.allows("gore.decomposition.stage"), false, "needs dark themes too");

  const extreme = new PresentationGate(new ContentGate({ violence: "extreme", darkThemes: true }));
  assert.equal(extreme.allows("gore.dismemberment"), true);
  assert.equal(extreme.allows("gore.decomposition.stage"), true);

  const intimacy = new PresentationGate(new ContentGate({ sexual: "explicit" }));
  assert.equal(intimacy.allows("intimacy.animation.explicit"), false, "explicit intimacy needs full nudity too");
  const full = new PresentationGate(new ContentGate({ sexual: "explicit", nudity: "full" }));
  assert.equal(full.allows("intimacy.animation.explicit"), true);
});

test("the dev preset opens every asset class in the manifest", () => {
  const gate = new PresentationGate(new ContentGate(devUnrestrictedSettings()));

  assert.equal(gate.available().length, UE5_ASSET_MANIFEST.length);
  assert.equal(gate.allows("gore.dismemberment"), true);
  assert.equal(gate.allows("gore.decomposition.stage"), true);
  assert.equal(gate.allows("intimacy.animation.explicit"), true);
  assert.equal(gate.allows("kink.prop.bondage"), true);
});

test("unknown asset classes are never loadable", () => {
  const gate = new PresentationGate(new ContentGate(devUnrestrictedSettings()));
  assert.equal(gate.allows("gore.unregistered" as unknown as AssetClass), false);
});

test("the dev preset cannot reach the hard invariants", () => {
  const settings = devUnrestrictedSettings();
  assert.equal(settings.sexual, "explicit");
  assert.equal(settings.nudity, "full");
  assert.equal(settings.violence, "extreme");
  assert.equal(settings.darkThemes, true);

  assert.throws(() => assertHardInvariants({ id: "minor", age: 17, isMinor: true }, "sexual"), /not an adult/);
  assert.throws(() => assertHardInvariants({ id: "minor", age: 15, isMinor: true }, "violent"), /not an adult/);
  assert.throws(
    () => assertHardInvariants({ id: "relative", age: 40, isMinor: false, isFamilyOfPlayer: true }, "sexual"),
    /family relationships are never romantic/,
  );

  const store = new RelationshipStore();
  store.markFamily("a", "b");
  assert.throws(() => store.apply("a", "b", { romanticInterest: 10 }), /family pair/);
});

test("the dev preset is gated by its removal flag", () => {
  if (!DEV_PRESETS_ENABLED) {
    assert.throws(() => presetFor("devUnrestricted"), /disabled in this build/);
    return;
  }
  assert.equal(presetFor("devUnrestricted").settings.violence, "extreme");
  assert.equal(presetFor("safeDefault").settings.violence, "standard");
});
