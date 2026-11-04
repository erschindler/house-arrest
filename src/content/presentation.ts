/**
 * The presentation seam (brief Sections 3, 15, 18.6).
 *
 * This is the framework the UE5 content plugs into. Every graphical asset family
 * the game can show — gore decals, dismemberment, nudity states, explicit
 * intimacy animation, kink props, brutal-violence animation, dying animation — is
 * declared once, here, with the content requirement that permits it. The renderer
 * asks this gate before anything is loaded, streamed or attached to a mesh.
 *
 * Consequences that matter for the build:
 *
 *   - Art can be integrated with a manifest entry and no engine-side branching.
 *   - A disabled level means the asset is never requested: the shove that
 *     replaces a stabbing has no wound object, so no gore decal has a target.
 *   - The manifest is the review surface. Auditing what the game can display is
 *     reading one array, not grepping the project.
 */

import type { ContentGate, ContentTag, FetishCategory } from "./gate.ts";
import { FETISH_CATEGORIES } from "./gate.ts";

export type AssetClass =
  | "gore.blood.decal"
  | "gore.wound.layer"
  | "gore.organ.decal"
  | "gore.dismemberment"
  | "gore.decomposition.stage"
  | "violence.brutal.animation"
  | "violence.torture.sequence"
  | "torture.room.interior"
  | "torture.room.hiddenDoor"
  | "torture.instrument.set"
  | "anatomy.detail.mesh"
  | "anatomy.cross.section"
  | "death.agony.animation"
  | "body.nudity.partial"
  | "body.nudity.full"
  | "intimacy.animation.suggestive"
  | "intimacy.animation.explicit"
  | "appearance.fetish.outfit"
  | `kink.prop.${FetishCategory}`;

export type AssetRequirement = {
  assetClass: AssetClass;
  /** All of these must be permitted for the asset class to be loadable. */
  requires: ContentTag[];
  /** What the UE5 side is expected to provide for this class. */
  note: string;
};

const kinkProps: AssetRequirement[] = FETISH_CATEGORIES.map((category) => ({
  assetClass: `kink.prop.${category}` as AssetClass,
  requires: [{ kind: "fetish", category, intensity: 0 } as ContentTag],
  note: `Props and costuming for the ${category} category; only loadable when that category is opted in.`,
}));

export const UE5_ASSET_MANIFEST: AssetRequirement[] = [
  {
    assetClass: "gore.blood.decal",
    requires: [{ kind: "violence", level: "graphic" }],
    note: "Blood spatter, pooling and drying decals; persistence on surfaces and clothing.",
  },
  {
    assetClass: "gore.wound.layer",
    requires: [{ kind: "violence", level: "graphic" }],
    note: "Layered wound materials (skin, muscle, bone, organ) driven by Wound.severities.",
  },
  {
    assetClass: "gore.organ.decal",
    requires: [{ kind: "violence", level: "extreme" }],
    note: "Deep-tissue and organ exposure materials. Extreme only.",
  },
  {
    assetClass: "gore.dismemberment",
    requires: [{ kind: "violence", level: "extreme" }],
    note: "Separable meshes and stump capping. Extreme only.",
  },
  {
    assetClass: "gore.decomposition.stage",
    requires: [
      { kind: "violence", level: "extreme" },
      { kind: "dark" },
    ],
    note: "Body-after states: staining, insects, odour volumes. Extreme plus dark themes.",
  },
  {
    assetClass: "violence.brutal.animation",
    requires: [{ kind: "violence", level: "graphic" }],
    note: "Struggle, grapple and impact animations for close-quarters violence.",
  },
  {
    assetClass: "violence.torture.sequence",
    requires: [
      { kind: "violence", level: "extreme" },
      { kind: "dark" },
    ],
    note: "Sustained-cruelty sequences. Requires extreme violence and dark themes together.",
  },
  {
    assetClass: "torture.room.interior",
    requires: [
      { kind: "violence", level: "extreme" },
      { kind: "dark" },
    ],
    note: "Concealed room interior: wash-down surfaces, drainage, isolated lighting.",
  },
  {
    assetClass: "torture.room.hiddenDoor",
    requires: [
      { kind: "violence", level: "extreme" },
      { kind: "dark" },
    ],
    note: "Concealed door mechanism and its 'sealed' state. Nothing loads while the room is undiscovered.",
  },
  {
    assetClass: "torture.instrument.set",
    requires: [
      { kind: "violence", level: "extreme" },
      { kind: "dark" },
    ],
    note: "Instrument meshes paired with TOOL_SPECS. One asset per tool id, no procedural variants.",
  },
  {
    assetClass: "anatomy.detail.mesh",
    requires: [
      { kind: "violence", level: "extreme" },
      { kind: "nudity", level: "full" },
    ],
    note: "High-detail body mesh used only in the room; swaps in for the low-detail world mesh.",
  },
  {
    assetClass: "anatomy.cross.section",
    requires: [
      { kind: "violence", level: "extreme" },
      { kind: "dark" },
    ],
    note: "Cross-section and organ-exposure materials driven by FOrganState. Extreme only.",
  },
  {
    assetClass: "death.agony.animation",
    requires: [{ kind: "violence", level: "graphic" }],
    note: "Slow dying performance; no fade-out, per brief §7.",
  },
  {
    assetClass: "body.nudity.partial",
    requires: [{ kind: "nudity", level: "partial" }],
    note: "Partial undress states, underwear-level.",
  },
  {
    assetClass: "body.nudity.full",
    requires: [{ kind: "nudity", level: "full" }],
    note: "Full anatomical nudity meshes and skin materials.",
  },
  {
    assetClass: "intimacy.animation.suggestive",
    requires: [{ kind: "sexual", level: "suggestive" }],
    note: "Implied intimacy, clothed or obscured.",
  },
  {
    assetClass: "intimacy.animation.explicit",
    requires: [
      { kind: "sexual", level: "explicit" },
      { kind: "nudity", level: "full" },
    ],
    note: "Explicit intimacy animation. Requires explicit content and full nudity together.",
  },
  {
    assetClass: "appearance.fetish.outfit",
    requires: [{ kind: "sexual", level: "suggestive" }],
    note: "Kink-adjacent wardrobe that is not itself category-specific.",
  },
  ...kinkProps,
];

export type PresentationReport = {
  assetClass: AssetClass;
  allowed: boolean;
  missing: ContentTag[];
};

/** Look up the manifest row for a class. Used by the installer and validators. */
export function requirementFor(assetClass: AssetClass): AssetRequirement | undefined {
  return UE5_ASSET_MANIFEST.find((entry) => entry.assetClass === assetClass);
}

export class PresentationGate {
  private readonly gate: ContentGate;
  private readonly requirements = new Map<AssetClass, AssetRequirement>();

  constructor(gate: ContentGate) {
    this.gate = gate;
    for (const entry of UE5_ASSET_MANIFEST) this.requirements.set(entry.assetClass, entry);
  }

  /**
   * Unknown classes are never loadable: an asset that is not in the manifest has
   * not been reviewed, so it must not reach the renderer.
   */
  allows(assetClass: AssetClass): boolean {
    const requirement = this.requirements.get(assetClass);
    if (!requirement) return false;
    return requirement.requires.every((tag) => this.gate.allows(tag));
  }

  available(): AssetClass[] {
    return [...this.requirements.keys()].filter((assetClass) => this.allows(assetClass));
  }

  report(): PresentationReport[] {
    return [...this.requirements.values()].map((requirement) => ({
      assetClass: requirement.assetClass,
      allowed: requirement.requires.every((tag) => this.gate.allows(tag)),
      missing: requirement.requires.filter((tag) => !this.gate.allows(tag)),
    }));
  }

  noteFor(assetClass: AssetClass): string {
    return this.requirements.get(assetClass)?.note ?? "unregistered asset class";
  }
}
