# HOUSE ARREST

A deterministic, adults-only life/crime simulation, built as two halves that meet in
the middle:

- **`src/`** — a headless simulation core: persistent people, consequential
  relationships, a live consent state machine, an injury model, content gating, a
  floorplan with transforms, a phone, a fictional internet, remote work, weighted
  objectives and five endings, and a world that saves and restores exactly. No
  engine, no assets, zero dependencies.
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

# 1. What you need to install

Nothing below is downloadable by this repository: the engine is 60+ GB, the art is
licensed per account, and installing software is a decision only you can make.

## Required

| What | Where | Version | Why | Size |
| --- | --- | --- | --- | --- |
| **Unreal Engine 5** | Epic Games Launcher → Unreal Engine → Library → **+** | **5.5** (5.4 works; set `--engine 5.4`) | The engine itself. Installed *with* source or not, does not matter; **C++ projects** do. | 60 GB, 110 GB+ with debug symbols |
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

That is the whole machine. Nine stages, in dependency order:

| # | Stage | What it does | Needs |
| --- | --- | --- | --- |
| 1 | `preflight` | Checks Node, project name, library path, drop folder, engine install. Fails **before** writing anything. | — |
| 2 | `library` | Scans the asset index (every `*.json` in `--library`, sorted). | — |
| 3 | `resolve` | Matches all 24 content classes against it under your content settings: kind, keywords, LOD minimums, triangle budget. Records every rejection with a reason. | — |
| 4 | `content` | Writes the **HASContent plugin** into the project: `.uplugin`, C++ subsystem, `HASAssetRegistry.json` containing *only* classes your settings permit. | — |
| 5 | `project` | Scaffolds the UE5 project: `.uproject`, game/editor targets, module, configs, and the two editor scripts. | — |
| 6 | `import` | Runs `has_import.py` **inside Unreal**, importing the drop folder into `/Game/HASContent` and writing an index of what actually landed. | engine + `--drop` |
| 7 | `verify` | Runs `has_verify.py` inside Unreal: every path in the registry must actually load, or the pipeline stops. | engine |
| 8 | `build` | Compiles `<Project>Editor` for your platform with the engine's own `Build.bat` / `Build.sh`. | engine |
| 9 | `package` | `BuildCookRun` — build, cook, stage, pak, archive to `--archive`. | engine |

Stages 1–5 are pure Node and **always work**, on any machine, with no engine
installed. Stages 6–9 need an engine and are skipped with an explicit reason when
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
| `--engine <5.5>` | `5.5` | `EngineAssociation` written into the `.uproject`. |
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

- scanning a library index, matching all 24 content classes, ranking, rejecting with reasons
- content-gating the match result so a disabled level cannot reach the engine registry
- generating the plugin, the C++, the `.uproject`, the configs, the docs, the CSVs
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
  The plugin and project files are written to the UE 5.4/5.5 API and are ordinary
  boilerplate, but treat your first `build` stage as a debugging session: expect a
  missing include or an API rename, not a clean first pass.
- **The editor scripts have never been executed.** `has_import.py` and
  `has_verify.py` use the documented `unreal` API (`AssetImportTask`,
  `EditorAssetLibrary`, `EditorStaticMeshLibrary`). The first headless run will
  probably need a path or a flag fixed.

Everything in section 1–2 above the "not automated" line is real: the Node half is
covered by the test suite, including that gated classes cannot appear in the
registry and that two runs produce identical bytes.

---

# 4. First full run, in order

1. Install UE 5.5 and Visual Studio 2022 with the C++ workload. Reboot if the
   installer says so — a half-registered MSVC is the single most common first
   failure.
2. `git lfs install` (once per machine).
3. Install Node 26.
4. `npm run preflight -- --engine-root "C:/Program Files/Epic Games/UE_5.5"`. Fix
   whatever it lists. This takes seconds and catches ~80% of first-run pain.
5. Buy/claim the packs on Fab, then **download** them (Fab plugin → Add to Project,
   or the web library → download → extract). Put the extracted folders anywhere.
6. Point `--drop` at that folder and `--library` at a library index describing it.
   If you have no index yet: run without `--drop` first. The pipeline will tell you
   which classes it cannot find and print the exact Fab search terms for each.
7. `npm run run -- --drop ... --engine-root ... --settings mature`.
8. If `import` or `verify` fails, read the printed path and fix the index or the
   pack — the pipeline stops rather than building something half-wired.
9. Open `ue/HouseArrest/HouseArrest.uproject`. First open compiles shaders; that is
   the 20-minute wait, not a hang.
10. When you change content settings, re-run stages 3–5 only:
    `npm run run -- --only preflight,content` after `--settings`, or just re-run the
    whole thing — it is idempotent.

## Troubleshooting the first run

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
| progression | `src/sim/goals.ts` — six weighted objectives, five endings |
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

## The three rules the engine enforces

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

## Architecture

```
core/      rng (seeded, serializable)   clock
content/   gate (toggles + hard invariants)   presentation (asset classes)   presets
sim/       types, relationship, memory, needs, schedule, lod, kink, consent,
           gossip, household, economy, events, space, phone, net, jobs, goals,
           world
worldgen/  deterministic adult population + social graph
save/      canonical, hashable snapshot
tools/     requirements, library, resolver, ue5 (plugin emitter),
           project (UE scaffold), pipeline (plan), run (orchestrator)
demo.ts    runnable tour
```

`World.tick()` runs one ordered pipeline per simulated minute:

```
clock → tier refresh → NPC needs/schedule → active scene beat (every 5m)
      → phone → net → work accrual → event engine → contractor completion
      → (midnight) daily systems, closing out yesterday's shift and bills
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

## Next, in order

1. **A golden-hash parity harness.** Record `world.hash()` for N seeds × durations
   from the TypeScript implementation, then require a C++ port to reproduce it
   exactly. Without an oracle, a port diverges silently.
2. **A UE client over the transforms.** `world.placements()` already returns a room,
   an anchor and a position for every resident on the lot. The remaining work is a
   subsystem that drives actors from it, over a level built to the `space.ts`
   floorplan.
3. **Port in dependency order:** `rng → clock → space → world tick →
   schedule/needs/lod → relationship/memory → phone/net/jobs → consent →
   gate/registry`. Consent last to port and first to parity-test: a subtle
   translation bug there is unacceptable, not merely annoying.

---

# 8. Status

- Simulation core: 24 content classes, 11 kink categories, 12 rooms with 40 anchors,
  6 jobs, 6 objectives, 5 endings, full save/load, deterministic. 114 tests.
- Installer and pipeline: Node-side stages tested, generated artifacts asserted.
- Generated C++, editor Python and engine invocations: **written, never executed**.
  No engine exists in this repository, so nothing in `ue/` has been compiled or run.
  That is a statement of fact, not a disclaimer: it is the first thing you should
  expect to work on.

Adults-only subject matter. This repository ships no art and no licensed content —
add your own `LICENSE` before distributing, and read the Fab licence on every pack
you wire in.
