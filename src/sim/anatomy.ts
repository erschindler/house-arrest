/**
 * Anatomical and appearance data shared by the injury, violence and presentation
 * layers (brief Section 7, Section 15).
 *
 * Pure data with no imports and no behaviour. Everything here is abstract
 * simulation vocabulary — layers, severities, volumes — so that the presentation
 * layer decides how any of it looks, and the content gate decides whether it may
 * be shown at all.
 */

export type BodyRegion =
  | "head"
  | "neck"
  | "torso"
  | "abdomen"
  | "arm"
  | "hand"
  | "leg"
  | "foot";

export const BODY_REGIONS: BodyRegion[] = ["head", "neck", "torso", "abdomen", "arm", "hand", "leg", "foot"];

/** Vital regions bleed and kill faster; this is a multiplier, not a description. */
export const REGION_CRITICALITY: Record<BodyRegion, number> = {
  head: 1.8,
  neck: 2.0,
  torso: 1.4,
  abdomen: 1.3,
  arm: 0.8,
  hand: 0.6,
  leg: 0.9,
  foot: 0.6,
};

export type WoundLayer = "skin" | "muscle" | "bone" | "organ";

export type WeaponKind = "blunt" | "blade" | "improvised" | "firearm";

export type WoundProfile = {
  label: string;
  layers: WoundLayer[];
  /** Blood loss in millilitres per minute at full severity. */
  bleed: number;
  /** Pain contribution at full severity. */
  pain: number;
};

export const WEAPON_PROFILES: Record<WeaponKind, WoundProfile> = {
  blunt: { label: "blunt force", layers: ["skin", "muscle", "bone"], bleed: 0.7, pain: 7 },
  blade: { label: "blade", layers: ["skin", "muscle"], bleed: 2.6, pain: 8 },
  improvised: { label: "improvised weapon", layers: ["skin", "muscle"], bleed: 1.2, pain: 5 },
  firearm: { label: "firearm", layers: ["skin", "muscle", "organ"], bleed: 4.4, pain: 10 },
};

export type Wound = {
  id: string;
  weapon: WeaponKind;
  region: BodyRegion;
  /** 0..1 severity per affected layer. */
  severities: Partial<Record<WoundLayer, number>>;
  /** Millilitres per minute at current treatment state. */
  bleeding: number;
  pain: number;
  atMinute: number;
  treated: boolean;
  infected: boolean;
};

export type Vitals = {
  /** Millilitres remaining. A body holds BASE_BLOOD_VOLUME. */
  blood: number;
  /** 0..100 */
  shock: number;
  pain: number;
  consciousness: number;
  infection: number;
};

export type InjuryState = {
  wounds: Wound[];
  vitals: Vitals;
  /** Minute the character entered the dying state, if they did. */
  dyingSince: number | null;
  alive: boolean;
  causeOfDeath: string | null;
  /**
   * Who the injuries are attributed to. Without this a death leaves evidence that
   * points at nobody, and the investigation system has nothing to work with.
   */
  attributedTo: string | null;
  counter: number;
};

export const BASE_BLOOD_VOLUME = 5000;

/** Fractions of blood volume at which states change. */
export const DYING_BLOOD_FRACTION = 0.55;
export const UNCONSCIOUS_BLOOD_FRACTION = 0.7;

export type DressState = "dressed" | "partiallyDressed" | "undressed";

export type AppearanceState = {
  dress: DressState;
};

/** Rooms where a person has a reasonable expectation of privacy (brief §6). */
export const PRIVATE_LOCATIONS = ["bathroom", "masterBedroom", "guestBedroom"] as const;

export function isPrivateLocation(location: string): boolean {
  return (PRIVATE_LOCATIONS as readonly string[]).includes(location);
}
