/**
 * The automated run file.
 *
 *   node src/tools/run.ts --library fixtures/library --settings mature \
 *       --project ue/HouseArrest --dry-run
 *
 * One command, ten stages, in dependency order:
 *
 *   preflight -> library -> resolve -> content -> project -> build
 *             -> import -> verify -> room -> props -> package
 *
 * Stages 1-5 are pure Node and always run: scan the asset index, match every
 * content class, write the HASContent plugin and registry into the project, and
 * scaffold the C++ project around it. Everything after that needs a real Unreal
 * install and is skipped, with a reason, when there isn't one — so the offline half
 * of this is usable on a laptop. The target is compiled before the stages that open
 * the editor, because a C++ project with no binaries cannot be loaded.
 *
 * What this cannot do: buy or download Fab content. That needs your Epic account
 * and your entitlements, and no script can accept a licence on your behalf. Point
 * --drop at a folder of packs you have already downloaded and the rest is
 * mechanical.
 *
 * Nothing here writes a timestamp; the outputs are comparable between runs.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ContentGate, normalizeSettings } from "../content/gate.ts";
import type { ContentSettings } from "../content/gate.ts";
import { devUnrestrictedSettings } from "../content/presets.ts";
import { stableStringify } from "../save/serialize.ts";
import { loadLibrary } from "./library.ts";
import type { AssetLibrary } from "./library.ts";
import { buildReport } from "./resolver.ts";
import type { InstallReport } from "./resolver.ts";
import { emitInstall } from "./ue5.ts";
import { emitProject } from "./project.ts";
import { batchArguments, planStages, preflightProblems } from "./pipeline.ts";
import type { RunOptions, StageId } from "./pipeline.ts";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "true";
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function list(name: string): StageId[] {
  const raw = arg(name, "");
  if (!raw || raw === "true") return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is StageId => entry.length > 0);
}

function settingsFor(preset: string): ContentSettings {
  if (preset === "dev") return devUnrestrictedSettings();
  if (preset === "mature") {
    return normalizeSettings({ sexual: "explicit", nudity: "full", violence: "graphic", darkThemes: true });
  }
  return normalizeSettings({});
}

function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function spawn(command: string[], cwd: string, extraEnv: Record<string, string>): number {
  const [head, ...rest] = command;
  if (!head) return 1;

  const env = { ...process.env, ...extraEnv };

  // Node will not spawn a .bat/.cmd directly on Windows (it throws EINVAL since
  // the 2024 spawn hardening), and both the build and package steps are batch
  // files. The line is handed to cmd.exe /d /s /c, with every argument quoted and
  // the whole line wrapped again so /s strips the wrapper, not the quotes around
  // a path containing spaces.
  const batch = process.platform === "win32" && /\.(bat|cmd)$/i.test(head);
  const line = [head, ...rest].map(quoteArg).join(" ");

  const result = batch
    ? spawnSync(env["ComSpec"] ?? "cmd.exe", batchArguments(line), {
        cwd,
        env,
        stdio: "pipe",
        windowsVerbatimArguments: true,
      })
    : spawnSync(head, rest, { cwd, env, stdio: "pipe" });
  if (result.error) console.error(`  could not launch: ${result.error.message}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return result.status === null ? 1 : result.status;
}

function main(): void {
  const outDir = arg("out", "artifacts");
  const envRoot = process.env["UE_ROOT"];

  const options: RunOptions = {
    projectName: arg("name", "HouseArrest"),
    projectDir: arg("project", "ue/HouseArrest"),
    libraryDir: arg("library", "fixtures/library"),
    dropDir: has("drop") ? arg("drop", "") : null,
    outDir,
    archiveDir: arg("archive", join(outDir, "package")),
    engineAssociation: arg("engine", "5.5"),
    settings: arg("settings", "dev") === "mature" ? "mature" : arg("settings", "dev") === "default" ? "default" : "dev",
    engineRoot: has("engine-root") ? arg("engine-root", "") || null : envRoot && envRoot.length > 0 ? envRoot : null,
    platform: process.platform,
    skip: list("skip"),
    only: list("only"),
    dryRun: has("dry-run"),
  };

  const plan = planStages(options);

  console.log("HOUSE ARREST — automated build pipeline");
  console.log(`project:   ${options.projectDir} (${options.projectName}, UE ${options.engineAssociation})`);
  console.log(`library:   ${options.libraryDir}`);
  console.log(`drop:      ${options.dropDir ?? "(none)"}`);
  console.log(`engine:    ${options.engineRoot ?? "(not found — engine stages will be skipped)"}`);
  console.log(`settings:  ${options.settings}`);
  console.log("");
  console.log("plan:");

  for (const stage of plan) {
    if (stage.skipReason) {
      console.log(`  skip   ${stage.id.padEnd(9)} ${stage.label} — ${stage.skipReason}`);
      continue;
    }
    console.log(`  run    ${stage.id.padEnd(9)} ${stage.label}`);
    if (stage.command) console.log(`         ${stage.command.join(" ")}`);
  }

  const problems = preflightProblems(options);
  if (problems.length > 0) {
    console.log("");
    console.log("preflight failed:");
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exit(1);
  }

  if (options.dryRun) {
    console.log("");
    console.log("dry run: nothing executed, nothing written.");
    return;
  }

  const gate = new ContentGate(settingsFor(options.settings));
  let library: AssetLibrary | null = null;
  let report: InstallReport | null = null;
  const completed: StageId[] = [];
  const skipped: string[] = [];

  // The import stage writes an index of what actually landed in the engine, and
  // those paths are not necessarily the ones a hand-written library index named.
  // Learn them here, before verify inspects the registry, or the run stops on
  // paths that were correct until the importer renamed them.
  const learnImported = (): void => {
    const importedIndex = join(resolve(options.outDir), "imported", "imported.json");
    if (!existsSync(importedIndex)) return;

    console.log("");
    console.log("== re-resolve: closing the loop against the imported index");
    const importedLibrary = loadLibrary(join(options.outDir, "imported"));
    const importedReport = buildReport(gate, importedLibrary);
    emitInstall(options.projectDir, importedReport);
    report = importedReport;
    console.log(
      `  ${importedReport.totals.resolved}/${importedReport.totals.classes} resolved against ` +
        `${importedLibrary.assets.length} imported assets`,
    );
  };

  for (const stage of plan) {
    if (stage.skipReason) {
      skipped.push(stage.id);
      continue;
    }

    console.log("");
    console.log(`== ${stage.id}: ${stage.label}`);

    try {
      if (stage.id === "library") {
        library = loadLibrary(options.libraryDir);
        console.log(`  indexed ${library.assets.length} assets`);
      } else if (stage.id === "resolve") {
        if (!library) throw new Error("the library stage did not produce an index");
        report = buildReport(gate, library);
        console.log(
          `  ${report.totals.resolved}/${report.totals.classes} resolved, ` +
            `${report.totals.gated} gated, ${report.totals.unresolved} unresolved`,
        );
        if (report.totals.unresolved > 0) {
          console.log("  warning: permitted classes with no art will be absent from the registry:");
          for (const line of report.blocking) console.log(`    - ${line}`);
        }
      } else if (stage.id === "content") {
        if (!report) throw new Error("the resolve stage did not produce a report");
        const written = emitInstall(options.projectDir, report);
        console.log(`  wrote ${written.length} files into ${options.projectDir}`);
      } else if (stage.id === "project") {
        const written = emitProject(options.projectDir, {
          projectName: options.projectName,
          engineAssociation: options.engineAssociation,
        });
        console.log(`  wrote ${written.length} files (uproject, targets, module, python)`);
      } else if (stage.command) {
        const importIndex = join(resolve(options.outDir), "imported", "imported.json");
        const extraEnv: Record<string, string> = {};
        if (stage.id === "import" && options.dropDir) extraEnv["HAS_DROP_DIR"] = options.dropDir;
        if (stage.id === "import") extraEnv["HAS_IMPORT_JSON"] = importIndex;
        if (stage.id === "verify") {
          extraEnv["HAS_REGISTRY"] = join(
            resolve(options.projectDir),
            "Plugins/HASContent/Content/Data/HASAssetRegistry.json",
          );
        }
        if (stage.id === "room" || stage.id === "props") {
          extraEnv["HAS_ROOM_ID"] = arg("room", "basement");
          extraEnv["HAS_LEVEL"] = arg("level", "/Game/Maps/HouseArrest");
        }

        // Every path in a stage command, and in HAS_REGISTRY / HAS_IMPORT_JSON, is
        // relative to the repository root, so the engine runs from there too.
        // Running from inside the project doubled the prefix: the .uproject became
        // ue\HouseArrest\ue\HouseArrest\HouseArrest.uproject, which does not exist.
        const status = spawn(stage.command, process.cwd(), extraEnv);
        if (status !== 0) {
          console.error(`  ${stage.id} failed with exit code ${status}; stopping.`);
          process.exit(status);
        }
        console.log(`  ${stage.id} ok`);
      }
      completed.push(stage.id);
      if (stage.id === "import") learnImported();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ${stage.id} failed: ${message}`);
      process.exit(1);
    }
  }

  const summary = {
    project: options.projectName,
    projectDir: options.projectDir,
    settings: options.settings,
    completed,
    skipped,
    totals: report
      ? {
          classes: report.totals.classes,
          resolved: report.totals.resolved,
          gated: report.totals.gated,
          unresolved: report.totals.unresolved,
        }
      : null,
  };

  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(join(options.outDir, "run-summary.json"), `${stableStringify(summary)}\n`);

  console.log("");
  console.log(`done: ${completed.length} stages completed, ${skipped.length} skipped.`);
  console.log(`summary: ${join(options.outDir, "run-summary.json")}`);
  if (skipped.length > 0) {
    console.log(`skipped: ${skipped.join(", ")} — see the plan above for why.`);
  }
}

main();
