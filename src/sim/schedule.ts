/**
 * Persistent daily schedules (Section 4: NPCs wake, work, shop, visit, socialize,
 * sleep — tracked off-screen, never spawned on demand).
 *
 * A schedule is a set of blocks covering the whole day. It is generated once from
 * occupation and personality, stored on the NPC, and used identically by the full,
 * coarse and statistical simulation tiers. That is the whole reason off-screen
 * lives stay coherent: every tier reads the same schedule.
 */

import type { Rng } from "../core/rng.ts";
import type { Activity, LocationId, Npc, Personality, ScheduleBlock } from "./types.ts";
import { MINUTES_PER_DAY } from "../core/clock.ts";

export const HOUSE_LOCATIONS: LocationId[] = [
  "livingRoom",
  "kitchen",
  "diningRoom",
  "masterBedroom",
  "guestBedroom",
  "bathroom",
  "office",
  "laundry",
  "basement",
  "garage",
  "porch",
  "backyard",
];

export const OUT_OF_HOUSE_LOCATIONS: LocationId[] = ["workplace", "store", "gym", "elsewhere"];

export type BlockTemplate = {
  startHour: number;
  endHour: number;
  activity: Activity;
  location: LocationId;
};

type OccupationTemplate = {
  activity: Activity;
  location: LocationId;
  startHour: number;
  endHour: number;
};

const OCCUPATIONS: Record<string, { work: OccupationTemplate; wealth: number }> = {
  nurse: { work: { activity: "work", location: "workplace", startHour: 19, endHour: 7 }, wealth: 1 },
  teacher: { work: { activity: "work", location: "workplace", startHour: 8, endHour: 16 }, wealth: 1 },
  electrician: { work: { activity: "work", location: "workplace", startHour: 8, endHour: 17 }, wealth: 1.1 },
  barista: { work: { activity: "work", location: "workplace", startHour: 6, endHour: 14 }, wealth: 0.7 },
  softwareEngineer: { work: { activity: "work", location: "workplace", startHour: 10, endHour: 18 }, wealth: 1.6 },
  deliveryDriver: { work: { activity: "work", location: "workplace", startHour: 9, endHour: 18 }, wealth: 0.8 },
  contractor: { work: { activity: "work", location: "workplace", startHour: 7, endHour: 16 }, wealth: 1.2 },
  cleaner: { work: { activity: "work", location: "workplace", startHour: 8, endHour: 15 }, wealth: 0.6 },
  realEstateAgent: { work: { activity: "work", location: "workplace", startHour: 9, endHour: 18 }, wealth: 1.4 },
  therapist: { work: { activity: "work", location: "workplace", startHour: 10, endHour: 19 }, wealth: 1.5 },
  retired: { work: { activity: "leisure", location: "livingRoom", startHour: 10, endHour: 14 }, wealth: 1.2 },
  unemployed: { work: { activity: "home", location: "livingRoom", startHour: 11, endHour: 16 }, wealth: 0.4 },
  student: { work: { activity: "appointment", location: "elsewhere", startHour: 9, endHour: 15 }, wealth: 0.5 },
};

export const OCCUPATION_KEYS = Object.keys(OCCUPATIONS);

export function occupationWealth(occupation: string): number {
  return OCCUPATIONS[occupation]?.wealth ?? 1;
}

/**
 * Build a full-day schedule. `variant` nudges wake time so two people with the
 * same job do not live identical lives — that sameness is exactly what makes an
 * NPC feel like a menu.
 */
export function buildSchedule(rng: Rng, occupation: string, personality: Personality, index = 0): ScheduleBlock[] {
  const template = OCCUPATIONS[occupation] ?? OCCUPATIONS.unemployed;
  const nightShift = template.work.startHour >= 19 || template.work.endHour <= 7;
  const wakeHour = nightShift ? 15 : 6 + Math.floor(personality.conscientiousness * 2) + (index % 2);
  const sleepHour = nightShift ? 8 : 22 + (index % 3);

  const blocks: ScheduleBlock[] = [];

  const push = (startHour: number, endHour: number, activity: Activity, location: LocationId): void => {
    const start = startHour * 60;
    const end = endHour * 60;
    if (end > start) blocks.push({ startMinute: start, endMinute: end, activity, location });
  };

  // Sleep, split across midnight if necessary.
  if (sleepHour + (24 - sleepHour) >= sleepHour) {
    push(sleepHour, 24, "sleep", "masterBedroom");
    push(0, wakeHour, "sleep", "masterBedroom");
  }

  push(wakeHour, wakeHour + 1, "eat", "kitchen");
  push(wakeHour + 1, wakeHour + 2, "care", "bathroom");

  const work = template.work;
  if (nightShift) {
    push(work.startHour, 24, work.activity, work.location);
    push(0, work.endHour, work.activity, work.location);
    push(wakeHour + 2, work.startHour, "leisure", "livingRoom");
  } else {
    push(wakeHour + 2, work.startHour, rng.chance(0.5) ? "leisure" : "home", "livingRoom");
    push(work.startHour, work.endHour, work.activity, work.location);
    push(work.endHour, work.endHour + 1, "commute", "elsewhere");
    push(work.endHour + 1, work.endHour + 2, "shop", "store");
  }

  push(18, 19, "eat", "diningRoom");
  push(19, 21, "socialize", "livingRoom");
  push(21, Math.min(23, sleepHour), "leisure", "livingRoom");

  return fillGaps(blocks);
}

/** Guarantee full 24h coverage so blockAt() always has an answer. */
export function fillGaps(blocks: ScheduleBlock[]): ScheduleBlock[] {
  const sorted = blocks
    .filter((b) => b.endMinute > b.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute);

  const filled: ScheduleBlock[] = [];
  let cursor = 0;
  for (const block of sorted) {
    if (block.startMinute > cursor) {
      filled.push({ startMinute: cursor, endMinute: block.startMinute, activity: "home", location: "livingRoom" });
    }
    const start = Math.max(cursor, block.startMinute);
    if (block.endMinute > start) {
      filled.push({ ...block, startMinute: start });
      cursor = block.endMinute;
    }
  }
  if (cursor < MINUTES_PER_DAY) {
    filled.push({ startMinute: cursor, endMinute: MINUTES_PER_DAY, activity: "home", location: "livingRoom" });
  }
  return filled;
}

export function blockAt(npc: Npc, clockMinutes: number): ScheduleBlock {
  const minuteOfDay = ((clockMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  for (const block of npc.schedule) {
    if (minuteOfDay >= block.startMinute && minuteOfDay < block.endMinute) return block;
  }
  return { startMinute: 0, endMinute: MINUTES_PER_DAY, activity: "home", location: "livingRoom" };
}

/**
 * Whether this character is in *the player's* house right now.
 *
 * Room ids are generic (`masterBedroom`, `kitchen`), and the generated population
 * uses the same vocabulary for their own homes. Without the residency check, every
 * character in the city was "on the property" every night, which put eighty people
 * in one bedroom and made every one of them a witness to anything that happened
 * there. `homeLocation` is what distinguishes "a bedroom" from "your bedroom".
 */
export function isOnProperty(npc: Npc, clockMinutes: number): boolean {
  if (npc.homeLocation === "elsewhere") return false;
  const location = blockAt(npc, clockMinutes).location;
  return HOUSE_LOCATIONS.includes(location);
}
