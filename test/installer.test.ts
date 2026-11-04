import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentGate } from "../src/content/gate.ts";
import { devUnrestrictedSettings } from "../src/content/presets.ts";
import { loadLibrary } from "../src/tools/library.ts";
import { buildReport } from "../src/tools/resolver.ts";
import { emitInstall } from "../src/tools/ue5.ts";

const LIBRARY = "fixtures/library";

function matureGate(): ContentGate {
  return new ContentGate({ sexual: "explicit", nudity: "full", violence: "graphic", darkThemes: true });
}

test("the library scans deterministically", () => {
  const first = loadLibrary(LIBRARY);
  const second = loadLibrary(LIBRARY);

  assert.ok(first.assets.length > 0);
  assert.deepEqual(
    first.assets.map((asset) => asset.id),
    second.assets.map((asset) => asset.id),
  );
});

test("default settings gate every class rather than reporting gaps", () => {
  const report = buildReport(new ContentGate(), loadLibrary(LIBRARY));

  assert.equal(report.totals.classes, report.totals.gated);
  assert.equal(report.totals.resolved, 0);
  assert.equal(report.totals.unresolved, 0, "disabled content must never be reported as missing art");
});

test("mature settings resolve graphic classes and gate extreme ones", () => {
  const report = buildReport(matureGate(), loadLibrary(LIBRARY));
  const byClass = new Map(report.resolutions.map((resolution) => [resolution.assetClass, resolution]));

  assert.equal(byClass.get("gore.blood.decal")?.status, "resolved");
  assert.equal(byClass.get("gore.organ.decal")?.status, "gated");
  assert.equal(byClass.get("kink.prop.bondage")?.status, "gated");
  assert.equal(report.totals.unresolved, 0);
});

test("the dev preset resolves every class in the fixture library", () => {
  const report = buildReport(new ContentGate(devUnrestrictedSettings()), loadLibrary(LIBRARY));

  assert.equal(report.totals.unresolved, 0, `unresolved: ${report.blocking.join(" | ")}`);
  assert.equal(report.totals.resolved, report.totals.classes);
});

test("constraint violations are recorded rather than silently used", () => {
  const report = buildReport(new ContentGate(devUnrestrictedSettings()), loadLibrary(LIBRARY));
  const blood = report.resolutions.find((resolution) => resolution.assetClass === "gore.blood.decal");

  assert.ok(blood);
  assert.ok(blood?.primary);
  assert.equal(blood?.primary?.id, "/Game/Fab/PracticalFX/SM_BloodPool_A");
  assert.ok(
    blood?.rejected.some((rejection) => rejection.reason.includes("triangle")),
    "the oversized decal should be rejected with a reason",
  );
});

test("the emitter writes a registry containing only permitted classes", () => {
  const report = buildReport(matureGate(), loadLibrary(LIBRARY));
  const dir = "artifacts/installer-test";
  const written = emitInstall(dir, report);

  assert.ok(written.length >= 5);

  const registry = JSON.parse(readFileSync(join(dir, "HASContent/Data/HASAssetRegistry.json"), "utf8")) as {
    entries: { assetClass: string; path: string; requires: unknown[] }[];
  };
  const classes = registry.entries.map((entry) => entry.assetClass);

  assert.ok(classes.includes("gore.blood.decal"));
  assert.ok(!classes.includes("gore.organ.decal"), "a gated class must not reach the engine registry");

  const plan = readFileSync(join(dir, "Docs/FAB_ACQUISITION_PLAN.md"), "utf8");
  assert.match(plan, /Gated/);
  assert.match(plan, /gore\.organ\.decal/);
});

test("an empty library reports every class as a gap, with search terms", () => {
  const report = buildReport(new ContentGate(devUnrestrictedSettings()), loadLibrary("fixtures/library-empty"));

  assert.equal(report.totals.resolved, 0);
  assert.equal(report.totals.unresolved, report.totals.classes);
  assert.equal(report.blocking.length, report.totals.classes);
  assert.ok(
    report.blocking.every((line) => line.includes("search:")),
    "every gap must tell the art team what to search for",
  );
});

test("emitted output is byte-identical across runs", () => {
  const report = buildReport(new ContentGate(devUnrestrictedSettings()), loadLibrary(LIBRARY));
  const dirA = "artifacts/installer-a";
  const dirB = "artifacts/installer-b";

  const writtenA = emitInstall(dirA, report);
  const writtenB = emitInstall(dirB, report);

  assert.deepEqual(writtenA, writtenB);
  for (const relative of writtenA) {
    assert.equal(readFileSync(join(dirA, relative), "utf8"), readFileSync(join(dirB, relative), "utf8"));
  }
});
