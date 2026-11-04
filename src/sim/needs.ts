/**
 * Daily needs (Section 12). Needs are satisfaction levels (100 = fully met) that
 * decay with elapsed time and are restored by whichever activity the NPC is in.
 * Time-based rather than tick-based so off-screen tiers integrate exactly the
 * same function over a longer interval.
 */

import type { Activity, NeedId, Needs, Npc } from "./types.ts";
import { NEED_IDS } from "./types.ts";

export const NEED_DECAY_PER_HOUR: Record<NeedId, number> = {
  hunger: 2.2,
  thirst: 1.8,
  fatigue: 1.5,
  hygiene: 0.9,
  comfort: 0.8,
  social: 1.3,
  fun: 1.2,
};

/** Per-hour change while performing an activity. */
export const ACTIVITY_EFFECTS: Record<Activity, Partial<Needs>> = {
  sleep: { fatigue: 11, comfort: 2 },
  work: { fun: -2, social: 1.5, comfort: -1 },
  commute: { comfort: -3, fun: -1 },
  eat: { hunger: 28, thirst: 12 },
  shop: { fun: 3, social: 2 },
  socialize: { social: 16, fun: 8 },
  exercise: { fun: 4, hygiene: -8, fatigue: -6, thirst: -4 },
  appointment: { comfort: -1, social: 2 },
  leisure: { fun: 10, comfort: 3 },
  home: { comfort: 4, fun: 2, hygiene: 1.5 },
  care: { comfort: 2, social: 3, fun: 1, hygiene: 22 },
};

function clampNeed(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function createNeedsBaseline(): Needs {
  return { hunger: 75, thirst: 75, fatigue: 80, hygiene: 80, comfort: 70, social: 60, fun: 60 };
}

/**
 * Integrate elapsed minutes. `activity` optionally restores the needs that
 * activity serves, so an off-screen NPC who spent the last 8 hours asleep is not
 * treated as if they spent it awake.
 */
export function advanceNeeds(npc: Npc, minutes: number, activity?: Activity): void {
  if (minutes <= 0) return;
  const hours = minutes / 60;
  for (const need of NEED_IDS) {
    npc.needs[need] = clampNeed(npc.needs[need] - NEED_DECAY_PER_HOUR[need] * hours);
  }
  if (activity) {
    const effects = ACTIVITY_EFFECTS[activity];
    for (const need of NEED_IDS) {
      const change = effects[need];
      if (change === undefined) continue;
      npc.needs[need] = clampNeed(npc.needs[need] + change * hours);
    }
  }
}

export function satisfy(npc: Npc, changes: Partial<Needs>): void {
  for (const need of NEED_IDS) {
    const change = changes[need];
    if (change === undefined) continue;
    npc.needs[need] = clampNeed(npc.needs[need] + change);
  }
}

/** 0..100 across all needs, weighted by how much each one matters right now. */
export function needComfortIndex(npc: Npc): number {
  let sum = 0;
  let weight = 0;
  const urgency: Record<NeedId, number> = {
    hunger: 1.4,
    thirst: 1.6,
    fatigue: 1.5,
    hygiene: 0.8,
    comfort: 0.9,
    social: 1.1,
    fun: 0.7,
  };
  for (const need of NEED_IDS) {
    sum += npc.needs[need] * urgency[need];
    weight += urgency[need];
  }
  return sum / weight;
}

/** Needs feed mood: a hungry, exhausted, lonely person is not receptive. */
export function moodFromNeeds(npc: Npc): number {
  const comfort = needComfortIndex(npc);
  const base = (comfort - 50) * 1.2;
  const personalityBias = (npc.personality.neuroticism - 0.5) * -14;
  return Math.max(-100, Math.min(100, base + personalityBias));
}
