/**
 * Shared domain data. Pure types only — no behaviour, no imports beyond the
 * content vocabulary, so every subsystem can depend on this without cycles.
 */

import type { FetishCategory } from "../content/gate.ts";
import type { AppearanceState, InjuryState } from "./anatomy.ts";

export type NpcId = string;
export type LocationId = string;

export type Personality = {
  openness: number; // 0..1
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
};

export const NEED_IDS = ["hunger", "thirst", "fatigue", "hygiene", "comfort", "social", "fun"] as const;
export type NeedId = (typeof NEED_IDS)[number];
/** 0 = desperate, 100 = fully satisfied. */
export type Needs = Record<NeedId, number>;

export type Activity =
  | "sleep"
  | "work"
  | "commute"
  | "eat"
  | "shop"
  | "socialize"
  | "exercise"
  | "appointment"
  | "leisure"
  | "home"
  | "care";

export type ScheduleBlock = {
  startMinute: number;
  endMinute: number;
  activity: Activity;
  location: LocationId;
};

export type Orientation = "heterosexual" | "homosexual" | "bisexual" | "pansexual" | "asexual";

/**
 * A character's sexual profile (Section 5). Discovered through conversation and
 * experience — never exposed as a menu. Everyone holding one of these is an adult.
 */
export type SexualProfile = {
  orientation: Orientation;
  experience: "novice" | "some" | "experienced";
  interests: FetishCategory[];
  curiosities: FetishCategory[];
  hardLimits: FetishCategory[];
  /** 0..1 baseline comfort with intimacy; shifts slowly with trust and history. */
  comfort: number;
  safeword: string;
};

export type Npc = {
  id: NpcId;
  givenName: string;
  familyName: string;
  age: number;
  gender: "female" | "male" | "nonbinary";
  /** Always false for generated adults. Present so the hard block is explicit. */
  isMinor: boolean;
  occupation: string;
  personality: Personality;
  needs: Needs;
  mood: number; // -100..100
  stress: number; // 0..100
  paranoia: number; // 0..100
  guilt: number; // 0..100
  cash: number;
  schedule: ScheduleBlock[];
  homeLocation: LocationId;
  sexual: SexualProfile;
  /** Kink categories this NPC has revealed to the player. */
  disclosed: FetishCategory[];
  traits: string[];
  lastSimulatedMinute: number;
  alive: boolean;
  /** Clothing state. What may be *shown* of it is decided by the content gate. */
  appearance: AppearanceState;
  /** Layered wounds, blood volume, shock and dying state (Section 7). */
  injury: InjuryState;
  /** 0..100 emotional detachment; rises with sustained cruelty (Section 7). */
  detachment: number;
};

export type MemoryKind =
  | "social"
  | "romantic"
  | "intimate"
  | "conflict"
  | "violence"
  | "discovery"
  | "household"
  | "gift";

export type Memory = {
  id: string;
  atMinute: number;
  kind: MemoryKind;
  summary: string;
  participants: NpcId[];
  tags: string[];
  /** 0..1, decays over time; drives recall and gossip potential. */
  salience: number;
  /** -1..1 */
  valence: number;
};

export type GameEventLogEntry = {
  id: string;
  atMinute: number;
  kind: string;
  summary: string;
  participants: NpcId[];
  /** True when a content gate was consulted to produce this entry. */
  gated: boolean;
};

export type LogInput = Omit<GameEventLogEntry, "id" | "atMinute">;
