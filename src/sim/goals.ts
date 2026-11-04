/**
 * Objectives and endings.
 *
 * The simulation has always been able to run for a month and report what
 * happened. What it could not do was answer "how am I doing" or "is this over".
 * Both are pure functions of world state, deliberately: an ending is not a
 * cutscene trigger, it is the conclusion the state has already reached, and it is
 * re-derivable from the same save.
 *
 * The objectives are the six pressures the other systems already exert — money,
 * the house, the law, work, people, standing — so progress cannot be farmed by
 * optimising one axis while ignoring the rest. Every objective is 0..1 and they
 * are weighted, which makes the total a summary rather than a score to beat.
 *
 * Endings are ordered loss-first. A world that is both bankrupt and under warrant
 * ends as the arrest, not the eviction, because that is the one that happens to
 * you first.
 */

export type ObjectiveId = "solvency" | "roof" | "law" | "income" | "connection" | "standing";

export type Objective = {
  id: ObjectiveId;
  label: string;
  detail: string;
  done: boolean;
  /** 0..1 */
  progress: number;
  weight: number;
};

export type GoalRelationship = {
  familiarity: number;
  trust: number;
  friendship: number;
};

export type GoalInput = {
  balance: number;
  houseCondition: number;
  heat: number;
  employed: boolean;
  reputation: number;
  day: number;
  /** Every relationship the player has. */
  relationships: GoalRelationship[];
};

export type EndingId = "stable" | "arrested" | "evicted" | "condemned" | "isolated";

export type Ending = {
  ending: EndingId;
  reason: string;
};

export const EVICTION_BALANCE = -2500;
export const CONDEMNED_CONDITION = 15;
export const ARREST_HEAT = 85;
export const STABLE_DAY = 45;
export const STABLE_PROGRESS = 0.85;
export const ISOLATION_DAY = 30;
export const ISOLATION_FAMILIARITY = 25;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function bestRelationship(relationships: GoalRelationship[]): GoalRelationship {
  let best: GoalRelationship = { familiarity: 0, trust: 0, friendship: 0 };
  for (const rel of relationships) {
    if (rel.familiarity + rel.trust > best.familiarity + best.trust) best = rel;
  }
  return best;
}

export function evaluateObjectives(input: GoalInput): Objective[] {
  const best = bestRelationship(input.relationships);
  const connectionScore = clamp01((best.trust / 50 + best.familiarity / 40) / 2);

  return [
    {
      id: "solvency",
      label: "Stay solvent",
      detail: `Balance $${Math.round(input.balance)}. Eviction at $${EVICTION_BALANCE}.`,
      done: input.balance >= 0,
      progress: clamp01((input.balance - EVICTION_BALANCE) / (0 - EVICTION_BALANCE)),
      weight: 0.22,
    },
    {
      id: "roof",
      label: "Keep the house standing",
      detail: `Condition ${Math.round(input.houseCondition)}/100. Condemned at ${CONDEMNED_CONDITION}.`,
      done: input.houseCondition >= 60,
      progress: clamp01(input.houseCondition / 100),
      weight: 0.18,
    },
    {
      id: "law",
      label: "Stay out of the system",
      detail: `Heat ${Math.round(input.heat)}/100. Warrant at 55, arrest at ${ARREST_HEAT}.`,
      done: input.heat < 20,
      progress: clamp01(1 - input.heat / ARREST_HEAT),
      weight: 0.2,
    },
    {
      id: "income",
      label: "Hold a job",
      detail: input.employed ? "Employed." : "No income but the bills.",
      done: input.employed,
      progress: input.employed ? 1 : 0,
      weight: 0.16,
    },
    {
      id: "connection",
      label: "Keep someone close",
      detail: `Closest tie: familiarity ${Math.round(best.familiarity)}, trust ${Math.round(best.trust)}.`,
      done: best.trust >= 50 && best.familiarity >= 40,
      progress: connectionScore,
      weight: 0.14,
    },
    {
      id: "standing",
      label: "Keep your name",
      detail: `Reputation ${Math.round(input.reputation)}.`,
      done: input.reputation >= 0,
      progress: clamp01((input.reputation + 100) / 100),
      weight: 0.1,
    },
  ];
}

export function overallProgress(objectives: Objective[]): number {
  let weighted = 0;
  let total = 0;
  for (const objective of objectives) {
    weighted += objective.progress * objective.weight;
    total += objective.weight;
  }
  return total === 0 ? 0 : Math.round((weighted / total) * 1000) / 1000;
}

/** Losses first: the thing that happens to you outranks the thing that might. */
export function evaluateEnding(input: GoalInput): Ending | null {
  if (input.heat >= ARREST_HEAT) {
    return { ending: "arrested", reason: `Heat reached ${Math.round(input.heat)}; the warrant was served.` };
  }
  if (input.balance <= EVICTION_BALANCE) {
    return { ending: "evicted", reason: `Balance fell to $${Math.round(input.balance)}.` };
  }
  if (input.houseCondition <= CONDEMNED_CONDITION) {
    return { ending: "condemned", reason: `Condition fell to ${Math.round(input.houseCondition)}/100; the property was condemned.` };
  }
  if (input.day >= ISOLATION_DAY) {
    const best = bestRelationship(input.relationships);
    if (best.familiarity < ISOLATION_FAMILIARITY) {
      return { ending: "isolated", reason: "Nobody left who would notice you were gone." };
    }
  }
  if (input.day >= STABLE_DAY) {
    const progress = overallProgress(evaluateObjectives(input));
    if (progress >= STABLE_PROGRESS) {
      return { ending: "stable", reason: `Day ${input.day}: the house held, the money held, and so did you.` };
    }
  }
  return null;
}

/** Human-readable progress table, used by the demo and any future UI. */
export function describeObjectives(objectives: Objective[]): string[] {
  return objectives.map((objective) => {
    const bar = "█".repeat(Math.round(objective.progress * 10)).padEnd(10, "·");
    return `${objective.done ? "done" : "    "}  ${bar}  ${objective.label} — ${objective.detail}`;
  });
}
