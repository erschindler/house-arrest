# HOUSE ARREST — simulation core (prototype)

A headless, deterministic, content-neutral prototype of the systems the *HOUSE
ARREST* design brief is actually made of. No Unreal Engine, no assets, no
rendering: this is the part of the game that decides whether the rest of it can
work — persistent people, consequential relationships, a live consent machine, and
a world that saves and restores completely.

Runs on Node 26 with **zero dependencies**. TypeScript via native type stripping.

```bash
npm run demo       # 30-second tour: world sim, consent machine, save/load, cost
npm test           # test suite
npm run typecheck  # tsc --noEmit
```

## What is implemented

| Brief section | Here |
| --- | --- |
| 2 — age gate / content settings | `src/content/gate.ts` — per-save toggles, monotonic ranking, un-toggleable hard invariants |
| 4 — autonomous NPCs | `src/sim/schedule.ts`, `src/sim/needs.ts`, `src/sim/lod.ts`, `src/worldgen/population.ts` |
| 5 — relationships | `src/sim/relationship.ts` — ten independent axes, decay, family lock |
| 5/18.3 — consent | `src/sim/consent.ts` — explicit state machine, live re-validation, hard stops |
| 5B — kink negotiation | `src/sim/kink.ts` — counter-offers, hard limits, trust-derived ceilings |
| 5/7 — aftermath, rumors | `src/sim/memory.ts`, `src/sim/gossip.ts` |
| 11 — household | `src/sim/household.ts` — dynamic issues, condition, contractor lead times |
| 13 — economy | `src/sim/economy.ts` |
| 14 — dynamic events | `src/sim/events.ts` — weighted candidates, cooldowns, gate filtering |
| 7 — injury, violence, investigation | `src/sim/anatomy.ts`, `injury.ts`, `violence.ts`, `investigation.ts` |
| 15 / 18.6 — UE5 asset gating | `src/content/presentation.ts` — asset-class manifest filtered by the gate |
| dev testing preset | `src/content/presets.ts` — all content limits at maximum |
| 16/18.13/18.14 — determinism & saves | `src/core/rng.ts`, `src/save/serialize.ts`, `World.snapshot()` |

## The three rules the engine enforces

1. **Consent is a state machine, not a flag.** `begin()` throws unless both
   participants affirmed. Every act call throws unless the state is `active`.
   Willingness is re-rolled every beat, so an NPC ends the scene themselves.
   A safeword ends the scene from any live state and the scene is then
   unresumable. Toggling explicit content off ends a running scene.
2. **No content setting can widen the hard invariants.** Non-adults are rejected
   at scene construction and in `assertHardInvariants`; family pairs are rejected
   by both the relationship store and the scene; every generator asks the gate
   first. Disabling a category makes it unrepresentable, not merely hidden.
3. **The world is reproducible.** One seeded PRNG, serialized in the save. No
   `Math.random()`, no `Date.now()`. `world.hash()` is a fingerprint of the entire
   simulated state, and the tests assert that two worlds with the same seed stay
   identical for a week and that a saved world resumes on the same trajectory.

## Architecture

```
core/      rng (seeded, serializable)   clock
content/   gate (toggles + hard invariants)
sim/       types, relationship, memory, needs, schedule, lod,
           kink, consent, gossip, household, economy, events, world
worldgen/  deterministic adult population + social graph
save/      canonical, hashable snapshot
demo.ts    runnable tour
```

`World.tick()` runs one ordered pipeline per simulated minute:

```
clock → tier refresh → NPC needs/schedule → active scene beat (every 5m)
      → event engine → contractor completion → (midnight) daily systems
```

Tiers: `full` (on property, 1 min), `coarse` (nearby/expected, 15 min),
`statistical` (the rest of the city, 720 min). All tiers run the same schedule and
need functions, so an off-screen character's state reflects the time that passed.
Nothing is ever "spawned on demand".

## Testing with every content limit off

```bash
npm run dev:demo        # or: npm run demo -- --dev-unrestricted
```

This selects the `devUnrestricted` preset: explicit sexual content, full nudity,
extreme violence, dark themes, and all eleven kink categories — every asset class
in the manifest becomes loadable.

**What the preset is:** a `ContentSettings` object. **What it is not:** a switch for
the hard invariants. The adults-only rule, the family prohibition and live consent
are implemented in `assertHardInvariants`, `RelationshipStore.markFamily` and the
consent state machine — code with no configuration input — so there is nothing for
the preset to turn off. `test/presentation.test.ts` asserts this under the preset
itself rather than taking it on trust.

Removing the preset at ship time is three deletions, listed at the top of
`src/content/presets.ts`; nothing else references it.

## Deliberately not here

- Rendering, assets, animation, audio, Unreal integration. Engine-agnostic on
  purpose: the data model maps to UE5 `UObject`/`UDataAsset` + a subsystem per
  module, and the deterministic RNG maps to a seeded `FRandomStream`.
- Any explicit or graphic text. The adult and violence systems exist here as
  **state, gating and consequence**, which is the part that must be engine-side
  and unskippable. Presentation is a separate layer that may only show what the
  current state permits.
- Violence/injury modelling (brief §7), the fictional internet (§8), phone (§9),
  jobs and world expansion (§19). They sit on the same world object and are the
  natural next slices.

## Reading the demo output

`npm run demo` prints four acts: a month of emergent life, the consent machine
driven end to end (refusal → affirmation → escalation → safeword → blocked
resume → toggle-off mid-scene), a save/restore hash comparison, and the measured
cost of 30 simulated days at 120 and 400 characters.
