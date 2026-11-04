/**
 * Technical requirements for each content class (brief Sections 3 and 15).
 *
 * The design side says "the game needs blood decals and a dismemberment mesh".
 * This file says what that *means* technically — asset kind, keywords that
 * identify a suitable asset, LOD and triangle constraints — so an installer can
 * match a real asset library against it instead of a human reading a spreadsheet.
 */

import { FETISH_LABELS, FETISH_CATEGORIES } from "../content/gate.ts";
import type { FetishCategory } from "../content/gate.ts";
import type { AssetClass } from "../content/presentation.ts";

export type AssetKind = "mesh" | "material" | "decal" | "animation" | "prop";

export const ASSET_KINDS: AssetKind[] = ["mesh", "material", "decal", "animation", "prop"];

export type AssetSpec = {
  assetClass: AssetClass;
  kind: AssetKind;
  keywords: string[];
  requiresLods: boolean;
  maxTriangles: number;
  animated: boolean;
  /** What to type into Fab, and what to check before accepting a pack. */
  searchTerms: string[];
  acceptance: string;
};

const specs = new Map<AssetClass, AssetSpec>();

function add(spec: AssetSpec): void {
  specs.set(spec.assetClass, spec);
}

add({
  assetClass: "gore.blood.decal",
  kind: "decal",
  keywords: ["blood", "spatter", "pool", "decal"],
  requiresLods: false,
  maxTriangles: 5000,
  animated: false,
  searchTerms: ["blood decal pack ue5", "blood splatter material decal", "forensic blood pool decal"],
  acceptance: "Deferred decal or material-decal pair; supports surface and cloth projection; ≤5k triangles per decal.",
});

add({
  assetClass: "gore.wound.layer",
  kind: "material",
  keywords: ["wound", "material", "flesh", "skin"],
  requiresLods: false,
  maxTriangles: 0,
  animated: false,
  searchTerms: ["layered wound material ue5", "flesh wound master material", "injury mask material"],
  acceptance: "Master material with per-layer (skin/muscle/bone/organ) parameter masks.",
});

add({
  assetClass: "gore.organ.decal",
  kind: "decal",
  keywords: ["organ", "gore", "decal"],
  requiresLods: false,
  maxTriangles: 8000,
  animated: false,
  searchTerms: ["gore organ decal ue5", "anatomical gore decal pack"],
  acceptance: "Extreme-level tissue decals; must be separable from the standard blood set.",
});

add({
  assetClass: "gore.dismemberment",
  kind: "mesh",
  keywords: ["dismember", "sever", "limb"],
  requiresLods: true,
  maxTriangles: 60000,
  animated: false,
  searchTerms: ["dismemberment limbs ue5", "severed limb static meshes", "stump cap mesh"],
  acceptance: "Separable limb meshes with stump capping; ≥2 LODs; matching skeleton.",
});

add({
  assetClass: "gore.decomposition.stage",
  kind: "material",
  keywords: ["decomposition", "decay", "insect", "stain"],
  requiresLods: false,
  maxTriangles: 0,
  animated: false,
  searchTerms: ["decomposition material stages ue5", "decay stain material", "insect swarm particle"],
  acceptance: "Stage-parameterised decay material plus a stain layer.",
});

add({
  assetClass: "violence.brutal.animation",
  kind: "animation",
  keywords: ["brutal", "struggle", "grapple", "impact"],
  requiresLods: false,
  maxTriangles: 0,
  animated: true,
  searchTerms: ["brutal struggle animation ue5", "close quarters grapple animation", "impact reaction animation"],
  acceptance: "Root-motion struggle/impact set with IK-friendly hands.",
});

add({
  assetClass: "violence.torture.sequence",
  kind: "animation",
  keywords: ["torture", "prolong", "restraint"],
  requiresLods: false,
  maxTriangles: 0,
  animated: true,
  searchTerms: ["restraint sequence animation ue5", "prolonged distress animation set"],
  acceptance: "Sustained sequences with looping distress idles; reviewable as a distinct set.",
});

add({
  assetClass: "death.agony.animation",
  kind: "animation",
  keywords: ["dying", "agony", "death"],
  requiresLods: false,
  maxTriangles: 0,
  animated: true,
  searchTerms: ["dying animation ue5", "death agony motion capture", "collapsed breathing animation"],
  acceptance: "Drawn-out dying performance, no fade-out; blends to ragdoll at the end.",
});

add({
  assetClass: "body.nudity.partial",
  kind: "mesh",
  keywords: ["nudity", "partial", "underwear", "torso"],
  requiresLods: true,
  maxTriangles: 80000,
  animated: false,
  searchTerms: ["anatomical body base mesh ue5", "underwear body base"],
  acceptance: "Base body with underwear shell; ≥2 LODs; adult proportions.",
});

add({
  assetClass: "body.nudity.full",
  kind: "mesh",
  keywords: ["nudity", "full", "anatomical", "body"],
  requiresLods: true,
  maxTriangles: 120000,
  animated: false,
  searchTerms: ["anatomical full body mesh ue5", "nude base mesh metahuman compatible"],
  acceptance: "Full anatomical base; ≥3 LODs; matched to the character skeleton.",
});

add({
  assetClass: "intimacy.animation.suggestive",
  kind: "animation",
  keywords: ["intimacy", "suggestive", "implied"],
  requiresLods: false,
  maxTriangles: 0,
  animated: true,
  searchTerms: ["intimacy implied animation ue5", "clothed embrace animation set"],
  acceptance: "Clothed/obscured set that works without the nudity meshes.",
});

add({
  assetClass: "intimacy.animation.explicit",
  kind: "animation",
  keywords: ["intimacy", "explicit", "act"],
  requiresLods: false,
  maxTriangles: 0,
  animated: true,
  searchTerms: ["adult animation set ue5 (licensed, 18+)", "explicit intimacy motion capture"],
  acceptance: "Must ship with written 18+ licensing and performer consent documentation.",
});

add({
  assetClass: "appearance.fetish.outfit",
  kind: "prop",
  keywords: ["outfit", "wardrobe", "fetish"],
  requiresLods: true,
  maxTriangles: 40000,
  animated: false,
  searchTerms: ["fetish wardrobe outfit ue5", "alternative clothing pack"],
  acceptance: "Modular outfit with ≥2 LODs and cloth-friendly topology.",
});

function kinkSpec(category: FetishCategory): AssetSpec {
  return {
    assetClass: `kink.prop.${category}`,
    kind: "prop",
    keywords: ["prop", category.toLowerCase()],
    requiresLods: true,
    maxTriangles: 30000,
    animated: false,
    searchTerms: [`${FETISH_LABELS[category]} prop ue5`, "adult prop pack (licensed, 18+)"],
    acceptance: "Prop set for the category; ≥2 LODs; 18+ licensed source only.",
  };
}

for (const category of FETISH_CATEGORIES) add(kinkSpec(category));

export function specFor(assetClass: AssetClass): AssetSpec {
  const spec = specs.get(assetClass);
  if (!spec) throw new Error(`no asset requirement registered for ${assetClass}`);
  return spec;
}

export function allSpecs(): AssetSpec[] {
  return [...specs.values()];
}
