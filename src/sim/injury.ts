/**
 * The anatomical injury model (brief Section 7).
 *
 * Layered wounds, blood volume, shock, pain, consciousness, infection and a
 * drawn-out dying state. Deterministic throughout: infection is a function of how
 * long a significant wound went untreated, not a dice roll, so an off-screen
 * character's injuries advance the same way a visible one's do and the world hash
 * stays stable.
 *
 * This module describes state, never injury. Presentation (asset classes, decals,
 * animation) is chosen elsewhere and gated by content settings.
 */

import type {
  BodyRegion,
  InjuryState,
  Vitals,
  WeaponKind,
  Wound,
  WoundLayer,
} from "./anatomy.ts";
import {
  BASE_BLOOD_VOLUME,
  DYING_BLOOD_FRACTION,
  REGION_CRITICALITY,
  UNCONSCIOUS_BLOOD_FRACTION,
  WEAPON_PROFILES,
} from "./anatomy.ts";

/** Minutes an untreated significant wound takes to become infected. */
export const INFECTION_ONSET_MINUTES = 360;

export function createInjuryState(): InjuryState {
  return {
    wounds: [],
    vitals: { blood: BASE_BLOOD_VOLUME, shock: 0, pain: 0, consciousness: 100, infection: 0 },
    dyingSince: null,
    alive: true,
    causeOfDeath: null,
    attributedTo: null,
    counter: 0,
  };
}

export function maxSeverity(wound: Wound): number {
  let max = 0;
  for (const value of Object.values(wound.severities)) {
    if (typeof value === "number" && value > max) max = value;
  }
  return max;
}

export function applyWound(
  state: InjuryState,
  weapon: WeaponKind,
  region: BodyRegion,
  severity: number,
  atMinute: number,
  attributedTo: string | null = null,
): Wound {
  const profile = WEAPON_PROFILES[weapon];
  const clamped = Math.max(0.05, Math.min(1, severity));
  const severities: Partial<Record<WoundLayer, number>> = {};
  // Deeper layers take proportionally less damage than the surface layer.
  profile.layers.forEach((layer, index) => {
    severities[layer] = Math.max(0.05, clamped * (1 - index * 0.22));
  });

  state.counter += 1;
  const bleed = profile.bleed * clamped * REGION_CRITICALITY[region];
  const wound: Wound = {
    id: `wound-${state.counter}`,
    weapon,
    region,
    severities,
    bleeding: Number(bleed.toFixed(3)),
    pain: Math.round(profile.pain * clamped),
    atMinute,
    treated: false,
    infected: false,
  };
  state.wounds.push(wound);
  if (attributedTo !== null) state.attributedTo = attributedTo;

  state.vitals.pain = Math.min(100, state.vitals.pain + wound.pain);
  state.vitals.shock = Math.min(100, state.vitals.shock + wound.pain * 0.6);
  if (wound.pain >= 9) state.vitals.consciousness = Math.max(0, state.vitals.consciousness - 20);

  return wound;
}

export type InjuryProgress = {
  died: boolean;
  enteredDying: boolean;
  lostConsciousness: boolean;
  newlyInfected: number;
};

/**
 * Integrate elapsed minutes. Safe to call with large intervals: every term is
 * either linear in time or relaxes exponentially toward a target, so a character
 * simulated every minute and one simulated once a day converge.
 */
export function advanceInjury(state: InjuryState, minutes: number, nowMinute: number): InjuryProgress {
  const progress: InjuryProgress = {
    died: false,
    enteredDying: false,
    lostConsciousness: false,
    newlyInfected: 0,
  };
  if (!state.alive || minutes <= 0) return progress;

  let infected = 0;
  for (const wound of state.wounds) {
    if (!wound.treated && !wound.infected && nowMinute - wound.atMinute >= INFECTION_ONSET_MINUTES && maxSeverity(wound) >= 0.4) {
      wound.infected = true;
      progress.newlyInfected += 1;
    }
    if (wound.infected) infected += 1;
  }
  state.vitals.infection = Math.min(100, infected * 14);

  const effectiveBleed = state.wounds.reduce(
    (sum, wound) => sum + (wound.treated ? wound.bleeding * 0.2 : wound.bleeding),
    0,
  );
  state.vitals.blood = Math.max(0, state.vitals.blood - effectiveBleed * minutes);

  const bloodFraction = state.vitals.blood / BASE_BLOOD_VOLUME;
  const targetShock = Math.min(
    100,
    Math.max(0, (1 - bloodFraction) * 120 + state.vitals.pain * 0.4 + state.vitals.infection * 0.2),
  );
  // ~15% of the gap per minute: minutes-scale collapse, not instant.
  const pull = 1 - Math.exp(-0.15 * minutes);
  const before = state.vitals.consciousness;
  state.vitals.shock = Math.max(0, Math.min(100, state.vitals.shock + (targetShock - state.vitals.shock) * pull));
  state.vitals.consciousness = Math.max(0, Math.min(100, 100 - state.vitals.shock * 0.95 - state.vitals.pain * 0.25));
  if (before > 0 && state.vitals.consciousness <= 0) progress.lostConsciousness = true;

  if (bloodFraction <= DYING_BLOOD_FRACTION && state.dyingSince === null) {
    state.dyingSince = nowMinute;
    progress.enteredDying = true;
  }

  if (state.vitals.blood <= 0) {
    state.alive = false;
    state.causeOfDeath = "exsanguination";
    state.vitals.consciousness = 0;
    progress.died = true;
  } else if (bloodFraction <= 0.2 && state.dyingSince === null) {
    state.dyingSince = nowMinute;
    progress.enteredDying = true;
  }

  return progress;
}

/** quality 0..1 — how good the treatment was. Cheap field dressing vs proper care. */
export function treat(state: InjuryState, woundId: string, quality: number): boolean {
  const wound = state.wounds.find((entry) => entry.id === woundId);
  if (!wound || wound.treated) return false;
  const q = Math.max(0, Math.min(1, quality));
  wound.treated = true;
  wound.bleeding = Number((wound.bleeding * (1 - 0.85 * q)).toFixed(3));
  wound.pain = Math.round(wound.pain * (1 - 0.4 * q));
  wound.infected = false;
  state.vitals.pain = Math.max(0, state.vitals.pain - wound.pain * 0.4);
  return true;
}

export function isDying(state: InjuryState): boolean {
  return state.alive && state.dyingSince !== null;
}

export function isUnconscious(state: InjuryState): boolean {
  return state.vitals.consciousness <= 0;
}

/** 0..100 aggregate burden, used for gait, voice and behaviour modifiers. */
export function painIndex(state: InjuryState): number {
  return Math.min(100, state.vitals.pain);
}

export function bloodFraction(state: InjuryState): number {
  return state.vitals.blood / BASE_BLOOD_VOLUME;
}

export function unconsciousThresholdReached(state: InjuryState): boolean {
  return bloodFraction(state) <= UNCONSCIOUS_BLOOD_FRACTION && state.vitals.consciousness < 40;
}

export function woundsOf(state: InjuryState): Wound[] {
  return state.wounds;
}

export function vitalsOf(state: InjuryState): Vitals {
  return state.vitals;
}
