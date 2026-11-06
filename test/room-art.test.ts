import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ContentGate } from "../src/content/gate.ts";
import { devUnrestrictedSettings } from "../src/content/presets.ts";
import { loadLibrary, parseLibraryFile } from "../src/tools/library.ts";
import { buildReport } from "../src/tools/resolver.ts";
import { emitInstall } from "../src/tools/ue5.ts";
import { emitRoomSystems } from "../src/tools/ue-room-systems.ts";

const OUT = "artifacts/room-art";

test("a role is optional and survives parsing", () => {
  const withRole = parseLibraryFile(
    JSON.stringify({ pack: "p", assets: [{ id: "/Game/A", kind: "prop", role: "HAS.RoomProp.chair" }] }),
    "p",
  );
  assert.equal(withRole.assets[0]?.role, "HAS.RoomProp.chair");

  const withoutRole = parseLibraryFile(
    JSON.stringify({ pack: "p", assets: [{ id: "/Game/A", kind: "prop" }] }),
    "p",
  );
  assert.equal(withoutRole.assets[0]?.role, undefined);
});

test("a role assignment reaches the registry the room stage reads", () => {
  const libraryDir = join(OUT, "library");
  mkdirSync(libraryDir, { recursive: true });
  writeFileSync(
    join(libraryDir, "forgotten-room.json"),
    JSON.stringify({
      pack: "Fab — The Forgotten Room",
      assets: [
        {
          id: "/Game/Fab/TheForgottenRoom/SM_Chair",
          name: "Chair",
          kind: "prop",
          tags: ["basement", "interior", "concrete", "drain", "room", "washdown"],
          triangles: 118000,
          lods: 3,
          animated: false,
          license: "Fab Standard",
          role: "HAS.RoomProp.chair",
        },
      ],
    }),
  );

  const report = buildReport(new ContentGate(devUnrestrictedSettings()), loadLibrary(libraryDir));
  const projectDir = join(OUT, "project");
  emitInstall(projectDir, report);

  const registry = JSON.parse(
    readFileSync(join(projectDir, "Plugins/HASContent/Content/Data/HASAssetRegistry.json"), "utf8"),
  ) as { entries: { path: string; role?: string }[] };

  const entry = registry.entries.find((candidate) => candidate.role === "HAS.RoomProp.chair");
  if (!entry) throw new Error("the role must survive into the registry");
  assert.equal(entry.path, "/Game/Fab/TheForgottenRoom/SM_Chair");
});

test("the props stage prefers registry art and keeps the placeholder fallback", () => {
  const written = emitRoomSystems(join(OUT, "systems"), "HouseArrest");
  assert.ok(written.includes("Scripts/has_build_room_props.py"));

  const script = readFileSync(join(OUT, "systems", "Scripts/has_build_room_props.py"), "utf8");
  assert.match(script, /HAS_REGISTRY/);
  assert.match(script, /def role_art\(\)/);
  assert.match(script, /roles\.get\(tag/);
  assert.match(script, /CUBE = "\/Engine\/BasicShapes\/Cube\.Cube"/);
});

test("a role reaches the registry even when no content class claims the asset", () => {
  const projectDir = join(OUT, "project-roles");
  const report = buildReport(new ContentGate(devUnrestrictedSettings()), { assets: [] });
  emitInstall(projectDir, report, [
    { role: "HAS.RoomProp.chair", path: "/Game/Fab/TheForgottenRoom/SM_Chair" },
    { role: "HAS.RoomProp.chair", path: "/Game/Fab/TheForgottenRoom/SM_Chair_Duplicate" },
  ]);

  const registry = JSON.parse(
    readFileSync(join(projectDir, "Plugins/HASContent/Content/Data/HASAssetRegistry.json"), "utf8"),
  ) as { roles: { role: string; path: string }[] };

  // One assignment per anchor, first one wins, so the room cannot swap art between runs.
  assert.deepEqual(registry.roles, [
    { role: "HAS.RoomProp.chair", path: "/Game/Fab/TheForgottenRoom/SM_Chair" },
  ]);
});

test("the props stage reads standalone role assignments, not only class entries", () => {
  const script = readFileSync(join(OUT, "systems", "Scripts", "has_build_room_props.py"), "utf8");
  assert.match(script, /registry\.get\("roles"/);
});
