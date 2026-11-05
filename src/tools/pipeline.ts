/**
 * The pipeline plan.
 *
 * Kept separate from `run.ts` so the plan is a pure function of the options: it
 * can be printed with --dry-run, asserted in tests, and diffed between machines.
 * Nothing here touches the filesystem except `existsSync`.
 *
 * Order is the dependency order and is not configurable. What *is* configurable
 * is which stages run (--only/--skip) and whether the engine is available at all,
 * so the offline half of the machine works on a laptop with no Unreal install.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type StageId =
  | "preflight"
  | "library"
  | "resolve"
  | "content"
  | "project"
  | "import"
  | "verify"
  | "room"
  | "props"
  | "build"
  | "package";

export const STAGE_ORDER: StageId[] = [
  "preflight",
  "library",
  "resolve",
  "content",
  "project",
  "import",
  "verify",
  "room",
  "props",
  "build",
  "package",
];

const LABELS: Record<StageId, string> = {
  preflight: "check the toolchain and the inputs",
  library: "scan the asset library",
  resolve: "match every content class against it",
  content: "write the HASContent plugin and registry",
  project: "scaffold the Unreal project",
  import: "import the drop folder inside Unreal",
  verify: "confirm every registered path exists in the engine",
  room: "build the concealed room in the level",
  props: "furnish the room: computer, phone, camera, tools",
  build: "compile the editor target",
  package: "cook and package a build",
};

export type RunOptions = {
  projectName: string;
  projectDir: string;
  libraryDir: string;
  dropDir: string | null;
  outDir: string;
  archiveDir: string;
  engineAssociation: string;
  settings: "default" | "mature" | "dev";
  engineRoot: string | null;
  platform: string;
  skip: StageId[];
  only: StageId[];
  dryRun: boolean;
};

export type EngineTools = {
  editor: string;
  build: string;
  uat: string;
};

/** Where the engine's command-line tools live, per platform. */
// The editor writes its own version next to the binaries. Reading it is the only
// way to know which EngineAssociation will actually resolve on this machine.
function installedVersion(engineRoot: string): string | null {
  const versionFile = join(engineRoot, "Engine/Build/Build.version");
  if (!existsSync(versionFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(versionFile, "utf8")) as {
      MajorVersion?: unknown;
      MinorVersion?: unknown;
    };
    if (typeof parsed.MajorVersion !== "number" || typeof parsed.MinorVersion !== "number") {
      return null;
    }
    return `${parsed.MajorVersion}.${parsed.MinorVersion}`;
  } catch {
    return null;
  }
}

export function engineTools(engineRoot: string, platform: string): EngineTools {
  if (platform.startsWith("win")) {
    return {
      editor: join(engineRoot, "Engine/Binaries/Win64/UnrealEditor-Cmd.exe"),
      build: join(engineRoot, "Engine/Build/BatchFiles/Build.bat"),
      uat: join(engineRoot, "Engine/Build/BatchFiles/RunUAT.bat"),
    };
  }
  if (platform === "darwin") {
    return {
      editor: join(engineRoot, "Engine/Binaries/Mac/UnrealEditor-Cmd"),
      build: join(engineRoot, "Engine/Build/BatchFiles/Mac/Build.sh"),
      uat: join(engineRoot, "Engine/Build/BatchFiles/Mac/RunUAT.sh"),
    };
  }
  return {
    editor: join(engineRoot, "Engine/Binaries/Linux/UnrealEditor-Cmd"),
    build: join(engineRoot, "Engine/Build/BatchFiles/Linux/Build.sh"),
    uat: join(engineRoot, "Engine/Build/BatchFiles/Linux/RunUAT.sh"),
  };
}

export function platformTarget(platform: string): string {
  if (platform.startsWith("win")) return "Win64";
  if (platform === "darwin") return "Mac";
  return "Linux";
}

export type PlannedStage = {
  id: StageId;
  label: string;
  command: string[] | null;
  skipReason: string | null;
};

const ENGINE_STAGES: StageId[] = ["import", "verify", "room", "props", "build", "package"];

export function planStages(options: RunOptions): PlannedStage[] {
  const tools = options.engineRoot ? engineTools(options.engineRoot, options.platform) : null;
  const target = platformTarget(options.platform);
  const uproject = join(options.projectDir, `${options.projectName}.uproject`);
  const scripts = join(options.projectDir, "Scripts");

  return STAGE_ORDER.map((id) => {
    const label = LABELS[id];
    const planned: PlannedStage = { id, label, command: null, skipReason: null };

    if (options.skip.includes(id)) return { ...planned, skipReason: "excluded by --skip" };
    if (options.only.length > 0 && !options.only.includes(id)) {
      return { ...planned, skipReason: "not selected by --only" };
    }
    if (ENGINE_STAGES.includes(id) && (tools === null || options.engineRoot === null)) {
      return { ...planned, skipReason: "no engine: pass --engine-root or set UE_ROOT" };
    }
    if (id === "import" && options.dropDir === null) {
      return { ...planned, skipReason: "no drop folder: pass --drop <folder with your Fab packs>" };
    }

    if (id === "import" && tools) {
      return {
        ...planned,
        command: [
          tools.editor,
          uproject,
          "-run=pythonscript",
          `-script=${join(scripts, "has_import.py")}`,
          "-unattended",
          "-nopause",
          "-nosplash",
        ],
      };
    }

    if (id === "verify" && tools) {
      return {
        ...planned,
        command: [
          tools.editor,
          uproject,
          "-run=pythonscript",
          `-script=${join(scripts, "has_verify.py")}`,
          "-unattended",
          "-nopause",
          "-nosplash",
        ],
      };
    }

    if (id === "room" && tools) {
      return {
        ...planned,
        command: [
          tools.editor,
          uproject,
          "-run=pythonscript",
          `-script=${join(scripts, "has_build_hidden_room.py")}`,
          "-unattended",
          "-nopause",
          "-nosplash",
        ],
      };
    }

    if (id === "props" && tools) {
      return {
        ...planned,
        command: [
          tools.editor,
          uproject,
          "-run=pythonscript",
          `-script=${join(scripts, "has_build_room_props.py")}`,
          "-unattended",
          "-nopause",
          "-nosplash",
        ],
      };
    }

    if (id === "build" && tools) {
      return {
        ...planned,
        command: [
          tools.build,
          `${options.projectName}Editor`,
          target,
          "Development",
          `-Project=${uproject}`,
          "-WaitMutex",
          "-NoHotReloadFromIDE",
        ],
      };
    }

    if (id === "package" && tools) {
      return {
        ...planned,
        command: [
          tools.uat,
          "BuildCookRun",
          `-project=${uproject}`,
          `-platform=${target}`,
          "-clientconfig=Development",
          "-build",
          "-cook",
          "-stage",
          "-pak",
          "-archive",
          `-archivedirectory=${options.archiveDir}`,
        ],
      };
    }

    return planned;
  });
}

/**
 * Things that stop the run before it starts. Only genuinely unfixable-by-continuing
 * problems belong here: a missing library or a wrong --engine-root. Missing engine
 * stages are skips, not failures, so the offline half still works.
 */
export function preflightProblems(options: RunOptions): string[] {
  const problems: string[] = [];

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor < 22) {
    problems.push(`node ${process.versions.node} is too old: 22.6+ is required for TypeScript type stripping`);
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.projectName)) {
    problems.push(`project name "${options.projectName}" is not a valid C++ identifier`);
  }

  if (!existsSync(options.libraryDir)) {
    problems.push(
      `asset library not found: ${options.libraryDir} — export your library to JSON, or point --library at fixtures/library`,
    );
  }

  if (options.dropDir !== null && !existsSync(options.dropDir)) {
    problems.push(`drop folder not found: ${options.dropDir}`);
  }

  if (options.engineRoot !== null) {
    const tools = engineTools(options.engineRoot, options.platform);
    if (!existsSync(tools.editor)) {
      problems.push(
        `UnrealEditor-Cmd not found at ${tools.editor} — --engine-root must be the folder containing Engine/ (see README, "What you need to install")`,
      );
    } else {
      const installed = installedVersion(options.engineRoot);
      if (installed !== null && installed !== options.engineAssociation) {
        problems.push(
          `engine at ${options.engineRoot} is UE ${installed}, but the project is set to UE ${options.engineAssociation} — pass --engine ${installed}, or EngineAssociation will name an engine this machine does not have`,
        );
      }
    }
  }

  return problems;
}
