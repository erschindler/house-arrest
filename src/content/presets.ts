/**
 * Content presets, including the development preset you asked for.
 *
 * IMPORTANT — what "all limits off" means here.
 *
 * A preset is a `ContentSettings` object and nothing else. It can raise every
 * player-facing content limit to its maximum: explicit sexual content, full
 * nudity, extreme violence, dark themes, and all eleven kink categories. That is
 * what the dev preset does, and it is the only thing it does.
 *
 * It cannot reach the hard invariants, because those are not settings. The
 * adults-only rule, the family prohibition and live consent are implemented in
 * `assertHardInvariants`, `RelationshipStore.markFamily` and the consent state
 * machine — code paths with no configuration input. There is deliberately no
 * flag that disables them, so there is nothing for this preset to switch off.
 *
 * Removing the dev preset at ship time:
 *   1. set DEV_PRESETS_ENABLED to false, or delete `devUnrestricted` and
 *      `devUnrestrictedSettings` from this file;
 *   2. delete the `--dev-unrestricted` flag handling in `src/demo.ts`;
 *   3. delete the dev preset assertions in `test/presentation.test.ts`.
 * Nothing else in the project references it.
 */

import type { ContentSettings, FetishCategory } from "./gate.ts";
import { FETISH_CATEGORIES, assertSettingsValid, normalizeSettings } from "./gate.ts";

export type ContentPresetId = "safeDefault" | "mature" | "devUnrestricted";

/** Flip to false (or delete) when the game ships. */
export const DEV_PRESETS_ENABLED = true;

export type ContentPreset = {
  id: ContentPresetId;
  label: string;
  note: string;
  settings: ContentSettings;
};

export function devUnrestrictedSettings(): ContentSettings {
  const fetishes: Partial<Record<FetishCategory, boolean>> = {};
  for (const category of FETISH_CATEGORIES) fetishes[category] = true;

  const settings = normalizeSettings({
    sexual: "explicit",
    nudity: "full",
    violence: "extreme",
    darkThemes: true,
    fetishes,
  });

  // Belt and braces: the preset is validated like any other settings object, so a
  // bad preset fails loudly at construction instead of at play time.
  assertSettingsValid(settings);
  return settings;
}

export function contentPresets(): ContentPreset[] {
  return [
    {
      id: "safeDefault",
      label: "Default",
      note: "Conservative. No sexual content, no nudity, standard violence, no dark themes, no kink.",
      settings: normalizeSettings({}),
    },
    {
      id: "mature",
      label: "Mature",
      note: "Explicit sexual content, full nudity, graphic violence, dark themes, no kink categories.",
      settings: normalizeSettings({
        sexual: "explicit",
        nudity: "full",
        violence: "graphic",
        darkThemes: true,
      }),
    },
    {
      id: "devUnrestricted",
      label: "DEV — every content limit at maximum",
      note: "For testing content coverage. All eleven kink categories on, extreme violence, full nudity, dark themes. Hard invariants still apply.",
      settings: devUnrestrictedSettings(),
    },
  ];
}

export function presetFor(id: ContentPresetId): ContentPreset {
  const preset = contentPresets().find((entry) => entry.id === id);
  if (!preset) throw new Error(`unknown content preset: ${id}`);
  if (id === "devUnrestricted" && !DEV_PRESETS_ENABLED) {
    throw new Error("the dev content preset is disabled in this build");
  }
  return preset;
}

/**
 * The guarantee the preset relies on, asserted by the test suite rather than
 * merely documented: presets carry content settings, and the invariants are
 * enforced by code that reads none.
 */
export const PRESET_SCOPE = "ContentSettings only. Presets cannot alter the hard invariants.";
