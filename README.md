# HOUSE ARREST

A deterministic, adults-only life/crime simulation about a person who cannot leave
the house — by fear rather than by court order — and what they become willing to do
from inside it. Built as two halves that meet in the middle:

- **`src/`** — a headless simulation core: persistent people, consequential
  relationships, a live consent state machine, an injury model, content gating, a
  floorplan with transforms, a phone, a fictional internet, remote work, an
  agoraphobic confinement model, leverage and accomplices (police included), a
  concealed room, an organ-level trauma model, weighted objectives and six endings,
  and a world that saves and restores exactly. No engine, no assets, zero
  dependencies.
- **`src/tools/`** — a pipeline that takes an asset library and an Unreal
  installation and produces a compile-ready UE5 project with every content class
  wired to a real asset.

Then one command runs the whole thing.

```bash
npm test          # test suite
npm run demo      # 30-second tour of the simulation
npm run run -- --dry-run   # print the pipeline plan, execute nothing
```

Node 26 (22.6 minimum — this repo relies on native TypeScript type stripping, so
there is no build step and no `node_modules`).

---

# 0. The first build: the room

This repository now builds one room before it builds a house. Everything else in
the simulation still exists and still runs, but the level, the assets and the
money are all pointed at a single concealed space and the loop that surrounds it.

**The loop.** A computer on the desk lists adults advertising company in the city;
the list is generated from a seed, and each entry has an area and a fee. Paying the
fee puts a name in the delivery queue. A turned accomplice — or the player, if the
room is finished and the street is quiet — brings them to the door, where custody
takes over. Inside, the session runs on the trauma model: contact, tissue, blood,
voice. The camera records it. The clip is worth what the camera, the light and the
framing say it is worth, and uploading it adds that value to a float. The float buys
a better camera, light, a tripod, tools, furniture, drainage — each of which raises
the ceiling on the next clip.

There is no network, no real marketplace, no upload and no cryptocurrency in this
loop. The market is a list and a number.

## What was added for it

| Module | What it does |
| --- | --- |
| `src/sim/surface.ts` | The body as a physical object: 19 surface regions, tissue depth per region, structures at real depths (carotid at 16 mm, heart at 40, femur at 52), collider descriptors, clothing coverage and integrity, joint severance work, spray profiles, voice and face selection. |
| `torture.ts` (extended) | Sessions now carry clothing, per-joint progress, pooled blood, systolic pressure, the current voice cue and the face. Cut and stab resolve through `resolveContact`, so clothing, angle, force and bone actually decide what is hit. New acts: `cutClothing`, `pullOff`, `sever`. |
| `ue-room-systems.ts` | Emits the physical half of the UE5 integration (below). |

## The components it emits

| C++ | What it owns |
| --- | --- |
| `UHASPhysicsContactComponent` | Maps physics-asset bones to regions, resolves a sweep into a `FHASContactResult`, applies the impulse. The only place a collision becomes a wound. |
| `UHASWoundComponent` | Wound channel geometry, cautery, total bleed, blood volume and pooling, arterial spray decals, clothing staining, survival estimate. |
| `UHASDismembermentComponent` | Per-joint millimetre progress, stump hiding, constraint break, detached limb physics. A saw removes about twice what a knife does per pass. |
| `UHASVoiceComponent` | Cue selection from pain/terror/shock/consciousness, male and female sound sets, expression morph targets. Silence means the airway or the consciousness is gone. |
| `UHASProductionComponent` | Listings, delivery fees, recording, clip quality and value, uploads, camera tiers, equipment purchases. |

Data tables: `HASSurfaces.csv`, `HASGarments.csv`, `HASVoiceCues.csv`, alongside the
original `HASAnatomy.csv` and `HASTools.csv`. The room is furnished by
`has_build_room_props.py`, which places the desk, computer, phone, camera rig, tool
rack, chair, drain and light as tagged placeholders.

## Controls the components expect

| Input | Call |
| --- | --- |
| Take / drop a tool | `RegisterTool` / `ClearTools` |
| Swing, press, drive | `ApplyStrike(tool, hit, force)` |
| Bare hands | `ApplyHandContact(hit, force)` |
| Cut clothing | `cutClothing` in the sim; garment coverage drops in C++ |
| Sever a joint | `UHASDismembermentComponent::ApplyTool` once per pass |
| Cauterise / stabilise | `Cauterize` / `StabiliseAll` |
| Record / stop / upload | `BeginRecording` / `EndRecording` / `Upload` |

## What is not in the first build, and will not be

- **Sexual content in the room, including with a body.** A person held there cannot
  consent, and a dead person cannot consent at all, so there is no sexual
  interaction, no genital or mouth collision surface, and no player genital
  simulation. The contact model is damage only. This is a design line, not a
  setting: adding it would mean building a consent bypass, which the rest of the
  engine exists to prevent.
- **Real-world procedure.** Depths, bleed rates and lethality are balance numbers.
  There is no technique, dosage or material guidance in the code or the CSVs.
- **Blueprints, meshes, animations, audio.** Those are content classes. The
  installer wires them or the component runs dry, and the first build will look
  like grey boxes until you buy and import art.
- **Anything outside the room.** The house, the neighbours, the job system and the
  rest of the simulation run headlessly; the level does not draw them yet.

## Build order

The pipeline is eleven stages. For this slice you need `preflight` through
`project` (all Node, no engine), then `room` and `props` (editor scripts), then
`build`. `import` and `verify` only matter once you have art to bring in.

```bash
npm run run -- --library fixtures/library --settings dev \
  --project ue/HouseArrest --engine-root "C:/Program Files/Epic Games/UE_5.5"
```

---

# 1. What you need to install

Nothing below is downloadable by this repository: the engine is 60+ GB, the art is
licensed per account, and installing software is a decision only you can make.

## Required

| What | Where | Version | Why | Size |
| --- | --- | --- | --- | --- |
| **Unreal Engine 5** | Epic Games Launcher → Unreal Engine → Library → **+** | **5.5** (5.4–5.8 work; set `--engine` to match) | The engine itself. Installed *with* source or not, does not matter; **C++ projects** do. | 60 GB, 110 GB+ with debug symbols |
| **Visual Studio 2022** | visualstudio.microsoft.com | 17.10 or newer | Compiles the game and plugin modules. Install the **Game development with C++** workload — that brings MSVC v143, the Windows 11 SDK and .NET. Without it, `build` fails on a missing `cl.exe`. | 20–40 GB |
| **Node.js** | nodejs.org | **26** (22.6+ works) | Runs this repository and the pipeline. | 100 MB |
| **Git** | git-scm.com | any recent | Version control. | 60 MB |
| **Git LFS** | git-lfs.com | any recent | GitHub rejects any single file over 100 MB, and Unreal assets are routinely bigger. Install **before** you commit art. | 5 MB |
| **Epic account** | epicgames.com | — | Engine entitlement, and every Fab purchase is tied to it. | — |
| **Fab** | fab.com, or the **Fab** plugin already inside UE (Edit → Plugins → Fab) | — | All art. The plugin is the easier path: it installs straight into the project. | varies |

Linux and macOS work for the Node half and for the engine stages (the pipeline
picks `Build.sh` / `UnrealEditor-Cmd` per platform), but the editor tooling and
console targets assume Windows. **Windows 10/11 64-bit is the supported path.**

## Optional, once art becomes the bottleneck

| What | Why |
| --- | --- |
| **Blender 4.2+** | LOD generation, retopo, stump capping, fixing Fab meshes that arrive at 300k triangles with one LOD. |
| **Substance 3D Painter** | The layered wound/decomposition materials want real masks, not a flat colour. |
| **Reaper / Audacity** | Foley for impacts, breathing, household ambience. |
| **Python 3.11** | *Not needed* for the editor scripts — UE bundles its own 3.11 and the pipeline calls it through the engine. Only install this if you extend the Node tooling. |

## Hardware

- Windows 10/11 64-bit, 8+ cores
- **32 GB RAM minimum, 64 GB comfortable** (the editor plus a cooked build plus a browser will eat 32)
- GPU: RTX 3060 12 GB / RX 6700 XT or better for Lumen + Nanite at 1440p; 4070+ recommended
- **250 GB free NVMe SSD**: 60–120 GB engine, 20–60 GB derived data cache, 50 GB+ project and cooked builds

## Accounts, licences and the parts that are not technical

- **Fab entitlements are per account, and licences differ per pack.** Some packs are
  personal-use only. Read the licence on the pack page before it goes in a build you
  intend to distribute — a class resolving in the registry does not mean it is
  licensed for shipping.
- **Adult content** requires age verification on Fab and on most stores. If you use
  scanned performers or licensed adult animation, you need likeness releases and
  whatever record-keeping your jurisdiction requires (in the US, 18 U.S.C. §2257
  applies to certain depictions — get actual advice, not a README).
- **Store policy review.** Steam and the Epic Store both have rules about sexual
  content and graphic violence that are stricter than "it is legal". Budget time for
  it; it can force content changes late.

---

# 2. The automated run

```bash
npm run run -- \
  --library fixtures/library \
  --settings mature \
  --project ue/HouseArrest \
  --drop "D:/FabDownloads" \
  --engine-root "C:/Program Files/Epic Games/UE_5.5"
```

That is the whole machine. Eleven stages, in dependency order:

| # | Stage | What it does | Needs |
| --- | --- | --- | --- |
| 1 | `preflight` | Checks Node, project name, library path, drop folder, engine install. Fails **before** writing anything. | — |
| 2 | `library` | Scans the asset index (every `*.json` in `--library`, sorted). | — |
| 3 | `resolve` | Matches all 29 content classes against it under your content settings: kind, keywords, LOD minimums, triangle budget. Records every rejection with a reason. | — |
| 4 | `content` | Writes the **HASContent plugin** into the project: `.uplugin`, C++ subsystem, `HASAssetRegistry.json` containing *only* classes your settings permit. | — |
| 5 | `project` | Scaffolds the UE5 project: `.uproject`, game/editor targets, module, configs, and the two editor scripts. | — |
| 6 | `build` | Compiles `<Project>Editor` for your platform with the engine's own `Build.bat` / `Build.sh`. | engine |
| 7 | `import` | Runs `has_import.py` **inside Unreal**, importing the drop folder into `/Game/HASContent` and writing an index of what actually landed. | engine + `--drop` |
| 8 | `verify` | Runs `has_verify.py` inside Unreal: every path in the registry must actually load, or the pipeline stops. | engine |
| 9 | `room` | Runs `has_build_hidden_room.py` inside Unreal: seals the chosen room, builds the false wall and tags the concealed volume. | engine |
| 10 | `props` | Runs `has_build_room_props.py`: places the computer, phone, camera rig, tool rack, chair, drain and light as tagged placeholders. | engine |
| 11 | `package` | `BuildCookRun` — build, cook, stage, pak, archive to `--archive`. | engine |

`build` comes before every stage that opens the editor on purpose: a C++ project
whose module has never been compiled cannot be loaded, and `UnrealEditor-Cmd` exits
1 looking for binaries that do not exist yet.

Stages 1–5 are pure Node and **always work**, on any machine, with no engine
installed. Stages 6–11 need an engine and are skipped with an explicit reason when
there isn't one — so the offline half is usable on a laptop, and the engine half is
usable on the machine that has UE.

**The loop that makes it an installer rather than a guess.** `has_import.py` writes
its index in the same schema the library reader consumes. After a successful
import the pipeline re-resolves against *what actually landed in the engine* and
rewrites the registry. If the pack you downloaded has `SM_BloodPool_02` instead of
`SM_BloodPool_A`, the second pass points at the real path instead of the one a
spreadsheet predicted.

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--library <dir>` | `fixtures/library` | Folder of library JSON files. |
| `--project <dir>` | `ue/HouseArrest` | Where the UE project is generated (gitignored). |
| `--name <Name>` | `HouseArrest` | Project and module name. Must be a C++ identifier. |
| `--engine <5.5>` | `5.5` | `EngineAssociation` written into the `.uproject`. Must match the installed engine (`UE_5.8` → `--engine 5.8`); preflight refuses a mismatch. |
| `--engine-root <dir>` | `$UE_ROOT` | The folder **containing `Engine/`**. |
| `--drop <dir>` | none | Extracted Fab packs to import. |
| `--settings <preset>` | `dev` | `default`, `mature`, or `dev`. |
| `--archive <dir>` | `artifacts/package` | Cooked build destination. |
| `--only <a,b>` | all | Run only these stages. |
| `--skip <a,b>` | none | Skip these stages. |
| `--dry-run` | off | Print the plan and exit. Nothing written. |

`npm run preflight` is `--only preflight`: a five-second answer to "will this work
on this machine".

## Other entry points

```bash
# Offline matching only, no engine, no project — writes the report and plan files.
npm run installer -- --library fixtures/library --settings mature --out artifacts/ue5-install

# Just the report, nothing on disk.
npm run installer -- --library <export> --report-only
```

## What a successful run leaves you with

```
ue/HouseArrest/
  HouseArrest.uproject                  modules + Python/EditorScripting plugins enabled
  Source/                               targets, module, Build.cs (depends on HASContent)
  Config/                               DefaultEngine.ini, DefaultGame.ini
  Scripts/has_import.py                 headless import of a Fab drop folder
  Scripts/has_verify.py                 asserts every registry path loads
  Scripts/has_build_hidden_room.py      seals the room and builds the concealed volume
  Scripts/has_build_room_props.py       computer, phone, camera rig, rack, chair, drain, light
  Source/Systems/                       session, confinement, leverage, hidden room (C++)
  Source/Systems/HASPhysicsContactComponent.*  sweep -> wound; Wound, Dismemberment, Voice, Production
  Content/Data/HASAnatomy.csv           organ table: region, organ, bleed, lethality, death
  Content/Data/HASTools.csv             tool table: noise, precision, depth, pain, bleed, gore level
  Content/Data/HASSurfaces.csv          region -> tissue depth, width, structures
  Content/Data/HASGarments.csv          clothing coverage and tear resistance
  Content/Data/HASVoiceCues.csv         cue -> condition -> asset class
  Docs/ROOM_BUILD.md                    the room's props, controls and component contract
  Plugins/HASContent/
    HASContent.uplugin
    Source/HASContent/                  registry subsystem (C++)
    Content/Data/HASAssetRegistry.json  class -> soft path + fallbacks + required tags
  Docs/IMPORT_CHECKLIST.csv             per class: status, asset, LODs, triangles, licence, pack
  Docs/FAB_ACQUISITION_PLAN.md          search terms + acceptance tests for every gap
```

Open the `.uproject`, press Play. The registry is loaded by
`UHASContentSubsystem`; ask it for `gore.blood.decal` and it either gives you a path
or returns `false`. It will never hand back an asset your settings disallowed,
because those classes are not in the file it loaded.

---

# 3. What is automated, and what is not

**Automated, and tested:**

- scanning a library index, matching all 29 content classes, ranking, rejecting with reasons
- content-gating the match result so a disabled level cannot reach the engine registry
- generating the plugin, the C++, the `.uproject`, the configs, the docs, the CSVs
- generating the gameplay components, the anatomy/tool data tables and the room-build script
- planning and invoking the engine's import/verify/build/cook commands
- re-resolving against what the engine actually imported
- byte-identical output across runs (no timestamps anywhere, same rule as the sim)

**Not automated, and cannot be:**

- **Downloading Fab content.** It needs your Epic session, your entitlements and your
  acceptance of a licence. A script that clicks "buy" on your behalf is not a feature.
- **Judging art.** The resolver can check that a mesh has three LODs and 96k
  triangles. It cannot tell you the animation reads as grief rather than indigestion.
- **The game itself.** This produces the plumbing and the simulation. Gameplay,
  mission design, UI, audio direction, animation blending — that is the actual work,
  and no pipeline does it for you.
- **The C++ here has never been compiled.** There is no engine in this repository.
  The plugin and project files are written to the UE 5.4–5.8 API and are ordinary
  boilerplate, but treat your first `build` stage as a debugging session: expect a
  missing include or an API rename, not a clean first pass.
- **The editor scripts have never been executed.** `has_import.py`,
  `has_verify.py` and `has_build_hidden_room.py` use the documented `unreal` API (`AssetImportTask`,
  `EditorAssetLibrary`, `EditorStaticMeshLibrary`). The first headless run will
  probably need a path or a flag fixed.

Everything in section 1–2 above the "not automated" line is real: the Node half is
covered by the test suite, including that gated classes cannot appear in the
registry and that two runs produce identical bytes.

---

# 4. Install, download, and the first full run

## 4.1 What to install, exactly

| # | Download | From | Version | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Unreal Engine** | Epic Games Launcher → Unreal Engine → Library → **+** | **5.5** (5.4–5.8 work; set `--engine` to match) | 60 GB, 110 GB+ with debug symbols. Install to a path with no spaces if you can. |
| 2 | **Visual Studio 2022 Community** | visualstudio.microsoft.com | 17.10+ | Tick **Game development with C++**. That brings MSVC v143, the Windows 11 SDK and .NET. Without it the `build` stage fails on a missing `cl.exe`. |
| 3 | **Node.js** | nodejs.org | **26** (22.6 minimum) | The repo runs TypeScript directly; there is no build step. |
| 4 | **Git** | git-scm.com | any recent | |
| 5 | **Git LFS** | git-lfs.com | any recent | `git lfs install` once per machine, before you commit any art. |
| 6 | **Fab plugin** | Already inside UE: Edit → Plugins → search "Fab" → enable → restart | bundled | This is how packs are claimed and added to a project. |
| 7 | **Your Epic account** | epicgames.com | — | Engine entitlement and every Fab purchase are tied to it. |
| — | Optional: Blender 4.2+, Substance Painter, Reaper/Audacity | — | — | Only once art and audio become the bottleneck. |

## 4.2 What the installer can and cannot fetch

The installer **does not log into Epic or Fab, does not buy anything, and does not
download a pack**. It has no credentials, no entitlement and no vendor API, and a
script that clicked "buy" on your behalf would be a liability rather than a
feature. That part is yours: claim the packs, download them, extract them.

What the installer *does* call, in order:

| Stage | Program it runs | What that program does |
| --- | --- | --- |
| `preflight` | itself | Checks Node, engine path, library path, drop folder. Fails before writing. |
| `library` | itself | Reads every `*.json` in `--library`, sorted, into one index. |
| `resolve` | itself | Matches each content class against the index under your settings, with reasons for every rejection. |
| `content` | itself | Writes the `HASContent` plugin and the registry of *permitted* classes. |
| `project` | itself | Writes the `.uproject`, targets, module, configs and every generated system/script. |
| `build` | `Engine/Build/BatchFiles/Build.bat HouseArrestEditor Win64 Development` | Compiles the game module and every component. Must precede anything that opens the editor. |
| `import` | `UnrealEditor-Cmd.exe <uproject> -run=pythonscript -script=has_import.py` | Imports the extracted drop folder into `/Game/HASContent` and writes an index of what actually landed. |
| `verify` | same editor, `has_verify.py` | Fails the run if any path in the registry does not load. |
| `room` | same editor, `has_build_hidden_room.py` | Seals the room, builds the false wall, tags the volume. |
| `props` | same editor, `has_build_room_props.py` | Places the computer, phone, camera rig, tool rack, chair, drain and light. |
| `package` | `Engine/Build/BatchFiles/RunUAT.bat BuildCookRun` | Cooks, stages, paks and archives. |

## 4.3 The packs to get for the room

Search Fab with the terms below. These are the same strings the resolver's
requirements carry (`src/tools/requirements.ts`); the acceptance column is what the
installer actually checks, so a pack that fails it will be rejected with a reason
rather than silently used.

| Content class | Fab search terms | Acceptance test |
| --- | --- | --- |
| `torture.room.interior` | abandoned basement interior ue5 · concrete utility room environment · industrial washdown room | Modular interior with a floor drain, sealed walls and a ceiling light; ≥2 LODs. |
| `torture.room.hiddenDoor` | hidden door ue5 · secret bookcase door mesh · concealed wall panel door | Door plus matching wall panel; closed state reads as wall; ≥2 LODs. |
| `torture.instrument.set` | surgical instrument pack ue5 · vintage medical tools ue5 · butcher tool set | At least one mesh per tool id (scalpel, blade, pliers, saw, drill, brand, hammer, clamp, needle, chemical); ≥2 LODs. |
| `anatomy.detail.mesh` | anatomy body detailed ue5 · medical anatomy model ue5 · dissection body mesh | High-detail adult body with separable organ meshes and a matching skeleton; ≥3 LODs. |
| `anatomy.cross.section` | anatomy cross section material · layered flesh material ue5 | Material with separate skin/fat/muscle/bone/organ masks. |
| `gore.blood.decal` | blood decal pack ue5 · blood splatter material decal · forensic blood pool decal | Deferred decal or material-decal pair; surface and cloth projection; ≤5k triangles. |
| `gore.wound.layer` | layered wound material ue5 · flesh wound master material | Master material with per-layer masks. |
| `gore.organ.decal` | gore organ decal ue5 · anatomical gore decal pack | Extreme-level tissue decals, separable from the standard blood set. |
| `gore.dismemberment` | dismemberment limbs ue5 · severed limb static meshes · stump cap mesh | Separable limb meshes with stump caps; ≥2 LODs; matching skeleton. |
| `body.nudity.full` | anatomical full body mesh ue5 · nude base mesh metahuman compatible | Full anatomical base; ≥3 LODs; matched to the character skeleton. |
| `body.nudity.partial` | anatomical body base mesh ue5 · underwear body base | Base body with underwear shell; ≥2 LODs. |
| `violence.torture.sequence` | restraint sequence animation ue5 · prolonged distress animation set | Sustained sequences with looping distress idles. |
| `death.agony.animation` | dying animation ue5 · death agony motion capture · collapsed breathing animation | Drawn-out dying performance, no fade-out; blends to ragdoll. |

Two practical warnings. **Licences are per account and per pack**: some Fab packs are
personal-use only, and a class resolving does not mean it is licensed for a build
you distribute. **Adult anatomy is scarce and heavily verified**: expect age checks,
and expect several classes to have no acceptable asset at all. The resolver will
name them; the game runs with those classes absent rather than with a substitute.

Voice sets are not a resolver class yet. `UHASVoiceComponent` expects a male and a
female `FHASVoiceSet` assigned in a Blueprint or data asset; buy or record those
separately and assign them after the first build.

## 4.4 Put the files where the installer can read them

1. Claim the packs on Fab.
2. Download them. The Fab plugin's **Add to Project** puts content straight into
   `Content/`; the web library gives you a zip. For this pipeline, prefer the zip.
3. Extract every zip into one flat folder, e.g. `D:/Fab`, so each pack is its own
   subfolder. **The import script walks files; it does not unpack archives**, and it
   ignores nested zips. If `--drop` contains only `.zip` files, `import` will
   "succeed" with nothing imported.

## 4.5 Write the library index

The installer matches against JSON, not against the disk. One file per pack, any
filenames, all `*.json` in the folder are read in sorted order:

```json
{
  "pack": "Fab — Practical Effects Vol.1",
  "assets": [
    {
      "id": "/Game/Fab/PracticalFX/SM_BloodPool_A",
      "name": "Blood Pool A",
      "kind": "decal",
      "tags": ["blood", "pool", "decal"],
      "triangles": 1800,
      "lods": 2,
      "animated": false,
      "license": "Fab Standard"
    }
  ]
}
```

`kind` must be one of `mesh`, `material`, `decal`, `animation`, `prop`. `id` is the
Unreal soft path. `fixtures/library/` contains three complete examples.

You do not have to get the index perfect first. Run once with no `--drop`: the
resolver prints every class it cannot fill and the exact search terms for each, and
writes `Docs/IMPORT_CHECKLIST.csv`. After a successful import, the pipeline
re-resolves against what *actually landed in the engine* and rewrites the registry,
so a pack whose asset is named `SM_BloodPool_02` rather than `SM_BloodPool_A` still
ends up wired to the real path.

## 4.6 Run it

```bash
# 1. Get the code
git clone https://github.com/erschindler/house-arrest.git
cd house-arrest

# 2. Check the machine before anything is written
npm run preflight -- --engine-root "C:/Program Files/Epic Games/UE_5.5"

# 3. See the plan without executing it
npm run run -- --dry-run

# 4. Offline: generate the project, plugin, components and the gap report
npm run run -- --library fixtures/library --settings dev

# 5. Full run: import your extracted packs, build the room, compile
npm run run -- \
  --library "D:/FabLibrary" \
  --drop "D:/Fab" \
  --engine-root "C:/Program Files/Epic Games/UE_5.5" \
  --settings dev \
  --project ue/HouseArrest
```

`--library` and `--drop` in that last command are placeholders, and the installer
cannot create either. `--library` must be a folder you made that holds your `*.json`
index files; `--drop` must be the folder you extracted your packs into. Until both
exist, run the offline command from step 4 — `npm run run -- --library
fixtures/library --settings dev` — which generates the whole project and prints every
class it could not fill.

`--engine` must name the version you actually installed: `--engine 5.8` for a UE_5.8
folder. Preflight refuses a mismatch, because `EngineAssociation` in the `.uproject`
would otherwise point at an engine this machine does not have.

`--settings dev` is required for this content: it is the only preset that permits
extreme violence, full nudity and dark themes. It raises content limits only; the
adults-only rule, the family prohibition and live consent are code and have no
setting to turn off.

If `import` or `verify` fails, the run stops and prints the path it could not
resolve. Fix the index or the pack and re-run; the pipeline is idempotent.

## 4.7 What you should see

- **In the terminal, immediately:** `npm run demo` prints the whole simulation,
  including the room, the officer recruitment, the session and the cautery. That
  works with no engine at all.
- **After stage 5:** `ue/HouseArrest/` containing the `.uproject`, `Source/Systems/`
  with 22 generated C++ files, five CSVs, four editor scripts (two room scripts,
  import, verify), and `Plugins/HASContent/` with the registry.
- **After `room` and `props`:** a level whose concealed volume is tagged
  `HAS.HiddenRoom` and whose props are tagged `HAS.RoomProp.*` — grey boxes at the
  anchors, because no meshes have been assigned yet.
- **After `build`:** a compiled `HouseArrestEditor`. The first compile is where the
  generated C++ meets the real API; expect to fix an include or a signature.

This is not yet a playable third-person demo. The room, its props and the components
exist and compile, but there is no player pawn, no input mapping and no UI wired to
them: the components are the contract, not the game. Section 8 lists that wiring as
the next step. Do not expect to walk around on the first build.

## Troubleshooting the first run

### PowerShell refuses to run `npm`

`npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running
scripts is disabled on this system` is Windows' execution policy blocking
PowerShell's npm wrapper. Node is fine. Call the batch wrapper instead, which the
policy does not cover:

```powershell
npm.cmd run preflight
npm.cmd run run -- --library C:\HouseArrest\library --drop C:\HouseArrest\Fab `
  --engine-root "C:\Program Files\Epic Games\UE_5.5" --settings dev
```

To fix it permanently, `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
allows local scripts without administrator rights. Do not set `Unrestricted`, and do
not change the machine-wide policy for this.

The pipeline itself is not affected: it launches `UnrealEditor-Cmd.exe` directly and
runs `Build.bat` / `RunUAT.bat` through `cmd.exe`, never through PowerShell.

| Symptom | Cause |
| --- | --- |
| `UnrealEditor-Cmd not found` | `--engine-root` is the project folder, not the folder *containing* `Engine/`. |
| `-run=pythonscript` does nothing | The `PythonScriptPlugin` is disabled. The generated `.uproject` enables it; a hand-merged project may not. |
| `EditorAssetLibrary` is `None` | `EditorScriptingUtilities` disabled, same fix. |
| build fails on `cl.exe` | The VS C++ workload is missing, or you are in a plain "Developer Command Prompt" instead of letting UBT find MSVC. |
| import "succeeds" but imports nothing | The drop folder only has `.zip`/`.rar` in it. Extract first; the script walks files, it does not unpack archives. |
| Everything is slow the first time | Derived data cache. It is a one-time cost of 10–40 minutes. |

---

# 5. What the simulation core implements

| Brief section | Here |
| --- | --- |
| 2 — age gate / content settings | `src/content/gate.ts` — per-save toggles, monotonic ranking, un-toggleable hard invariants |
| 4 — autonomous NPCs | `src/sim/schedule.ts`, `src/sim/needs.ts`, `src/sim/lod.ts`, `src/worldgen/population.ts` |
| 5 — relationships | `src/sim/relationship.ts` — ten independent axes, decay, family lock |
| 5/18.3 — consent | `src/sim/consent.ts` — explicit state machine, live re-validation, hard stops |
| 5B — kink negotiation | `src/sim/kink.ts` — counter-offers, hard limits, trust-derived ceilings |
| 5/7 — aftermath, rumors | `src/sim/memory.ts`, `src/sim/gossip.ts` |
| 7 — injury, violence, investigation | `src/sim/anatomy.ts`, `injury.ts`, `violence.ts`, `investigation.ts` |
| 11 — household | `src/sim/household.ts` — dynamic issues, condition, contractor lead times |
| 13 — economy | `src/sim/economy.ts` |
| 14 — dynamic events | `src/sim/events.ts` — weighted candidates, cooldowns, gate filtering |
| 8 — fictional internet | `src/sim/net.ts` — NPC feed, player posting, exposure, gated listings |
| 9 — phone | `src/sim/phone.ts` — threads, failing calls, blocking, generated inbound |
| 4/12 — space | `src/sim/space.ts` — 12-room floorplan, 40 anchors, occupancy, transforms |
| 13/19 — work | `src/sim/jobs.ts` — six remote jobs, per-minute accrual, absences, firing |
| progression | `src/sim/goals.ts` — six weighted objectives plus the threshold in agoraphobic mode, six endings |
| premise — confinement | `src/sim/confinement.ts` — fear, tolerance, doorstep panics, exposure practice, legal variant |
| 7/12 — leverage | `src/sim/manipulation.ts` — six leverage axes, compounding pressure, seven roles including police, betrayal |
| 12 — concealed room | `src/sim/facility.ts` — staged build, contractors as witnesses, sound rating, concealment, discovery |
| 7 — custody | `src/sim/custody.ts` — restraints, feeding, noise, escape attempts |
| 7 — detailed trauma | `src/sim/torture.ts` — organs, limbs, nails, cautery, tourniquets, airway, shock, infection |
| 15 / 18.6 — UE5 asset gating | `src/content/presentation.ts`, `src/tools/` |
| dev testing preset | `src/content/presets.ts` |
| 16/18.13/18.14 — determinism & saves | `src/core/rng.ts`, `src/save/serialize.ts`, `World.snapshot()` |

## The five slices that closed the gap

| Module | What it does | What it deliberately does not |
| --- | --- | --- |
| `space.ts` | A fixed 12-room floorplan with 40 mount points, occupancy derived from schedules, and `world.placements()` returning a transform per resident on the lot. | No navmesh, doors or pathfinding. Characters are *at* anchors, not walking between them. |
| `phone.ts` | Threads, calls that fail for real reasons (asleep, mid-shift, blocked), and inbound messages generated from the relationship that would actually send them. | No branching dialogue. A message is a line, an effect and a memory. |
| `net.ts` | An NPC feed derived from schedules and mood, player posting with real gating, an exposure score the investigation can read, and three abstract listings behind `darkThemes`. | Not a network. No real accounts, no virality model, no procedures described. |
| `jobs.ts` | Six remote or on-property jobs, minute-accurate accrual, daily absence counting, firing on the third miss. | No career ladder, promotions or skill tree. |
| `goals.ts` | Six weighted objectives read off world state, and five endings: arrest, eviction, condemnation, isolation, stable. | Not a quest system. It scores and concludes; it does not create content. |

Taking a job rewrites the player's day, so the spatial layer puts them at the desk
for the shift and the phone stops finding them free. That is the point of the
slice: work is a *place*, not a timer. Placement consumes no randomness, so adding
a room cannot shift a save's future — the anchor is chosen by hashing the
character, the day and the schedule block.

## The room, and the body in it

| Module | What it does | Where the line is |
| --- | --- | --- |
| `confinement.ts` | Fear, tolerance, anxiety, doorstep approaches and exposure practice. Avoidance compounds and lowers the ceiling; practice is the only way down. | No "leave the house" button. Crossing the threshold is a state transition with a panic chance, not a menu choice. |
| `manipulation.ts` | Six leverage axes derived from state, pressure that compounds across attempts, seven roles, orders that move heat and witnesses, and betrayal when suspicion outruns loyalty. | Police are ordinary NPCs with higher resistance. There is no bribe button and no scripted corruption scene. |
| `facility.ts` | A seven-stage build with cost, hours and a named contractor per stage; sound rating and concealment that decay with use. | No construction automation. The room is a state machine the editor script builds geometry for; nothing is placed at runtime. |
| `custody.ts` | Restraint, gag, feeding, terror, escape attempts, and the noise the room has to contain. | Captives are held physically, not narratively. `take()` refuses family, the player and anyone under 18. |
| `torture.ts` | Organs with integrity and lethality, limbs with tourniquet clocks, nails, cautery that trades bleeding for infection, airway death on a timer, shock and dissociation. | The numbers are balance, not technique: millilitres per minute, not instructions. Every act is content-gated and the module contains no real-world procedure. |

The detailed body exists only inside the room. Elsewhere a character is a schedule,
a relationship graph and a coarse injury state; behind that door the same character
is ten organs, four limbs and a blood volume, and the mesh that gets swapped in is a
different asset class with its own gate.

Turning a police officer is deliberately the most expensive thing in the game:
resistance around 60–80, a compliance threshold of 65%, and a suspicion clock that
keeps running while you use them. An officer who turns can cover a scene, damp a
witness statement or deliver someone to the door — and one who breaks becomes a
reported witness, a statement and heat in a single night.

## The four rules the engine enforces

1. **Consent is a state machine, not a flag.** `begin()` throws unless both
   participants affirmed. Every act call throws unless the state is `active`.
   Willingness is re-rolled every beat, so an NPC ends the scene themselves. A
   safeword ends the scene from any live state and the scene is then unresumable.
   Toggling explicit content off ends a running scene.
2. **No content setting can widen the hard invariants.** Non-adults are rejected at
   scene construction and in `assertHardInvariants`; family pairs are rejected by
   both the relationship store and the scene; every generator asks the gate first.
   Disabling a category makes it unrepresentable, not merely hidden.
3. **The world is reproducible.** One seeded PRNG, serialized in the save. No
   `Math.random()`, no `Date.now()`. `world.hash()` is a fingerprint of the entire
   simulated state, and the tests assert that two worlds with the same seed stay
   identical for a week and that a saved world resumes on the same trajectory.
4. **Confinement is a state, not a sentence.** The default premise is agoraphobic:
   fear and tolerance decide what the player can do at the door, and avoidance
   compounds. Legal confinement is a separate mode with a monitor and a breach
   penalty. The arrest ending now depends on actual investigative heat, not on the
   premise the game started with.

## Architecture

```
core/      rng (seeded, serializable)   clock
content/   gate (toggles + hard invariants)   presentation (asset classes)   presets
sim/       types, relationship, memory, needs, schedule, lod, kink, consent,
           gossip, household, economy, events, space, phone, net, jobs, goals,
           confinement, manipulation, facility, custody, torture, world
worldgen/  deterministic adult population + social graph
save/      canonical, hashable snapshot
tools/     requirements, library, resolver, ue5 (plugin emitter),
           project (UE scaffold), ue-systems (gameplay C++ emitter),
           pipeline (plan), run (orchestrator)
demo.ts    runnable tour
```

`World.tick()` runs one ordered pipeline per simulated minute:

```
clock → tier refresh → NPC needs/schedule → active scene beat (every 5m)
      → phone → net → work accrual → confinement → custody → session physiology
      → event engine → contractor completion
      → (midnight) daily systems: yesterday's shift, bills, leverage drift,
        room decay, escapes and betrayals
```

Tiers: `full` (on property, 1 min), `coarse` (nearby/expected, 15 min),
`statistical` (the rest of the city, 720 min). All tiers run the same schedule and
need functions, so an off-screen character's state reflects the time that passed.
Nothing is ever "spawned on demand".

---

# 6. Content settings, and the dev preset

```bash
npm run dev:demo                     # or: npm run demo -- --dev-unrestricted
npm run run -- --settings dev        # pipeline, all classes loadable
```

`dev` raises every *content* limit: explicit sexual content, full nudity, extreme
violence, dark themes, all eleven kink categories. Every asset class in the manifest
becomes loadable and the pipeline will wire them all.

**What the preset is:** a `ContentSettings` object. **What it is not:** a switch for
the hard invariants. The adults-only rule, the family prohibition and live consent
are code with no configuration input — `assertHardInvariants`,
`RelationshipStore.markFamily` and the consent state machine — so there is nothing
for it to turn off. `test/presentation.test.ts` asserts the invariants still hold
*under the preset itself* rather than taking that on trust.

Removing the preset at ship time is three deletions, listed at the top of
`src/content/presets.ts`; nothing else references it.

---

# 7. Deliberately not here

- Rendering, animation, audio, UI. The core is engine-agnostic on purpose: the data
  model maps to UE5 `UObject`/`UDataAsset` plus a subsystem per module, and the
  seeded RNG maps to `FRandomStream`.
- Any explicit or graphic text. The adult and violence systems exist here as
  **state, gating and consequence** — the part that must be engine-side and
  unskippable. Presentation is a separate layer permitted to show only what the
  current state allows.
- A renderer, and a UE client. `world.placements()` produces transforms and
  `space.ts` holds the floorplan a level must be built to; nothing draws either
  yet.
- **Real-world procedure.** The trauma model is a table of numbers: bleed rates,
  organ lethality, infection onset, tourniquet time. There is no technique, dosage,
  material guidance or step ordering in the data tables, and the generated C++ does
  not invent any.

## Next, in order

1. **A golden-hash parity harness.** Record `world.hash()` for N seeds × durations
   from the TypeScript implementation, then require a C++ port to reproduce it
   exactly. Without an oracle, a port diverges silently.
2. **A UE client over the transforms.** `world.placements()` already returns a room,
   an anchor and a position for every resident on the lot. The remaining work is a
   subsystem that drives actors from it, over a level built to the `space.ts`
   floorplan.
3. **Replace the placeholder leverage numbers in the C++.** The generated
   `UHASManipulationComponent` returns fixed strengths from `LeverageStrength()`;
   those become real reads once the relationship store is ported. The shape is
   right, the values are not data yet.
4. **Port in dependency order:** `rng → clock → space → world tick →
   schedule/needs/lod → relationship/memory → phone/net/jobs → confinement →
   consent → gate/registry`. Consent last to port and first to parity-test: a
   subtle translation bug there is unacceptable, not merely annoying.

---

# 8. Status

- Simulation core: 29 content classes, 11 kink categories, 12 rooms with 40 anchors,
  6 jobs, 7 objectives, 6 endings, confinement, leverage, a concealed room, custody,
  an organ-level trauma model and a contact/blood/clothing layer. Full save/load,
  deterministic. 156 tests.
- Installer and pipeline: eleven stages, Node-side stages tested, generated artifacts
  asserted. The project stage emits 22 C++ files, five data tables, two room scripts
  and two systems documents.
- Generated C++, editor Python and engine invocations: **written, never executed**.
  No engine exists in this repository, so nothing in `ue/` has been compiled or run.
  That is a statement of fact, not a disclaimer: it is the first thing you should
  expect to work on.

Adults-only subject matter. This repository ships no art and no licensed content —
add your own `LICENSE` before distributing, and read the Fab licence on every pack
you wire in.
