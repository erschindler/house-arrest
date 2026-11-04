import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emitProject } from "../src/tools/project.ts";
import { engineTools, planStages, preflightProblems, STAGE_ORDER } from "../src/tools/pipeline.ts";
import type { RunOptions } from "../src/tools/pipeline.ts";

function options(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    projectName: "HouseArrest",
    projectDir: "artifacts/project",
    libraryDir: "fixtures/library",
    dropDir: null,
    outDir: "artifacts",
    archiveDir: "artifacts/package",
    engineAssociation: "5.5",
    settings: "dev",
    engineRoot: null,
    platform: "win32",
    skip: [],
    only: [],
    dryRun: true,
    ...overrides,
  };
}

test("the plan is the fixed dependency order", () => {
  const plan = planStages(options());

  assert.deepEqual(
    plan.map((stage) => stage.id),
    STAGE_ORDER,
  );
  assert.equal(
    plan.filter((stage) => stage.skipReason === null).map((stage) => stage.id).join(","),
    "preflight,library,resolve,content,project",
    "without an engine, only the offline half runs",
  );
});

test("engine stages are skipped with a reason rather than failing", () => {
  const plan = planStages(options());
  const build = plan.find((stage) => stage.id === "build");

  assert.ok(build?.skipReason?.includes("no engine"));
  assert.equal(build?.command, null);
});

test("a drop folder is only required for the import stage", () => {
  const withoutDrop = planStages(options({ engineRoot: "C:/UE" }));
  const importStage = withoutDrop.find((stage) => stage.id === "import");

  assert.ok(importStage?.skipReason?.includes("drop folder"));
  assert.ok(withoutDrop.find((stage) => stage.id === "verify")?.command);

  const withDrop = planStages(options({ engineRoot: "C:/UE", dropDir: "D:/Fab" }));
  const command = withDrop.find((stage) => stage.id === "import")?.command?.join(" ") ?? "";

  assert.match(command, /has_import\.py/);
  assert.match(command, /-run=pythonscript/);
});

test("build and package invoke the engine's own toolchain", () => {
  const plan = planStages(options({ engineRoot: "C:/UE", dropDir: "D:/Fab" }));
  const build = plan.find((stage) => stage.id === "build")?.command?.join(" ") ?? "";
  const pack = plan.find((stage) => stage.id === "package")?.command?.join(" ") ?? "";

  assert.match(build, /Build\.bat/);
  assert.match(build, /HouseArrestEditor/);
  assert.match(build, /-Project=artifacts[\\/]project[\\/]HouseArrest\.uproject/);
  assert.match(pack, /BuildCookRun/);
  assert.match(pack, /-cook/);
});

test("tool paths follow the platform", () => {
  assert.match(engineTools("C:/UE", "win32").editor, /Win64[\\/]UnrealEditor-Cmd\.exe$/);
  assert.match(engineTools("/opt/UE", "linux").editor, /Linux[\\/]UnrealEditor-Cmd$/);
});

test("preflight explains where to point --engine-root", () => {
  const problems = preflightProblems(options({ engineRoot: "C:/definitely/not/an/engine" }));

  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /UnrealEditor-Cmd not found/);
  assert.match(problems[0] ?? "", /containing Engine\//);
});

test("preflight rejects a project name the compiler could not accept", () => {
  const problems = preflightProblems(options({ projectName: "house arrest" }));

  assert.ok(problems.some((problem) => problem.includes("not a valid C++ identifier")));
});

test("the scaffold is a plugin-aware project with the editor scripts", () => {
  const dir = "artifacts/project";
  const written = emitProject(dir, { projectName: "HouseArrest", engineAssociation: "5.5" });

  assert.ok(written.includes("HouseArrest.uproject"));
  assert.ok(written.includes("Scripts/has_import.py"));
  assert.ok(written.includes("Scripts/has_verify.py"));

  const uproject = JSON.parse(readFileSync(join(dir, "HouseArrest.uproject"), "utf8")) as {
    Modules: { Name: string }[];
    Plugins: { Name: string; Enabled: boolean }[];
  };

  assert.deepEqual(uproject.Modules.map((module) => module.Name), ["HouseArrest"]);

  const plugins = uproject.Plugins.map((plugin) => plugin.Name);
  assert.ok(plugins.includes("HASContent"), "the content plugin has to be enabled");
  assert.ok(plugins.includes("PythonScriptPlugin"), "headless -run=pythonscript needs this plugin");
  assert.ok(plugins.includes("EditorScriptingUtilities"), "EditorAssetLibrary lives in this plugin");
  assert.ok(uproject.Plugins.every((plugin) => plugin.Enabled));

  const module = readFileSync(join(dir, "Source/HouseArrest/HouseArrest.Build.cs"), "utf8");
  assert.match(module, /"HASContent"/, "the game module has to depend on the content plugin");

  const verify = readFileSync(join(dir, "Scripts/has_verify.py"), "utf8");
  assert.match(verify, /HASAssetRegistry\.json/);
  assert.match(verify, /sys\.exit\(main\(\)\)/);
});

test("the scaffold is byte-identical across runs", () => {
  const writtenA = emitProject("artifacts/project-a", { projectName: "HouseArrest", engineAssociation: "5.5" });
  const writtenB = emitProject("artifacts/project-b", { projectName: "HouseArrest", engineAssociation: "5.5" });

  assert.deepEqual(writtenA, writtenB);
  for (const relative of writtenA) {
    assert.equal(
      readFileSync(join("artifacts/project-a", relative), "utf8"),
      readFileSync(join("artifacts/project-b", relative), "utf8"),
    );
  }
});
