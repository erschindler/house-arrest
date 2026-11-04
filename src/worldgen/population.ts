/**
 * Deterministic population generation.
 *
 * Everything here is fictional and generated: names are invented composites, not
 * real people. Every generated character is an adult (Section 18.2) — `isMinor`
 * is false by construction, and the hard block in the content gate is the
 * backstop rather than the only defence.
 */

import { FETISH_CATEGORIES } from "../content/gate.ts";
import type { FetishCategory } from "../content/gate.ts";
import { shuffled } from "../core/rng.ts";
import type { Rng } from "../core/rng.ts";
import { createNeedsBaseline } from "../sim/needs.ts";
import { RelationshipStore, defaultAxes, keyFor } from "../sim/relationship.ts";
import type { Relationship, RelationshipDelta } from "../sim/relationship.ts";
import { OCCUPATION_KEYS, buildSchedule, occupationWealth } from "../sim/schedule.ts";
import type { Npc, NpcId, Personality, SexualProfile } from "../sim/types.ts";

const GIVEN_FEMALE = [
  "Maren", "Ilse", "Nadia", "Priya", "Rosa", "Tess", "Yolanda", "Kira",
  "Delphine", "Anouk", "Beatrix", "Sana", "Oksana", "Lena", "Mireille", "Junia",
];
const GIVEN_MALE = [
  "Dorian", "Emil", "Rafael", "Tobias", "Kwame", "Anders", "Hiro", "Mateo",
  "Stellan", "Vikram", "Callum", "Barnaby", "Osric", "Teo", "Malik", "Ingmar",
];
const GIVEN_NEUTRAL = ["Ash", "Rin", "Noor", "Sasha", "Yuki", "Alex", "Quinn", "Mica"];

const FAMILY_NAMES = [
  "Voss", "Alder", "Crane", "Mbeki", "Ferreira", "Nakamura", "Larsen", "Okafor",
  "Bright", "Halloran", "Duval", "Sato", "Kowal", "Ainsley", "Rask", "Vance",
  "Odell", "Mercer", "Trelawney", "Brandt",
];

const TRAITS = [
  "warm", "guarded", "meticulous", "impulsive", "sardonic", "anxious", "generous",
  "competitive", "private", "restless", "patient", "vindictive", "curious", "proud",
];

const SAFEWORDS = ["red", "saffron", "harbour", "nine", "lantern", "atlas", "meridian", "orange"];

type Gender = "female" | "male" | "nonbinary";

function makePersonality(rng: Rng): Personality {
  return {
    openness: rng.next(),
    conscientiousness: rng.next(),
    extraversion: rng.next(),
    agreeableness: rng.next(),
    neuroticism: rng.next(),
  };
}

function makeSexualProfile(rng: Rng): SexualProfile {
  const orientation = rng.weighted([
    { item: "heterosexual" as const, weight: 5 },
    { item: "homosexual" as const, weight: 2 },
    { item: "bisexual" as const, weight: 2.5 },
    { item: "pansexual" as const, weight: 1.2 },
    { item: "asexual" as const, weight: 0.6 },
  ]);

  const pool = shuffled(rng, FETISH_CATEGORIES);
  const interests: FetishCategory[] = pool.slice(0, rng.int(0, 2));
  const curiosities: FetishCategory[] = pool.slice(2, 2 + rng.int(1, 3));
  const hardLimits: FetishCategory[] = pool.slice(5, 5 + rng.int(1, 2));

  return {
    orientation,
    experience: rng.weighted([
      { item: "novice" as const, weight: 2 },
      { item: "some" as const, weight: 4 },
      { item: "experienced" as const, weight: 3 },
    ]),
    interests,
    curiosities,
    hardLimits,
    comfort: 0.2 + rng.next() * 0.6,
    safeword: rng.pick(SAFEWORDS),
  };
}

export type AdultNpcOptions = {
  occupation?: string;
  age?: number;
  gender?: Gender;
};

export function makeAdultNpc(rng: Rng, id: NpcId, options: AdultNpcOptions = {}): Npc {
  const gender = options.gender ?? rng.weighted([
    { item: "female" as const, weight: 48 },
    { item: "male" as const, weight: 48 },
    { item: "nonbinary" as const, weight: 4 },
  ]);
  const givenPool =
    gender === "female" ? GIVEN_FEMALE : gender === "male" ? GIVEN_MALE : GIVEN_NEUTRAL;
  const occupation = options.occupation ?? rng.pick(OCCUPATION_KEYS);
  const personality = makePersonality(rng);
  const needs = createNeedsBaseline();
  for (const key of Object.keys(needs) as (keyof typeof needs)[]) {
    needs[key] = Math.max(0, Math.min(100, needs[key] + rng.int(-15, 15)));
  }

  const npc: Npc = {
    id,
    givenName: rng.pick(givenPool),
    familyName: rng.pick(FAMILY_NAMES),
    age: options.age ?? rng.int(21, 68),
    gender,
    isMinor: false,
    occupation,
    personality,
    needs,
    mood: rng.int(-10, 25),
    stress: rng.int(5, 40),
    paranoia: 0,
    guilt: 0,
    cash: Math.round(occupationWealth(occupation) * rng.int(400, 4200)),
    schedule: buildSchedule(rng, occupation, personality, rng.int(0, 3)),
    homeLocation: "elsewhere",
    sexual: makeSexualProfile(rng),
    disclosed: [],
    traits: [rng.pick(TRAITS), rng.pick(TRAITS)].filter((value, index, all) => all.indexOf(value) === index),
    lastSimulatedMinute: 0,
    alive: true,
  };

  return npc;
}

export function createPlayerNpc(id: NpcId, rng: Rng): Npc {
  const npc = makeAdultNpc(rng, id, { occupation: "unemployed", age: 34 });
  npc.traits.push("under house arrest");
  npc.cash = 640;
  return npc;
}

export type PopulationResult = {
  npcs: Npc[];
  relationships: Relationship[];
};

export type PopulationOptions = {
  rng: Rng;
  count: number;
  player: Npc;
};

export function generatePopulation(options: PopulationOptions): PopulationResult {
  const { rng, count, player } = options;
  const npcs: Npc[] = [];
  for (let i = 1; i <= count; i += 1) {
    npcs.push(makeAdultNpc(rng, `npc-${i}`, { occupation: rng.pick(OCCUPATION_KEYS) }));
  }

  const store = new RelationshipStore();
  const linked = new Set<string>();

  const link = (a: NpcId, b: NpcId, delta: RelationshipDelta, family = false): void => {
    const key = keyFor(a, b);
    if (linked.has(key)) return;
    linked.add(key);
    if (family) store.markFamily(a, b);
    store.apply(a, b, delta, 0);
  };

  // Family: permanently non-romantic, high familiarity, real friction available.
  if (npcs.length >= 2) {
    link(player.id, npcs[0].id, { familiarity: 85, trust: 55, respect: 30, attachment: 60, resentment: 8 }, true);
    link(player.id, npcs[1].id, { familiarity: 78, trust: 40, respect: 20, attachment: 45, resentment: 14 }, true);
  }

  // A small circle who already know the player.
  for (let i = 2; i < Math.min(npcs.length, 8); i += 1) {
    link(player.id, npcs[i].id, {
      familiarity: rng.int(30, 55),
      friendship: rng.int(20, 45),
      trust: rng.int(15, 40),
      respect: rng.int(0, 25),
    });
  }

  // Background social graph — this is what gossip travels along.
  for (const npc of npcs) {
    const contacts = rng.int(1, 3);
    for (let i = 0; i < contacts; i += 1) {
      const other = rng.pick(npcs);
      if (other.id === npc.id) continue;
      link(npc.id, other.id, {
        familiarity: rng.int(10, 45),
        friendship: rng.int(5, 40),
        trust: rng.int(5, 35),
      });
    }
  }

  // Ensure the store is materialised for every pair we care about.
  for (const npc of npcs) {
    store.get(player.id, npc.id);
  }

  return { npcs, relationships: store.all() };
}

export function defaultRelationshipAxes(): ReturnType<typeof defaultAxes> {
  return defaultAxes();
}
