/**
 * The detailed trauma model — the one place in the simulation where a body is
 * modelled at organ level rather than as a set of abstract wounds.
 *
 * Why this exists as its own module: everywhere else, violence resolves in one
 * call and produces a `Wound`. In the room, the player is making deliberate,
 * sequential decisions, and the interesting consequence is *what those decisions
 * do to a living system over minutes* — a cut that will not stop, a limb that
 * bleeds faster than it can be closed, an airway that closes on its own schedule.
 *
 * The model is therefore a small physiology:
 *
 *   organs     integrity, exposure, destruction. Each has a bleed multiplier, a
 *              lethality and a function. The heart and brain are effectively
 *              instant; the airway and lungs kill on a delay; the liver and
 *              kidneys kill slowly through blood loss and toxaemia.
 *   limbs      attached, tourniqueted, functioning. A thigh wound bleeds like a
 *              thigh wound; a tourniquet stops it and starts a clock.
 *   wounds     bleeding, pain, cauterised, infected. Cautery closes a bleed and
 *              buys an infection — the trade the player is actually making.
 *
 * Nothing here is instruction. The numbers are game balance: how many millilitres
 * a minute, how many points of shock, how long an airway stays closed. Content
 * gating is enforced at the act level: below the required violence level the act
 * throws rather than quietly resolving, because a UI that offers a disabled action
 * is a bug.
 */

import type { ContentGate } from "../content/gate.ts";
import { assertHardInvariants } from "../content/gate.ts";
import type { Rng } from "../core/rng.ts";
import type { DressState } from "./anatomy.ts";
import { BASE_BLOOD_VOLUME } from "./anatomy.ts";
import type { Npc, NpcId } from "./types.ts";
import {
  JOINT_IDS,
  JOINT_SPECS,
  coverageAt,
  cutClothing,
  expressionFor,
  garmentsFor,
  pullOff,
  resolveContact,
  severanceStep,
  voiceFor,
} from "./surface.ts";
import type {
  FaceExpression,
  GarmentSlot,
  GarmentState,
  JointId,
  SurfaceRegion,
  VoiceState,
} from "./surface.ts";

export type TortureRegion =
  | "head"
  | "neck"
  | "chest"
  | "abdomen"
  | "back"
  | "leftUpperArm"
  | "leftForearm"
  | "leftHand"
  | "rightUpperArm"
  | "rightForearm"
  | "rightHand"
  | "leftThigh"
  | "leftShin"
  | "leftFoot"
  | "rightThigh"
  | "rightShin"
  | "rightFoot";

export const TORTURE_REGIONS: TortureRegion[] = [
  "head",
  "neck",
  "chest",
  "abdomen",
  "back",
  "leftUpperArm",
  "leftForearm",
  "leftHand",
  "rightUpperArm",
  "rightForearm",
  "rightHand",
  "leftThigh",
  "leftShin",
  "leftFoot",
  "rightThigh",
  "rightShin",
  "rightFoot",
];

export type OrganId =
  | "brain"
  | "carotid"
  | "trachea"
  | "heart"
  | "lungs"
  | "liver"
  | "kidneys"
  | "stomach"
  | "intestines"
  | "spine";

export const ORGAN_IDS: OrganId[] = [
  "brain",
  "carotid",
  "trachea",
  "heart",
  "lungs",
  "liver",
  "kidneys",
  "stomach",
  "intestines",
  "spine",
];

export type OrganFunction = "circulatory" | "respiratory" | "neuro" | "digestive" | "renal" | "musculoskeletal";

export type OrganSpec = {
  label: string;
  /** Regions this can be reached through. */
  regions: TortureRegion[];
  /** Multiplier on the wound's bleed rate once this organ is opened. */
  bleed: number;
  /** 0..1 chance the destruction is immediately fatal. */
  lethal: number;
  function: OrganFunction;
  death: string;
};

export const ORGAN_SPECS: Record<OrganId, OrganSpec> = {
  brain: { label: "brain", regions: ["head"], bleed: 1.2, lethal: 1, function: "neuro", death: "brain death" },
  carotid: { label: "carotid", regions: ["neck"], bleed: 9, lethal: 0.85, function: "circulatory", death: "carotid haemorrhage" },
  trachea: { label: "airway", regions: ["neck"], bleed: 1, lethal: 0.9, function: "respiratory", death: "airway obstruction" },
  heart: { label: "heart", regions: ["chest"], bleed: 6, lethal: 1, function: "circulatory", death: "cardiac arrest" },
  lungs: { label: "lungs", regions: ["chest", "back"], bleed: 2.5, lethal: 0.55, function: "respiratory", death: "asphyxia" },
  liver: { label: "liver", regions: ["abdomen"], bleed: 4, lethal: 0.35, function: "digestive", death: "hepatic haemorrhage" },
  kidneys: { label: "kidneys", regions: ["abdomen", "back"], bleed: 2, lethal: 0.2, function: "renal", death: "renal failure" },
  stomach: { label: "stomach", regions: ["abdomen"], bleed: 1.5, lethal: 0.15, function: "digestive", death: "peritonitis" },
  intestines: { label: "intestines", regions: ["abdomen"], bleed: 1.8, lethal: 0.12, function: "digestive", death: "peritonitis" },
  spine: { label: "spine", regions: ["neck", "back"], bleed: 0.8, lethal: 0.3, function: "musculoskeletal", death: "spinal shock" },
};

/** Which organs a blade can reach through a given surface. */
export const REGION_ORGANS: Partial<Record<TortureRegion, OrganId[]>> = {
  head: ["brain"],
  neck: ["carotid", "trachea", "spine"],
  chest: ["heart", "lungs"],
  abdomen: ["liver", "stomach", "intestines", "kidneys"],
  back: ["spine", "kidneys", "lungs"],
};

/** Baseline bleed multiplier for the region itself: a thigh is not a forearm. */
export const REGION_BLEED: Record<SurfaceRegion, number> = {
  head: 1.4,
  face: 1.9,
  neck: 3,
  chest: 1.6,
  abdomen: 1.4,
  back: 1.3,
  pelvis: 1.8,
  leftUpperArm: 1.2,
  leftForearm: 1,
  leftHand: 0.7,
  rightUpperArm: 1.2,
  rightForearm: 1,
  rightHand: 0.7,
  leftThigh: 2.8,
  leftShin: 1.2,
  leftFoot: 0.8,
  rightThigh: 2.8,
  rightShin: 1.2,
  rightFoot: 0.8,
};

export type LimbId = "leftArm" | "rightArm" | "leftLeg" | "rightLeg";

export const LIMB_IDS: LimbId[] = ["leftArm", "rightArm", "leftLeg", "rightLeg"];

export const LIMB_REGIONS: Record<LimbId, TortureRegion[]> = {
  leftArm: ["leftUpperArm", "leftForearm", "leftHand"],
  rightArm: ["rightUpperArm", "rightForearm", "rightHand"],
  leftLeg: ["leftThigh", "leftShin", "leftFoot"],
  rightLeg: ["rightThigh", "rightShin", "rightFoot"],
};

/** Ten fingernails. Toes are the same mechanic with worse jokes. */
export const DIGITS: string[] = [
  "leftThumb",
  "leftIndex",
  "leftMiddle",
  "leftRing",
  "leftLittle",
  "rightThumb",
  "rightIndex",
  "rightMiddle",
  "rightRing",
  "rightLittle",
];

export type ToolId = "scalpel" | "blade" | "pliers" | "saw" | "drill" | "brand" | "hammer" | "clamp" | "needle" | "chemical";

export type ToolSpec = {
  label: string;
  /** 0..100 how far it carries. */
  noise: number;
  /** 0..1 how reliably it reaches what it is aimed at. */
  precision: number;
  /** 0..1 relative depth. */
  maxDepth: number;
  pain: number;
  bleed: number;
  gore: "graphic" | "extreme";
};

export const TOOL_SPECS: Record<ToolId, ToolSpec> = {
  scalpel: { label: "scalpel", noise: 1, precision: 1, maxDepth: 0.6, pain: 5, bleed: 1.4, gore: "graphic" },
  blade: { label: "knife", noise: 2, precision: 0.8, maxDepth: 0.8, pain: 7, bleed: 2.4, gore: "graphic" },
  pliers: { label: "pliers", noise: 3, precision: 0.9, maxDepth: 0.2, pain: 8, bleed: 0.8, gore: "graphic" },
  saw: { label: "saw", noise: 7, precision: 0.7, maxDepth: 1, pain: 9, bleed: 3.2, gore: "extreme" },
  drill: { label: "drill", noise: 8, precision: 0.85, maxDepth: 1, pain: 10, bleed: 2.2, gore: "extreme" },
  brand: { label: "brand", noise: 4, precision: 0.9, maxDepth: 0.4, pain: 10, bleed: 0.3, gore: "extreme" },
  hammer: { label: "hammer", noise: 6, precision: 0.6, maxDepth: 0.6, pain: 9, bleed: 0.9, gore: "extreme" },
  clamp: { label: "clamp", noise: 1, precision: 0.8, maxDepth: 0.3, pain: 8, bleed: 0.2, gore: "graphic" },
  needle: { label: "needle", noise: 0, precision: 1, maxDepth: 0.5, pain: 4, bleed: 0.3, gore: "graphic" },
  chemical: { label: "chemical", noise: 1, precision: 1, maxDepth: 0.8, pain: 10, bleed: 0.4, gore: "extreme" },
};

export type TortureAct =
  | { kind: "cut"; region: SurfaceRegion; depth: number; tool: ToolId }
  | { kind: "stab"; region: SurfaceRegion; depth: number; tool: ToolId }
  | { kind: "burn"; region: SurfaceRegion; tool: ToolId }
  | { kind: "blunt"; region: SurfaceRegion; tool: ToolId }
  | { kind: "nail"; digit: string; tool: ToolId }
  | { kind: "amputate"; limb: LimbId; tool: ToolId }
  | { kind: "cauterize"; woundId: string }
  | { kind: "tourniquet"; limb: LimbId }
  | { kind: "undress"; dress: DressState }
  | { kind: "restrain"; part: "wrists" | "ankles" | "gag"; on: boolean }
  | { kind: "cutClothing"; region: SurfaceRegion; tool: ToolId }
  | { kind: "pullOff"; slot: GarmentSlot; force: number }
  | { kind: "sever"; joint: JointId; tool: ToolId; force: number }
  | { kind: "sedate" };

export type OrganState = {
  integrity: number;
  exposed: boolean;
  destroyed: boolean;
};

export type LimbState = {
  attached: boolean;
  tourniquet: boolean;
  tourniquetMinutes: number;
  function: number;
};

export type TortureWound = {
  id: string;
  region: SurfaceRegion;
  tool: ToolId;
  kind: "cut" | "stab" | "burn" | "blunt" | "amputation";
  depth: number;
  /** Millilitres per minute before treatment. */
  bleeding: number;
  pain: number;
  cauterized: boolean;
  infected: boolean;
  atMinute: number;
  limb: LimbId | null;
};

export type TortureVitals = {
  blood: number;
  pain: number;
  shock: number;
  consciousness: number;
  terror: number;
  compliance: number;
  dissociation: number;
  infection: number;
  adrenaline: number;
};

export type TortureRestraints = {
  wrists: boolean;
  ankles: boolean;
  neck: boolean;
  gag: boolean;
};

export type TortureSessionState = {
  victimId: NpcId;
  startedAtMinute: number;
  minutes: number;
  dress: DressState;
  restraints: TortureRestraints;
  organs: Record<OrganId, OrganState>;
  limbs: Record<LimbId, LimbState>;
  /** digit -> removed */
  nails: Record<string, boolean>;
  wounds: TortureWound[];
  vitals: TortureVitals;
  /** Which voice set the audio layer should use. */
  sex: "male" | "female";
  garments: GarmentState[];
  /** Millimetres of work done per joint, for progressive dismemberment. */
  joints: Record<JointId, number>;
  blood: { poolMl: number; sprays: number; systolic: number };
  voice: VoiceState;
  expression: FaceExpression;
  acts: number;
  screams: number;
  ended: boolean;
  endedAtMinute: number | null;
  causeOfDeath: string | null;
  counter: number;
  asphyxiaMinutes: number;
};

export type TortureActResult = {
  ok: boolean;
  act: TortureAct["kind"];
  summary: string;
  noise: number;
  organ: OrganId | null;
  damage: number;
  escaped: boolean;
  died: boolean;
};

export class TortureRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TortureRefusedError";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function emptyOrgans(): Record<OrganId, OrganState> {
  const out = {} as Record<OrganId, OrganState>;
  for (const organ of ORGAN_IDS) out[organ] = { integrity: 1, exposed: false, destroyed: false };
  return out;
}

function emptyLimbs(): Record<LimbId, LimbState> {
  const out = {} as Record<LimbId, LimbState>;
  for (const limb of LIMB_IDS) out[limb] = { attached: true, tourniquet: false, tourniquetMinutes: 0, function: 1 };
  return out;
}

function emptyJoints(): Record<JointId, number> {
  const out = {} as Record<JointId, number>;
  for (const joint of JOINT_IDS) out[joint] = 0;
  return out;
}

export function createTortureSession(
  victim: Npc,
  atMinute: number,
  restraints?: Partial<TortureRestraints>,
  dress: DressState = victim.appearance.dress,
): TortureSessionState {
  // The hard invariant belongs here as well as in custody.take(): a caller that
  // constructs a session directly must not be able to skip it.
  try {
    assertHardInvariants({ id: victim.id, age: victim.age, isMinor: victim.isMinor }, "violent");
  } catch (error) {
    throw new TortureRefusedError((error as Error).message);
  }

  const nails: Record<string, boolean> = {};
  for (const digit of DIGITS) nails[digit] = false;

  return {
    victimId: victim.id,
    startedAtMinute: atMinute,
    minutes: 0,
    dress,
    restraints: { wrists: true, ankles: true, neck: false, gag: false, ...restraints },
    organs: emptyOrgans(),
    limbs: emptyLimbs(),
    nails,
    wounds: [],
    garments: garmentsFor(dress),
    joints: emptyJoints(),
    blood: { poolMl: 0, sprays: 0, systolic: 118 },
    sex: victim.gender === "male" ? "male" : "female",
    voice: {
      cue: "whimper",
      intensity: 0.2,
      assetClass: victim.gender === "male" ? "audio.voice.male" : "audio.voice.female",
    },
    expression: "fear",
    vitals: {
      blood: clamp(victim.injury.vitals.blood, 0, BASE_BLOOD_VOLUME),
      pain: clamp(victim.injury.vitals.pain, 0, 100),
      shock: clamp(victim.injury.vitals.shock, 0, 100),
      consciousness: clamp(victim.injury.vitals.consciousness, 0, 100),
      terror: clamp(40 + victim.paranoia * 0.3, 0, 100),
      compliance: 0,
      dissociation: 0,
      infection: clamp(victim.injury.vitals.infection, 0, 100),
      adrenaline: 20,
    },
    acts: 0,
    screams: 0,
    ended: false,
    endedAtMinute: null,
    causeOfDeath: null,
    counter: 0,
    asphyxiaMinutes: 0,
  };
}

function limbForRegion(region: SurfaceRegion): LimbId | null {
  for (const limb of LIMB_IDS) {
    if (LIMB_REGIONS[limb].some((entry) => entry === region)) return limb;
  }
  return null;
}

function requiredLevel(act: TortureAct): "graphic" | "extreme" | null {
  switch (act.kind) {
    case "cut":
    case "blunt":
      return "graphic";
    case "stab":
      return act.depth > 0.35 ? "extreme" : "graphic";
    case "burn":
    case "nail":
    case "amputate":
      return "extreme";
    case "tourniquet":
    case "cauterize":
    case "undress":
    case "restrain":
    case "cutClothing":
    case "pullOff":
    case "sedate":
      return null;
    case "sever":
      return "extreme";
  }
}

function pushWound(
  session: TortureSessionState,
  input: Omit<TortureWound, "id" | "cauterized" | "infected">,
): TortureWound {
  session.counter += 1;
  const wound: TortureWound = {
    ...input,
    id: `twound-${session.counter}`,
    cauterized: false,
    infected: false,
  };
  session.wounds.push(wound);
  return wound;
}

function markDead(session: TortureSessionState, cause: string, atMinute: number): void {
  session.ended = true;
  session.causeOfDeath = cause;
  session.endedAtMinute = atMinute;
  session.vitals.consciousness = 0;
  session.vitals.blood = Math.max(0, session.vitals.blood);
}

function checkLethal(session: TortureSessionState, atMinute: number): boolean {
  if (session.ended) return true;
  for (const organ of ORGAN_IDS) {
    const state = session.organs[organ];
    if (!state.destroyed) continue;
    const spec = ORGAN_SPECS[organ];
    if (spec.lethal >= 0.9) {
      markDead(session, spec.death, atMinute);
      return true;
    }
  }
  return false;
}

/**
 * Perform one act. Refuses (throws) when the content settings do not permit it:
 * a disabled act must not resolve into a lesser version, because the player asked
 * for the specific thing.
 */
export function applyAct(
  session: TortureSessionState,
  gate: ContentGate,
  act: TortureAct,
  atMinute: number,
  rng: Rng,
): TortureActResult {
  const idle: TortureActResult = {
    ok: false,
    act: act.kind,
    summary: "",
    noise: 0,
    organ: null,
    damage: 0,
    escaped: false,
    died: session.ended,
  };

  if (session.ended) return { ...idle, summary: "It is over. There is nothing left to do to them." };

  const level = requiredLevel(act);
  if (level && !gate.allows({ kind: "violence", level })) {
    throw new TortureRefusedError(`${act.kind} needs violence at "${level}" or above`);
  }

  if (act.kind === "undress") {
    const needed = act.dress === "undressed" ? "full" : "partial";
    if (!gate.allows({ kind: "nudity", level: needed })) {
      throw new TortureRefusedError(`undressing to "${act.dress}" needs nudity at "${needed}" or above`);
    }
    session.dress = act.dress;
    for (const garment of session.garments) {
      garment.coverage = 0;
      garment.removed = true;
    }
    session.vitals.terror = clamp(session.vitals.terror + 8, 0, 100);
    return { ...idle, ok: true, summary: `They are ${act.dress === "undressed" ? "undressed" : "partly undressed"}.`, noise: 2 };
  }

  if (act.kind === "restrain") {
    session.restraints[act.part] = act.on;
    if (act.part === "gag" && act.on) session.vitals.terror = clamp(session.vitals.terror + 5, 0, 100);
    return { ...idle, ok: true, summary: `${act.part} ${act.on ? "secured" : "released"}.`, noise: 3 };
  }

  if (act.kind === "cutClothing") {
    const removed = cutClothing(session.garments, act.region, act.tool);
    session.acts += 1;
    session.vitals.terror = clamp(session.vitals.terror + 2, 0, 100);
    return {
      ...idle,
      ok: true,
      summary: removed > 0
        ? `The last of the fabric gives; the ${act.region} is bare.`
        : `The ${act.tool} opens the fabric over the ${act.region}.`,
      noise: 3,
    };
  }

  if (act.kind === "pullOff") {
    const result = pullOff(session.garments, act.slot, act.force);
    if (!result.removed) return { ...idle, summary: "there is nothing left there to pull" };
    session.acts += 1;
    session.vitals.terror = clamp(session.vitals.terror + 6, 0, 100);
    return { ...idle, ok: true, summary: result.torn ? `The ${act.slot} tears off.` : `The ${act.slot} comes off.`, noise: 4 };
  }

  if (act.kind === "sever") {
    const joint = JOINT_SPECS[act.joint];
    const limb = session.limbs[joint.limb];
    if (!limb.attached) return { ...idle, summary: "that limb is already off" };

    const step = severanceStep(session.joints[act.joint], act.joint, act.tool, act.force);
    session.joints[act.joint] = step.progressMm;
    session.acts += 1;
    session.vitals.pain = clamp(session.vitals.pain + 6, 0, 100);
    session.vitals.terror = clamp(session.vitals.terror + 4, 0, 100);

    if (!step.done) {
      return {
        ...idle,
        ok: true,
        summary: `${joint.label}: ${Math.round((step.progressMm / joint.workMm) * 100)}% through.`,
        noise: step.noise,
      };
    }

    limb.attached = false;
    limb.function = 0;
    session.vitals.shock = clamp(session.vitals.shock + 30, 0, 100);
    session.vitals.consciousness = clamp(session.vitals.consciousness - 20, 0, 100);

    const bleeding = limb.tourniquet ? 2 : joint.bleed;
    pushWound(session, {
      region: joint.region,
      tool: act.tool,
      kind: "amputation",
      depth: 1,
      bleeding,
      pain: 26,
      atMinute,
      limb: joint.limb,
    });
    if (!limb.tourniquet) session.blood.sprays += 1;

    const died = checkLethal(session, atMinute);
    return {
      ...idle,
      ok: true,
      summary: limb.tourniquet
        ? `${joint.label} separates. The tourniquet holds; it is not bleeding out yet.`
        : `${joint.label} separates and the ${joint.vessel} is open. This is minutes.`,
      noise: step.noise + 6,
      died,
    };
  }

  if (act.kind === "cauterize") {
    const wound = session.wounds.find((entry) => entry.id === act.woundId);
    if (!wound) return { ...idle, summary: "no such wound" };
    if (wound.cauterized) return { ...idle, summary: "that one is already closed" };
    wound.cauterized = true;
    wound.bleeding = Number((wound.bleeding * 0.12).toFixed(3));
    session.vitals.pain = clamp(session.vitals.pain + 6, 0, 100);
    session.vitals.infection = clamp(session.vitals.infection + 6, 0, 100);
    session.vitals.terror = clamp(session.vitals.terror + 6, 0, 100);
    return { ...idle, ok: true, summary: "The bleed is closed with heat. It will not bleed out now; it will fester instead.", noise: 6 };
  }

  if (act.kind === "tourniquet") {
    const limb = session.limbs[act.limb];
    limb.tourniquet = !limb.tourniquet;
    if (limb.tourniquet) {
      limb.tourniquetMinutes = 0;
      session.vitals.pain = clamp(session.vitals.pain + 5, 0, 100);
    }
    return {
      ...idle,
      ok: true,
      summary: limb.tourniquet ? `${act.limb} is tied off. The clock starts.` : `${act.limb} is released.`,
      noise: 2,
    };
  }

  if (act.kind === "nail") {
    if (session.nails[act.digit]) return { ...idle, summary: "that nail is already gone" };
    session.nails[act.digit] = true;
    session.vitals.pain = clamp(session.vitals.pain + 7, 0, 100);
    session.vitals.shock = clamp(session.vitals.shock + 4, 0, 100);
    session.vitals.terror = clamp(session.vitals.terror + 7, 0, 100);
    session.acts += 1;
    pushWound(session, {
      region: "leftHand",
      tool: act.tool,
      kind: "cut",
      depth: 0.1,
      bleeding: 0.3,
      pain: 7,
      atMinute,
      limb: "leftArm",
    });
    return { ...idle, ok: true, summary: "One nail. The hand is shaking too much to hold still for the next.", noise: 10 };
  }

  if (act.kind === "amputate") {
    const limb = session.limbs[act.limb];
    if (!limb.attached) return { ...idle, summary: "that limb is already off" };
    const tool = TOOL_SPECS[act.tool];
    limb.attached = false;
    limb.function = 0;
    session.vitals.shock = clamp(session.vitals.shock + 32, 0, 100);
    session.vitals.pain = clamp(session.vitals.pain + 24, 0, 100);
    session.vitals.consciousness = clamp(session.vitals.consciousness - 25, 0, 100);
    session.vitals.terror = clamp(session.vitals.terror + 15, 0, 100);
    session.acts += 1;

    const bleeding = limb.tourniquet ? 0.5 : 12 + tool.bleed * 2;
    pushWound(session, {
      region: LIMB_REGIONS[act.limb][0],
      tool: act.tool,
      kind: "amputation",
      depth: 1,
      bleeding,
      pain: 24,
      atMinute,
      limb: act.limb,
    });

    const died = checkLethal(session, atMinute);
    return {
      ...idle,
      ok: true,
      summary: limb.tourniquet
        ? `${act.limb} is off. The tourniquet is the only reason they are still conscious.`
        : `${act.limb} is off and the stump is not closed. This is minutes, not hours.`,
      noise: tool.noise + 8,
      died,
    };
  }

  if (act.kind === "sedate") {
    session.vitals.consciousness = clamp(session.vitals.consciousness - 30, 0, 100);
    session.vitals.pain = clamp(session.vitals.pain - 8, 0, 100);
    session.vitals.terror = clamp(session.vitals.terror + 3, 0, 100);
    return { ...idle, ok: true, summary: "They go quiet. The breathing is still there.", noise: 1 };
  }

  // Everything below actually hurts, so an unrestrained victim gets a chance first.
  if (!session.restraints.wrists && rng.chance(clamp01(0.05 + session.vitals.pain / 400))) {
    session.ended = true;
    session.endedAtMinute = atMinute;
    session.causeOfDeath = null;
    return { ...idle, ok: true, escaped: true, summary: "They got an arm free and there is no getting it back." };
  }

  const tool = TOOL_SPECS[act.tool];
  let noise = tool.noise;
  let summary = "";
  let organ: OrganId | null = null;
  let damage = 0;

  if (act.kind === "cut" || act.kind === "stab") {
    const depth = clamp01(act.depth);
    const region = act.region;
    const coverage = coverageAt(session.garments, region);

    // The physics layer decides how far the edge actually went; the physiology
    // layer only sees the result. Clothing is a real obstacle, not a costume.
    const contact = resolveContact({
      region,
      tool: act.tool,
      pointX: 0.3 + depth * 0.4,
      angleDeg: act.kind === "stab" ? 8 : 35,
      forceN: 40 + depth * 120,
      commandedCm: depth * TOOL_SPECS[act.tool].maxDepth * 14,
      clothing: coverage,
    });
    const normalised = clamp01(contact.depthCm / 14);

    const wound = pushWound(session, {
      region,
      tool: act.tool,
      kind: act.kind,
      depth: normalised,
      bleeding: contact.bleedMlMin,
      pain: contact.pain,
      atMinute,
      limb: limbForRegion(region),
    });

    session.vitals.pain = clamp(session.vitals.pain + wound.pain, 0, 100);
    session.vitals.shock = clamp(session.vitals.shock + wound.pain * 0.35, 0, 100);
    session.blood.poolMl += wound.bleeding * 0.2;

    organ = contact.organ;
    if (organ) {
      const state = session.organs[organ];
      state.exposed = true;
      const hit = clamp01(0.35 + normalised * 0.65);
      state.integrity = clamp01(state.integrity - hit);
      if (state.integrity <= 0) state.destroyed = true;
      damage = hit;
      session.vitals.shock = clamp(session.vitals.shock + 14, 0, 100);
      session.vitals.blood = Math.max(0, session.vitals.blood - contact.bleedMlMin * 0.1);
      summary = `${ORGAN_SPECS[organ].label} is opened.`;
      if (state.destroyed) summary = `${ORGAN_SPECS[organ].label} is destroyed.`;
      if (contact.structure?.kind === "artery") session.blood.sprays += 1;
    } else if (contact.deflectionDeg > 0) {
      summary = `The ${act.tool} turns ${contact.deflectionDeg}° on bone and stops at ${contact.depthCm.toFixed(1)} cm.`;
    } else {
      summary = `A ${act.kind} to the ${region.replace(/([A-Z])/g, " $1").toLowerCase()}, ${contact.depthCm.toFixed(1)} cm in.`;
    }
    if (contact.structure && contact.structure.kind !== "organ") summary += ` The ${contact.structure.label} is cut.`;
    if (contact.through) summary += " It goes right through.";
    if (coverage > 0.2) summary += ` (through ${Math.round(coverage * 100)}% clothing)`;
    noise = contact.noise;

    session.acts += 1;
    const died = checkLethal(session, atMinute);
    return {
      ...idle,
      ok: true,
      summary,
      noise,
      organ,
      damage,
      died,
    };
  }

  if (act.kind === "burn") {
    const wound = pushWound(session, {
      region: act.region,
      tool: act.tool,
      kind: "burn",
      depth: 0.4,
      bleeding: tool.bleed,
      pain: 10,
      atMinute,
      limb: limbForRegion(act.region),
    });
    session.vitals.pain = clamp(session.vitals.pain + 10, 0, 100);
    session.vitals.shock = clamp(session.vitals.shock + 8, 0, 100);
    session.vitals.terror = clamp(session.vitals.terror + 6, 0, 100);
    session.acts += 1;
    noise = tool.noise + 4;
    return { ...idle, ok: true, summary: `A burn across the ${act.region}. It will not bleed; it will infect.`, noise, damage: wound.pain };
  }

  if (act.kind === "blunt") {
    pushWound(session, {
      region: act.region,
      tool: act.tool,
      kind: "blunt",
      depth: 0.5,
      bleeding: tool.bleed,
      pain: 8,
      atMinute,
      limb: limbForRegion(act.region),
    });
    const limbId = limbForRegion(act.region);
    if (limbId) session.limbs[limbId].function = clamp01(session.limbs[limbId].function - 0.25);
    session.vitals.pain = clamp(session.vitals.pain + 9, 0, 100);
    session.vitals.shock = clamp(session.vitals.shock + 7, 0, 100);
    session.acts += 1;
    return { ...idle, ok: true, summary: `Blunt trauma to the ${act.region}.`, noise: tool.noise, damage: 0.5 };
  }

  return { ...idle, summary: "nothing happened" };
}

/**
 * Integrate the session. Bleeding, airway, shock and infection all advance on
 * their own clocks; this is what makes "keep them alive" a decision rather than a
 * state the player can leave unattended.
 */
export function advanceTorture(
  session: TortureSessionState,
  minutes: number,
  atMinute: number,
): { died: boolean; cause: string | null; unconscious: boolean } {
  if (session.ended || minutes <= 0) {
    return { died: false, cause: session.causeOfDeath, unconscious: session.vitals.consciousness <= 0 };
  }

  session.minutes += minutes;
  const vitals = session.vitals;

  for (const limb of LIMB_IDS) {
    const state = session.limbs[limb];
    if (!state.tourniquet) continue;
    state.tourniquetMinutes += minutes;
    if (state.tourniquetMinutes > 120) {
      state.function = clamp01(state.function - 0.002 * minutes);
      vitals.pain = clamp(vitals.pain + 0.05 * minutes, 0, 100);
    }
  }

  let bleedRate = 0;
  for (const wound of session.wounds) {
    if (wound.cauterized) continue;
    const limbId = wound.limb;
    if (limbId && session.limbs[limbId].tourniquet) continue;
    bleedRate += wound.bleeding;
  }

  vitals.blood = Math.max(0, vitals.blood - bleedRate * minutes);
  session.blood.poolMl += bleedRate * minutes * 0.55;
  session.blood.systolic = Math.round(35 + 85 * clamp01(vitals.blood / BASE_BLOOD_VOLUME));
  session.voice = voiceFor(vitals, session.sex);
  session.expression = expressionFor(vitals);

  for (const wound of session.wounds) {
    if (wound.infected) continue;
    const infectionRate = wound.kind === "burn" ? 0.05 : 0.012;
    if (!wound.cauterized && wound.depth >= 0.25) {
      vitals.infection = clamp(vitals.infection + infectionRate * minutes, 0, 100);
    }
    if (vitals.infection >= 70) wound.infected = true;
  }

  const bloodFraction = vitals.blood / BASE_BLOOD_VOLUME;
  const targetShock = clamp(
    (1 - bloodFraction) * 115 + vitals.pain * 0.35 + vitals.infection * 0.25 + vitals.terror * 0.12,
    0,
    100,
  );
  const pull = 1 - Math.exp(-0.12 * minutes);
  vitals.shock = clamp(vitals.shock + (targetShock - vitals.shock) * pull, 0, 100);
  vitals.consciousness = clamp(100 - vitals.shock * 0.95 - vitals.pain * 0.22 + vitals.adrenaline * 0.15, 0, 100);

  vitals.terror = clamp(vitals.terror + 0.02 * minutes, 0, 100);
  if (vitals.terror > 70 && vitals.pain > 40) vitals.compliance = clamp(vitals.compliance + 0.01 * minutes, 0, 100);
  if (vitals.shock > 60) vitals.dissociation = clamp(vitals.dissociation + 0.02 * minutes, 0, 100);
  vitals.adrenaline = Math.max(0, vitals.adrenaline - 0.05 * minutes);

  const airway = session.organs.trachea.destroyed || session.organs.lungs.destroyed;
  if (airway) {
    session.asphyxiaMinutes += minutes;
    if (session.asphyxiaMinutes >= 6) {
      markDead(session, ORGAN_SPECS[session.organs.trachea.destroyed ? "trachea" : "lungs"].death, atMinute);
      return { died: true, cause: session.causeOfDeath, unconscious: true };
    }
  }

  if (session.organs.spine.destroyed) {
    for (const limb of LIMB_IDS) session.limbs[limb].function = 0;
    vitals.consciousness = clamp(vitals.consciousness - 0.2 * minutes, 0, 100);
  }

  if (checkLethal(session, atMinute)) {
    return { died: true, cause: session.causeOfDeath, unconscious: true };
  }

  if (vitals.blood <= 0) {
    markDead(session, "exsanguination", atMinute);
    return { died: true, cause: session.causeOfDeath, unconscious: true };
  }

  if (vitals.shock >= 100) {
    markDead(session, "circulatory collapse", atMinute);
    return { died: true, cause: session.causeOfDeath, unconscious: true };
  }

  return { died: false, cause: null, unconscious: vitals.consciousness <= 0 };
}

/**
 * Stop the bleeding everywhere, at the cost of pain and infection. This is the
 * mechanic behind "cauterise so they will not bleed out": it works, it buys hours,
 * and it makes the room smell like a hospital with the power off.
 */
export function stabilise(session: TortureSessionState): number {
  let treated = 0;
  for (const wound of session.wounds) {
    if (wound.cauterized) continue;
    wound.cauterized = true;
    wound.bleeding = Number((wound.bleeding * 0.15).toFixed(3));
    session.vitals.infection = clamp(session.vitals.infection + 4, 0, 100);
    treated += 1;
  }
  session.vitals.pain = clamp(session.vitals.pain + treated * 2, 0, 100);
  session.vitals.terror = clamp(session.vitals.terror + treated * 2, 0, 100);
  return treated;
}

/** 0..1 rough odds they are still breathing in an hour. Used for UI and tests. */
export function survivalEstimate(session: TortureSessionState): number {
  const bloodFraction = session.vitals.blood / BASE_BLOOD_VOLUME;
  const bleed = session.wounds.filter((wound) => !wound.cauterized).reduce((sum, wound) => sum + wound.bleeding, 0);
  const bleedPressure = bleed * 60 / BASE_BLOOD_VOLUME;
  return clamp01(bloodFraction * 0.7 + (1 - session.vitals.shock / 100) * 0.3 - bleedPressure);
}

/** Fill in fields added after a save was written, so old saves still load. */
export function normaliseSession(session: TortureSessionState | null): TortureSessionState | null {
  if (!session) return null;
  const sex = session.sex ?? "female";
  const bloodFraction = clamp01(session.vitals.blood / BASE_BLOOD_VOLUME);
  return {
    ...session,
    sex,
    garments: session.garments ?? garmentsFor(session.dress),
    joints: session.joints ?? emptyJoints(),
    blood: session.blood ?? { poolMl: 0, sprays: 0, systolic: Math.round(35 + 85 * bloodFraction) },
    voice: session.voice ?? voiceFor(session.vitals, sex),
    expression: session.expression ?? expressionFor(session.vitals),
  };
}

export function describeSession(session: TortureSessionState): string[] {
  const removed = DIGITS.filter((digit) => session.nails[digit]).length;
  const detached = LIMB_IDS.filter((limb) => !session.limbs[limb].attached);
  const destroyed = ORGAN_IDS.filter((organ) => session.organs[organ].destroyed);
  return [
    `victim ${session.victimId}, ${session.dress}, ${session.restraints.wrists ? "wrists bound" : "wrists free"}${session.restraints.gag ? ", gagged" : ""}`,
    `blood ${Math.round((session.vitals.blood / BASE_BLOOD_VOLUME) * 100)}%, pain ${Math.round(session.vitals.pain)}, shock ${Math.round(session.vitals.shock)}, consciousness ${Math.round(session.vitals.consciousness)}`,
    `terror ${Math.round(session.vitals.terror)}, compliance ${Math.round(session.vitals.compliance)}, infection ${Math.round(session.vitals.infection)}`,
    `${session.wounds.length} wound(s), ${removed} nail(s) removed, ${detached.length} limb(s) off${destroyed.length > 0 ? `, destroyed: ${destroyed.join(", ")}` : ""}`,
    `clothing: ${session.garments.filter((garment) => garment.coverage > 0).map((garment) => `${garment.item} ${Math.round(garment.coverage * 100)}%`).join(", ") || "none"}`,
    `pooled ${Math.round(session.blood.poolMl)} ml, pressure ${session.blood.systolic}, sprays ${session.blood.sprays}`,
    `voice ${session.voice.cue} (${Math.round(session.voice.intensity * 100)}%), face ${session.expression}`,
    `joints: ${JOINT_IDS.filter((joint) => session.joints[joint] > 0).map((joint) => `${joint} ${Math.round((session.joints[joint] / JOINT_SPECS[joint].workMm) * 100)}%`).join(", ") || "none worked"}`,
    session.ended ? `ended at minute ${session.endedAtMinute ?? 0}: ${session.causeOfDeath ?? "survived"}` : `still going, minute ${session.minutes}`,
  ];
}
