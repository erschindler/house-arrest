/**
 * The body as a physical object: surface regions, tissue depth, structures, and
 * the seam where a collision becomes a wound.
 *
 * The organ model in `torture.ts` answers "what does this do to the body over
 * minutes". This module answers the question before it: "where did the tool
 * actually go, and what did it pass through on the way". Separating them keeps the
 * physics honest — a blade that grazes a rib should not reach a lung just because
 * the player aimed at the chest — while leaving the physiology in one place.
 *
 * Nothing here is instruction. Depths are millimetres of game geometry, bleed
 * rates are balance numbers, and the structures are named so the UI can say what
 * was hit. There are no sexual surfaces and no sexual interaction in this model:
 * the room is a violence system, and every contact it resolves is damage.
 */

import type { OrganId, ToolId, TortureRegion } from "./torture.ts";
import type { DressState } from "./anatomy.ts";

/** The organ-level regions plus the two that only matter for contact. */
export type SurfaceRegion = TortureRegion | "face" | "pelvis";

export type TissueLayer = "skin" | "fat" | "muscle" | "bone" | "cavity";

export type StructureKind = "bone" | "artery" | "vein" | "nerve" | "organ" | "tendon" | "cartilage" | "airway";

export type StructureSpec = {
  id: string;
  label: string;
  kind: StructureKind;
  /** Depth from the skin surface, millimetres. */
  depthMm: number;
  /** Lateral tolerance across the surface, 0..1 of the region's width. */
  spread: number;
  /** Centre of the structure across the surface, 0..1. */
  x: number;
  /** Millilitres per minute if opened. */
  bleed: number;
  /** Extra pain on a hit. */
  pain: number;
  /** Organ state this structure drives, when it is one. */
  organ?: OrganId;
  /** 0..1 chance the hit is immediately fatal; used by the physiology layer. */
  lethal?: number;
};

export type TissueProfile = {
  /** Thickness of each layer, millimetres. Bone depth is the surface of the bone. */
  skinMm: number;
  fatMm: number;
  muscleMm: number;
  boneMm: number;
  /** Depth at which the cavity (chest, abdomen, skull) is entered. */
  cavityMm: number;
  /** How wide the region is, for lateral hit tolerance. */
  widthCm: number;
  structures: StructureSpec[];
};

const S = (
  id: string,
  label: string,
  kind: StructureKind,
  depthMm: number,
  bleed: number,
  pain: number,
  x: number,
  spread: number,
  organ?: OrganId,
  lethal?: number,
): StructureSpec => ({ id, label, kind, depthMm, bleed, pain, x, spread, organ, lethal });

/**
 * Anatomically ordered by depth. The chest is the interesting one: a shallow
 * wound hits rib and nothing else; a deep one reaches heart or lung depending on
 * where across the chest it landed.
 */
export const TISSUE: Record<SurfaceRegion, TissueProfile> = {
  head: {
    skinMm: 3, fatMm: 3, muscleMm: 4, boneMm: 7, cavityMm: 12, widthCm: 18,
    structures: [
      S("scalpArtery", "scalp artery", "artery", 4, 22, 6, 0.3, 0.4),
      S("skull", "skull", "bone", 7, 0.4, 9, 0.5, 0.7),
      S("brain", "brain", "organ", 10, 30, 20, 0.5, 0.6, "brain", 1),
    ],
  },
  face: {
    skinMm: 2, fatMm: 4, muscleMm: 6, boneMm: 14, cavityMm: 30, widthCm: 14,
    structures: [
      S("facialArtery", "facial artery", "artery", 7, 18, 7, 0.32, 0.3),
      S("facialNerve", "facial nerve", "nerve", 9, 2, 12, 0.62, 0.25),
      S("mandible", "jaw", "bone", 14, 0.5, 10, 0.5, 0.6),
    ],
  },
  neck: {
    skinMm: 2, fatMm: 4, muscleMm: 9, boneMm: 45, cavityMm: 20, widthCm: 12,
    structures: [
      S("jugular", "jugular vein", "vein", 12, 40, 5, 0.66, 0.22),
      S("carotid", "carotid artery", "artery", 16, 120, 8, 0.36, 0.2, "carotid", 0.85),
      S("trachea", "airway", "airway", 20, 6, 12, 0.5, 0.28, "trachea", 0.9),
      S("cervicalSpine", "cervical spine", "bone", 45, 2, 14, 0.5, 0.35, "spine", 0.3),
    ],
  },
  chest: {
    skinMm: 2, fatMm: 8, muscleMm: 12, boneMm: 11, cavityMm: 28, widthCm: 34,
    structures: [
      S("rib", "rib", "bone", 11, 0.6, 9, 0.5, 0.55),
      S("intercostal", "intercostal artery", "artery", 14, 26, 6, 0.4, 0.3),
      S("lung", "lung", "organ", 26, 18, 14, 0.28, 0.3, "lungs", 0.55),
      S("heart", "heart", "organ", 40, 0, 24, 0.52, 0.18, "heart", 1),
      S("aorta", "aorta", "artery", 58, 150, 16, 0.5, 0.12, "heart", 0.95),
    ],
  },
  abdomen: {
    skinMm: 2, fatMm: 11, muscleMm: 10, boneMm: 0, cavityMm: 22, widthCm: 30,
    structures: [
      S("intestines", "intestines", "organ", 22, 8, 11, 0.5, 0.5, "intestines", 0.12),
      S("stomach", "stomach", "organ", 26, 7, 12, 0.3, 0.3, "stomach", 0.15),
      S("liver", "liver", "organ", 28, 26, 13, 0.66, 0.32, "liver", 0.35),
      S("kidney", "kidney", "organ", 44, 14, 14, 0.2, 0.18, "kidneys", 0.2),
      S("abdominalAorta", "aorta", "artery", 50, 140, 18, 0.5, 0.12, "heart", 0.95),
    ],
  },
  back: {
    skinMm: 3, fatMm: 10, muscleMm: 16, boneMm: 9, cavityMm: 34, widthCm: 32,
    structures: [
      S("scapula", "shoulder blade", "bone", 9, 0.5, 9, 0.3, 0.4),
      S("thoracicSpine", "spine", "bone", 14, 2, 13, 0.5, 0.25, "spine", 0.3),
      S("kidney", "kidney", "organ", 34, 14, 14, 0.28, 0.16, "kidneys", 0.2),
      S("lung", "lung", "organ", 36, 18, 14, 0.72, 0.22, "lungs", 0.55),
    ],
  },
  pelvis: {
    skinMm: 2, fatMm: 10, muscleMm: 11, boneMm: 18, cavityMm: 30, widthCm: 30,
    structures: [
      S("iliacArtery", "iliac artery", "artery", 16, 90, 10, 0.32, 0.2, "heart", 0.8),
      S("pelvicBone", "pelvis", "bone", 18, 0.6, 9, 0.5, 0.55),
      S("bladder", "bladder", "organ", 26, 9, 12, 0.5, 0.25, "kidneys", 0.08),
    ],
  },
  leftUpperArm: armProfile("left"),
  rightUpperArm: armProfile("right"),
  leftForearm: forearmProfile("left"),
  rightForearm: forearmProfile("right"),
  leftHand: handProfile("left"),
  rightHand: handProfile("right"),
  leftThigh: thighProfile("left"),
  rightThigh: thighProfile("right"),
  leftShin: shinProfile("left"),
  rightShin: shinProfile("right"),
  leftFoot: footProfile("left"),
  rightFoot: footProfile("right"),
};

function armProfile(side: "left" | "right"): TissueProfile {
  return {
    skinMm: 2, fatMm: 5, muscleMm: 20, boneMm: 28, cavityMm: 40, widthCm: 12,
    structures: [
      S(`${side}Brachial`, "brachial artery", "artery", 18, 70, 9, 0.4, 0.2),
      S(`${side}Humerus`, "humerus", "bone", 28, 0.6, 11, 0.5, 0.45),
    ],
  };
}

function forearmProfile(side: "left" | "right"): TissueProfile {
  return {
    skinMm: 2, fatMm: 4, muscleMm: 13, boneMm: 18, cavityMm: 26, widthCm: 10,
    structures: [
      S(`${side}Radial`, "radial artery", "artery", 8, 45, 7, 0.3, 0.18),
      S(`${side}Ulna`, "ulna", "bone", 18, 0.5, 10, 0.5, 0.4),
    ],
  };
}

function handProfile(side: "left" | "right"): TissueProfile {
  return {
    skinMm: 2, fatMm: 2, muscleMm: 6, boneMm: 7, cavityMm: 10, widthCm: 9,
    structures: [
      S(`${side}Digital`, "digital artery", "artery", 4, 18, 8, 0.35, 0.3),
      S(`${side}Metacarpal`, "metacarpal", "bone", 7, 0.4, 10, 0.5, 0.45),
    ],
  };
}

function thighProfile(side: "left" | "right"): TissueProfile {
  return {
    skinMm: 2, fatMm: 11, muscleMm: 30, boneMm: 52, cavityMm: 70, widthCm: 18,
    structures: [
      S(`${side}Femoral`, "femoral artery", "artery", 30, 160, 12, 0.34, 0.18, "heart", 0.6),
      S(`${side}Femur`, "femur", "bone", 52, 1, 12, 0.5, 0.45),
    ],
  };
}

function shinProfile(side: "left" | "right"): TissueProfile {
  return {
    skinMm: 3, fatMm: 5, muscleMm: 12, boneMm: 14, cavityMm: 30, widthCm: 12,
    structures: [
      S(`${side}Tibial`, "tibial artery", "artery", 10, 70, 8, 0.3, 0.18),
      S(`${side}Tibia`, "tibia", "bone", 14, 0.8, 12, 0.42, 0.35),
    ],
  };
}

function footProfile(side: "left" | "right"): TissueProfile {
  return {
    skinMm: 3, fatMm: 4, muscleMm: 7, boneMm: 9, cavityMm: 12, widthCm: 9,
    structures: [
      S(`${side}Pedal`, "pedal artery", "artery", 6, 30, 8, 0.4, 0.25),
      S(`${side}Metatarsal`, "metatarsal", "bone", 9, 0.4, 10, 0.5, 0.4),
    ],
  };
}

/** Collider descriptors. The UE physics asset is built to these, one body per row. */
export type BodyCollider = {
  region: SurfaceRegion;
  shape: "capsule" | "sphere" | "box";
  radiusCm: number;
  lengthCm: number;
  bone: string;
};

export const BODY_COLLIDERS: BodyCollider[] = [
  { region: "head", shape: "sphere", radiusCm: 10, lengthCm: 0, bone: "head" },
  { region: "face", shape: "sphere", radiusCm: 7, lengthCm: 0, bone: "head" },
  { region: "neck", shape: "capsule", radiusCm: 6, lengthCm: 9, bone: "neck_01" },
  { region: "chest", shape: "box", radiusCm: 15, lengthCm: 26, bone: "spine_03" },
  { region: "abdomen", shape: "box", radiusCm: 13, lengthCm: 18, bone: "spine_01" },
  { region: "back", shape: "box", radiusCm: 14, lengthCm: 30, bone: "spine_02" },
  { region: "pelvis", shape: "box", radiusCm: 13, lengthCm: 12, bone: "pelvis" },
  { region: "leftUpperArm", shape: "capsule", radiusCm: 5, lengthCm: 26, bone: "upperarm_l" },
  { region: "rightUpperArm", shape: "capsule", radiusCm: 5, lengthCm: 26, bone: "upperarm_r" },
  { region: "leftForearm", shape: "capsule", radiusCm: 4, lengthCm: 24, bone: "lowerarm_l" },
  { region: "rightForearm", shape: "capsule", radiusCm: 4, lengthCm: 24, bone: "lowerarm_r" },
  { region: "leftHand", shape: "box", radiusCm: 4, lengthCm: 17, bone: "hand_l" },
  { region: "rightHand", shape: "box", radiusCm: 4, lengthCm: 17, bone: "hand_r" },
  { region: "leftThigh", shape: "capsule", radiusCm: 8, lengthCm: 38, bone: "thigh_l" },
  { region: "rightThigh", shape: "capsule", radiusCm: 8, lengthCm: 38, bone: "thigh_r" },
  { region: "leftShin", shape: "capsule", radiusCm: 6, lengthCm: 36, bone: "calf_l" },
  { region: "rightShin", shape: "capsule", radiusCm: 6, lengthCm: 36, bone: "calf_r" },
  { region: "leftFoot", shape: "box", radiusCm: 4, lengthCm: 24, bone: "foot_l" },
  { region: "rightFoot", shape: "box", radiusCm: 4, lengthCm: 24, bone: "foot_r" },
];

/** How readily a tool's edge enters tissue, and how deep it can be driven. */
const EDGE: Record<ToolId | "hand", { edge: number; maxCm: number; noise: number; pain: number }> = {
  scalpel: { edge: 1, maxCm: 6, noise: 1, pain: 5 },
  blade: { edge: 0.92, maxCm: 10, noise: 2, pain: 7 },
  pliers: { edge: 0.25, maxCm: 2, noise: 3, pain: 8 },
  saw: { edge: 0.72, maxCm: 12, noise: 7, pain: 9 },
  drill: { edge: 0.95, maxCm: 14, noise: 8, pain: 10 },
  brand: { edge: 0.4, maxCm: 3, noise: 4, pain: 10 },
  hammer: { edge: 0.45, maxCm: 4, noise: 6, pain: 9 },
  clamp: { edge: 0.2, maxCm: 2, noise: 1, pain: 8 },
  needle: { edge: 1, maxCm: 7, noise: 0, pain: 4 },
  chemical: { edge: 1, maxCm: 8, noise: 1, pain: 10 },
  hand: { edge: 0.1, maxCm: 1, noise: 0, pain: 2 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export type ContactInput = {
  region: SurfaceRegion;
  tool: ToolId | "hand";
  /** Where across the surface, 0..1. */
  pointX: number;
  /** 0 = perpendicular, 90 = parallel to the skin. */
  angleDeg: number;
  /** Newtons. A relaxed swipe is ~20; a committed one ~150. */
  forceN: number;
  /** How far the player drove the tool, centimetres. */
  commandedCm: number;
  /** 0..1 clothing still covering the point. */
  clothing: number;
};

export type ContactResult = {
  /** How far it actually went, centimetres. */
  depthCm: number;
  tissues: TissueLayer[];
  structure: StructureSpec | null;
  organ: OrganId | null;
  /** Degrees the edge turned on bone, if it did. */
  deflectionDeg: number;
  through: boolean;
  bleedMlMin: number;
  pain: number;
  noise: number;
  description: string;
};

/**
 * Resolve a contact into a path through tissue. Pure and deterministic: the same
 * swing at the same place on the same body always does the same thing, which is
 * what lets the C++ side reproduce it for the physics asset.
 */
export function resolveContact(input: ContactInput): ContactResult {
  const profile = TISSUE[input.region];
  const spec = EDGE[input.tool];
  const clothing = clamp01(input.clothing);
  const angle = Math.cos((clamp(input.angleDeg, 0, 90) * Math.PI) / 180);
  const force = clamp(input.forceN / 120, 0.15, 1.5);

  const commanded = Math.min(input.commandedCm, spec.maxCm);
  let depthCm = commanded * spec.edge * force * angle * (1 - 0.4 * clothing);

  const bone = profile.structures.find((entry) => entry.kind === "bone");
  const boneCm = bone ? bone.depthMm / 10 : Number.POSITIVE_INFINITY;
  let deflectionDeg = 0;

  // Bone stops an edge that is not driven straight or hard enough. A drill and a
  // saw do not care; a knife glanced off a shin does.
  if (bone && depthCm > boneCm * 0.8 && input.tool !== "drill" && input.tool !== "saw") {
    if (input.angleDeg > 55 || force < 0.5) {
      deflectionDeg = Math.round((depthCm - boneCm * 0.8) * 40);
      depthCm = boneCm * 0.8;
    }
  }

  const depthMm = depthCm * 10;
  const tissues: TissueLayer[] = ["skin"];
  if (depthMm > profile.skinMm) tissues.push("fat");
  if (depthMm > profile.skinMm + profile.fatMm) tissues.push("muscle");
  if (bone && depthMm >= bone.depthMm) tissues.push("bone");
  if (depthMm >= profile.cavityMm) tissues.push("cavity");

  const reached = profile.structures
    .filter((entry) => entry.depthMm <= depthMm && Math.abs(input.pointX - entry.x) <= entry.spread)
    .sort((a, b) => a.depthMm - b.depthMm);

  const structure = reached.length > 0 ? reached[reached.length - 1] : null;
  const organ = structure?.organ ?? null;

  const baseBleed = structure ? structure.bleed : Math.max(0.4, depthMm * 0.18);
  const arteriole = !structure && depthMm > 6 ? 1.6 : 1;
  const bleedMlMin = Number((baseBleed * (1 + depthMm / 160) * arteriole).toFixed(2));
  const pain = Math.round(spec.pain * (0.4 + depthCm / 12) + (structure?.pain ?? 0));
  const noise = Math.round(spec.noise + depthCm * 1.5);
  const through = depthCm >= profile.cavityMm / 10 + 1.5;

  const where = input.region.replace(/([A-Z])/g, " $1").toLowerCase();
  let description: string;
  if (structure) {
    description = `${structure.label} — ${depthCm.toFixed(1)} cm in, through ${tissues.join(", ")}`;
  } else if (deflectionDeg > 0) {
    description = `The edge turned ${deflectionDeg}° on bone at ${depthCm.toFixed(1)} cm`;
  } else {
    description = `${depthCm.toFixed(1)} cm into the ${where}`;
  }
  if (through) description += "; it came out the other side";
  if (clothing > 0.2) description += ` (through ${Math.round(clothing * 100)}% coverage)`;

  return { depthCm, tissues, structure, organ, deflectionDeg, through, bleedMlMin, pain, noise, description };
}

// ---------------------------------------------------------------------------
// Clothing
// ---------------------------------------------------------------------------

export type GarmentSlot = "top" | "bottom" | "underwear" | "shoes" | "outer";

export type GarmentState = {
  slot: GarmentSlot;
  item: string;
  /** 0..1 of the body this still covers. */
  coverage: number;
  /** 0..1 structural condition; cutting lowers it before coverage drops. */
  integrity: number;
  removed: boolean;
};

const GARMENT_ITEMS: Record<GarmentSlot, string> = {
  top: "shirt",
  bottom: "trousers",
  underwear: "underwear",
  shoes: "shoes",
  outer: "jacket",
};

export function garmentsFor(dress: DressState): GarmentState[] {
  const coverage = dress === "undressed" ? 0 : dress === "partiallyDressed" ? 0.55 : 0.95;
  const slots: GarmentSlot[] = ["top", "bottom", "underwear", "shoes"];
  return slots.map((slot) => ({
    slot,
    item: GARMENT_ITEMS[slot],
    coverage,
    integrity: coverage > 0 ? 1 : 0,
    removed: coverage === 0,
  }));
}

const SLOT_REGIONS: Record<GarmentSlot, SurfaceRegion[]> = {
  top: ["chest", "abdomen", "back", "leftUpperArm", "rightUpperArm", "leftForearm", "rightForearm"],
  bottom: ["pelvis", "leftThigh", "rightThigh", "leftShin", "rightShin"],
  underwear: ["pelvis"],
  shoes: ["leftFoot", "rightFoot"],
  outer: ["chest", "abdomen", "back", "leftUpperArm", "rightUpperArm"],
};

/** 0..1 coverage at a region, from the garments that still cover it. */
export function coverageAt(garments: GarmentState[], region: SurfaceRegion): number {
  let coverage = 0;
  for (const garment of garments) {
    if (garment.coverage <= 0) continue;
    if (!SLOT_REGIONS[garment.slot].includes(region)) continue;
    coverage = Math.max(coverage, garment.coverage);
  }
  return clamp01(coverage);
}

/**
 * Cut clothing at a region. The edge has to get through the fabric before it
 * reaches skin, which is why `resolveContact` is given the coverage afterwards.
 * Returns the coverage removed.
 */
export function cutClothing(garments: GarmentState[], region: SurfaceRegion, tool: ToolId): number {
  const spec = EDGE[tool];
  let removed = 0;
  for (const garment of garments) {
    if (garment.coverage <= 0) continue;
    if (!SLOT_REGIONS[garment.slot].includes(region)) continue;
    const bite = clamp01(0.18 * spec.edge * (spec.maxCm / 6));
    garment.integrity = clamp01(garment.integrity - bite);
    if (garment.integrity <= 0.15) {
      removed += garment.coverage;
      garment.coverage = 0;
      garment.removed = true;
    }
  }
  return removed;
}

/** Pull a garment off. Tearing is deterministic: integrity decides whether it survives. */
export function pullOff(garments: GarmentState[], slot: GarmentSlot, forceN: number): { removed: boolean; torn: boolean } {
  const garment = garments.find((entry) => entry.slot === slot);
  if (!garment || garment.coverage <= 0) return { removed: false, torn: false };
  const torn = garment.integrity < 0.5 || forceN < 60;
  garment.coverage = 0;
  garment.removed = true;
  garment.integrity = torn ? 0.2 : 0.8;
  return { removed: true, torn };
}

// ---------------------------------------------------------------------------
// Severance
// ---------------------------------------------------------------------------

export type JointId =
  | "leftShoulder" | "leftElbow" | "leftWrist"
  | "rightShoulder" | "rightElbow" | "rightWrist"
  | "leftHip" | "leftKnee" | "leftAnkle"
  | "rightHip" | "rightKnee" | "rightAnkle";

export const JOINT_IDS: JointId[] = [
  "leftShoulder", "leftElbow", "leftWrist",
  "rightShoulder", "rightElbow", "rightWrist",
  "leftHip", "leftKnee", "leftAnkle",
  "rightHip", "rightKnee", "rightAnkle",
];

export type JointSpec = {
  label: string;
  limb: "leftArm" | "rightArm" | "leftLeg" | "rightLeg";
  region: SurfaceRegion;
  /** Millimetres of bone and tissue that have to be worked through. */
  workMm: number;
  /** The vessel that opens when the joint separates. */
  vessel: string;
  bleed: number;
};

export const JOINT_SPECS: Record<JointId, JointSpec> = {
  leftShoulder: { label: "left shoulder", limb: "leftArm", region: "leftUpperArm", workMm: 78, vessel: "axillary artery", bleed: 180 },
  leftElbow: { label: "left elbow", limb: "leftArm", region: "leftForearm", workMm: 44, vessel: "brachial artery", bleed: 90 },
  leftWrist: { label: "left wrist", limb: "leftArm", region: "leftHand", workMm: 28, vessel: "radial artery", bleed: 55 },
  rightShoulder: { label: "right shoulder", limb: "rightArm", region: "rightUpperArm", workMm: 78, vessel: "axillary artery", bleed: 180 },
  rightElbow: { label: "right elbow", limb: "rightArm", region: "rightForearm", workMm: 44, vessel: "brachial artery", bleed: 90 },
  rightWrist: { label: "right wrist", limb: "rightArm", region: "rightHand", workMm: 28, vessel: "radial artery", bleed: 55 },
  leftHip: { label: "left hip", limb: "leftLeg", region: "leftThigh", workMm: 96, vessel: "femoral artery", bleed: 220 },
  leftKnee: { label: "left knee", limb: "leftLeg", region: "leftShin", workMm: 58, vessel: "popliteal artery", bleed: 120 },
  leftAnkle: { label: "left ankle", limb: "leftLeg", region: "leftFoot", workMm: 34, vessel: "tibial artery", bleed: 70 },
  rightHip: { label: "right hip", limb: "rightLeg", region: "rightThigh", workMm: 96, vessel: "femoral artery", bleed: 220 },
  rightKnee: { label: "right knee", limb: "rightLeg", region: "rightShin", workMm: 58, vessel: "popliteal artery", bleed: 120 },
  rightAnkle: { label: "right ankle", limb: "rightLeg", region: "rightFoot", workMm: 34, vessel: "tibial artery", bleed: 70 },
};

/**
 * One pass of a tool across a joint. Progress is millimetres of tissue worked
 * through, so a knife takes many passes and a saw takes fewer — and a tourniquet
 * makes the difference between a controlled amputation and a dead body.
 */
/** How much tissue a tool removes per pass across a joint. A saw earns its noise. */
const SEVERANCE_WORK: Partial<Record<ToolId, number>> = {
  saw: 1.9,
  blade: 1,
  scalpel: 0.45,
  drill: 0.8,
  hammer: 0.3,
  pliers: 0.2,
  clamp: 0.1,
};

export function severanceStep(
  progressMm: number,
  joint: JointId,
  tool: ToolId,
  forceN: number,
): { progressMm: number; done: boolean; cutMm: number; noise: number } {
  const spec = JOINT_SPECS[joint];
  const edge = EDGE[tool];
  const force = clamp(forceN / 120, 0.15, 1.5);
  const cutMm = Number((edge.edge * edge.maxCm * force * (SEVERANCE_WORK[tool] ?? 0.3) * 1.6).toFixed(2));
  const next = Math.min(spec.workMm, progressMm + cutMm);
  return { progressMm: next, done: next >= spec.workMm, cutMm, noise: Math.round(edge.noise + 3) };
}

// ---------------------------------------------------------------------------
// Blood
// ---------------------------------------------------------------------------

export type SprayProfile = {
  rateMlMin: number;
  /** Metres per second leaving the vessel; arterial is a jet, venous is a run. */
  velocity: number;
  /** How far it reaches, centimetres. */
  reachCm: number;
  pulsatile: boolean;
};

export function sprayFor(bleedMlMin: number, systolic: number): SprayProfile {
  const pressure = clamp(systolic / 120, 0, 1.6);
  const arterial = bleedMlMin >= 60;
  return {
    rateMlMin: bleedMlMin,
    velocity: Number((arterial ? 1.2 * pressure : 0.25 * pressure).toFixed(2)),
    reachCm: Math.round((arterial ? 90 : 20) * pressure),
    pulsatile: arterial,
  };
}

// ---------------------------------------------------------------------------
// Voice and face
// ---------------------------------------------------------------------------

export type VoiceCue = "silence" | "gasp" | "whimper" | "groan" | "sob" | "scream" | "shriek" | "gurgle";

export type VoiceState = {
  cue: VoiceCue;
  /** 0..1; drives volume and which take is selected. */
  intensity: number;
  assetClass: "audio.voice.male" | "audio.voice.female";
};

export type VictalReading = {
  pain: number;
  terror: number;
  shock: number;
  consciousness: number;
  adrenaline: number;
};

/**
 * What the room hears. This is a function of state, not a random pick: the same
 * body at the same numbers makes the same sound, which is what makes silence
 * meaningful — it means the airway or the consciousness has gone.
 */
export function voiceFor(vitals: VictalReading, sex: "male" | "female"): VoiceState {
  const assetClass = sex === "male" ? "audio.voice.male" : "audio.voice.female";
  if (vitals.consciousness <= 15) {
    return { cue: vitals.shock > 85 ? "silence" : "whimper", intensity: 0.1, assetClass };
  }
  if (vitals.pain >= 80 && vitals.terror >= 55) return { cue: "shriek", intensity: 1, assetClass };
  if (vitals.pain >= 55) return { cue: "scream", intensity: clamp01(0.55 + vitals.pain / 200), assetClass };
  if (vitals.terror >= 60) return { cue: "sob", intensity: clamp01(vitals.terror / 100), assetClass };
  if (vitals.pain >= 30) return { cue: "groan", intensity: clamp01(0.3 + vitals.pain / 150), assetClass };
  if (vitals.adrenaline >= 45) return { cue: "gasp", intensity: 0.35, assetClass };
  return { cue: "whimper", intensity: 0.2, assetClass };
}

export type FaceExpression = "neutral" | "fear" | "pain" | "shock" | "rage" | "agony" | "blank";

export function expressionFor(vitals: VictalReading): FaceExpression {
  if (vitals.consciousness <= 10) return "blank";
  if (vitals.pain >= 75 && vitals.terror >= 60) return "agony";
  if (vitals.shock >= 65) return "shock";
  if (vitals.pain >= 50) return "pain";
  if (vitals.terror >= 55) return "fear";
  if (vitals.adrenaline >= 70) return "rage";
  return "neutral";
}
