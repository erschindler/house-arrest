/**
 * Installer CLI.
 *
 *   node src/tools/cli.ts --library fixtures/library --out artifacts/ue5-install
 *   node src/tools/cli.ts --library <dir> --settings mature --report-only
 *
 * `--settings` accepts default | mature | dev. `dev` uses the development preset,
 * which raises content limits only — it does not and cannot affect the hard
 * invariants, and the installer only reads ContentSettings in any case.
 */

import { ContentGate } from "../content/gate.ts";
import type { ContentSettings } from "../content/gate.ts";
import { normalizeSettings } from "../content/gate.ts";
import { devUnrestrictedSettings } from "../content/presets.ts";
import { loadLibrary } from "./library.ts";
import { buildReport } from "./resolver.ts";
import type { InstallReport } from "./resolver.ts";
import { emitInstall } from "./ue5.ts";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "true";
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function settingsFor(preset: string): ContentSettings {
  if (preset === "dev") return devUnrestrictedSettings();
  if (preset === "mature") {
    return normalizeSettings({ sexual: "explicit", nudity: "full", violence: "graphic", darkThemes: true });
  }
  return normalizeSettings({});
}

function printReport(report: InstallReport, settingsLabel: string): void {
  console.log(`settings: ${settingsLabel}`);
  console.log(
    `classes: ${report.totals.classes} | resolved: ${report.totals.resolved} | ` +
      `unresolved: ${report.totals.unresolved} | gated: ${report.totals.gated}`,
  );

  if (report.totals.unresolved > 0) {
    console.log("");
    console.log("blocking gaps:");
    for (const line of report.blocking) console.log(`  - ${line}`);
  }

  const gated = report.resolutions.filter((entry) => entry.status === "gated");
  if (gated.length > 0) {
    console.log("");
    console.log("gated by current settings (art may exist; not loadable):");
    for (const entry of gated) console.log(`  - ${entry.assetClass} (${entry.missingContent.join(", ")})`);
  }
}

function main(): void {
  const libraryDir = arg("library", "fixtures/library");
  const outDir = arg("out", "artifacts/ue5-install");
  const preset = arg("settings", "dev");

  console.log("HOUSE ARREST — content installer");
  console.log(`library: ${libraryDir}`);

  const library = loadLibrary(libraryDir);
  console.log(`assets indexed: ${library.assets.length}`);

  const gate = new ContentGate(settingsFor(preset));
  const report = buildReport(gate, library);
  printReport(report, `${preset} (${gate.describe()})`);

  if (flag("report-only")) {
    console.log("");
    console.log("report-only: nothing written.");
    return;
  }

  const written = emitInstall(outDir, report);
  console.log("");
  console.log(`wrote ${written.length} files to ${outDir}:`);
  for (const path of written) console.log(`  ${path}`);
  console.log("");
  console.log("The generated C++ is scaffolding and has not been compiled. The registry JSON is the contract.");
}

main();
