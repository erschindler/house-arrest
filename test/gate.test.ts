import assert from "node:assert/strict";
import test from "node:test";
import { ContentGate, assertHardInvariants } from "../src/content/gate.ts";

test("the sexual toggle is monotonic", () => {
  const off = new ContentGate({ sexual: "off" });
  const suggestive = new ContentGate({ sexual: "suggestive" });
  const explicit = new ContentGate({ sexual: "explicit" });

  assert.equal(off.allows({ kind: "sexual", level: "suggestive" }), false);
  assert.equal(off.allows({ kind: "sexual", level: "explicit" }), false);
  assert.equal(suggestive.allows({ kind: "sexual", level: "suggestive" }), true);
  assert.equal(suggestive.allows({ kind: "sexual", level: "explicit" }), false);
  assert.equal(explicit.allows({ kind: "sexual", level: "explicit" }), true);
});

test("kink needs explicit content plus the per-category toggle", () => {
  const gate = new ContentGate({ sexual: "explicit" });
  assert.equal(gate.allows({ kind: "fetish", category: "bondage", intensity: 3 }), false);

  gate.setFetish("bondage", true);
  assert.equal(gate.allows({ kind: "fetish", category: "bondage", intensity: 3 }), true);

  gate.setSettings({ sexual: "suggestive" });
  assert.equal(gate.allows({ kind: "fetish", category: "bondage", intensity: 3 }), false);
});

test("violence levels and dark themes are respected", () => {
  const standard = new ContentGate({ violence: "standard" });
  assert.equal(standard.allows({ kind: "violence", level: "graphic" }), false);
  assert.equal(standard.allows({ kind: "dark" }), false);

  const extreme = new ContentGate({ violence: "extreme", darkThemes: true });
  assert.equal(extreme.allows({ kind: "violence", level: "graphic" }), true);
  assert.equal(extreme.allows({ kind: "violence", level: "extreme" }), true);
  assert.equal(extreme.allows({ kind: "dark" }), true);
});

test("a default save is conservative", () => {
  const gate = new ContentGate();
  assert.equal(gate.intimacyPossible, false);
  assert.equal(gate.settings.violence, "standard");
  assert.equal(gate.settings.darkThemes, false);
});

test("hard invariants cannot be enabled by any setting", () => {
  const everything = new ContentGate({
    sexual: "explicit",
    violence: "extreme",
    darkThemes: true,
    fetishes: { bondage: true, humiliation: true, groupScenes: true },
  });
  assert.equal(everything.allows({ kind: "sexual", level: "explicit" }), true);

  assert.throws(
    () => assertHardInvariants({ id: "x", age: 17, isMinor: true }, "sexual"),
    /not an adult/,
  );
  assert.throws(
    () => assertHardInvariants({ id: "y", age: 40, isMinor: false, isFamilyOfPlayer: true }, "sexual"),
    /family relationships are never romantic/,
  );
  assert.throws(
    () => assertHardInvariants({ id: "z", age: 12, isMinor: true }, "violent"),
    /not an adult/,
  );
  // Adults unrelated to the player pass.
  assertHardInvariants({ id: "ok", age: 34, isMinor: false }, "sexual");
});
