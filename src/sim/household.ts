/**
 * Household state and maintenance (Section 11).
 *
 * Issues are objects with severity, cost and a lifespan. They are raised by a
 * daily roll weighted by the house's condition, and they feed the event engine
 * (a late contractor, a guest who notices the leak). Fixing one is a real spend,
 * which is where household condition meets the economy.
 */

import type { Rng } from "../core/rng.ts";

export type IssueKind =
  | "cloggedToilet"
  | "brokenAC"
  | "heatingFailure"
  | "plumbingLeak"
  | "fridgeFailure"
  | "dishwasher"
  | "electrical"
  | "washingMachine"
  | "internetOutage"
  | "roofLeak"
  | "pests";

export type IssueProfile = {
  label: string;
  severity: 1 | 2 | 3;
  cost: number;
  weight: number;
  /** Minutes of professional work required once scheduled. */
  workMinutes: number;
};

export const ISSUE_LIBRARY: Record<IssueKind, IssueProfile> = {
  cloggedToilet: { label: "Clogged toilet", severity: 1, cost: 120, weight: 3, workMinutes: 60 },
  brokenAC: { label: "Broken air conditioning", severity: 2, cost: 380, weight: 2, workMinutes: 120 },
  heatingFailure: { label: "Heating failure", severity: 3, cost: 640, weight: 1.4, workMinutes: 180 },
  plumbingLeak: { label: "Plumbing leak", severity: 3, cost: 720, weight: 1.6, workMinutes: 240 },
  fridgeFailure: { label: "Refrigerator failure", severity: 2, cost: 520, weight: 1.5, workMinutes: 90 },
  dishwasher: { label: "Dishwasher malfunction", severity: 1, cost: 210, weight: 2, workMinutes: 60 },
  electrical: { label: "Electrical fault", severity: 3, cost: 690, weight: 1.2, workMinutes: 180 },
  washingMachine: { label: "Washing machine breakdown", severity: 1, cost: 260, weight: 1.8, workMinutes: 75 },
  internetOutage: { label: "Internet outage", severity: 1, cost: 90, weight: 2.4, workMinutes: 45 },
  roofLeak: { label: "Roof leak", severity: 3, cost: 980, weight: 0.8, workMinutes: 300 },
  pests: { label: "Pest infestation", severity: 2, cost: 340, weight: 1.1, workMinutes: 120 },
};

export type HouseholdIssue = {
  id: string;
  kind: IssueKind;
  severity: number;
  openedAtMinute: number;
  fixed: boolean;
  contractorDueMinute: number | null;
  resolvedWith: "self" | "professional" | null;
};

export type HouseholdState = {
  issues: HouseholdIssue[];
  counter: number;
};

export function createHouseholdState(): HouseholdState {
  return { issues: [], counter: 0 };
}

export function activeIssues(state: HouseholdState): HouseholdIssue[] {
  return state.issues.filter((issue) => !issue.fixed);
}

export function conditionScore(state: HouseholdState): number {
  const damage = activeIssues(state).reduce((sum, issue) => sum + issue.severity * 4, 0);
  return Math.max(0, Math.min(100, 100 - damage));
}

export function raiseIssue(state: HouseholdState, kind: IssueKind, minute: number): HouseholdIssue {
  state.counter += 1;
  const profile = ISSUE_LIBRARY[kind];
  const issue: HouseholdIssue = {
    id: `issue-${state.counter}`,
    kind,
    severity: profile.severity,
    openedAtMinute: minute,
    fixed: false,
    contractorDueMinute: null,
    resolvedWith: null,
  };
  state.issues.push(issue);
  return issue;
}

/** Weighted pick among problems that are not already active. */
export function randomIssue(state: HouseholdState, rng: Rng, minute: number): HouseholdIssue | null {
  const open = new Set(activeIssues(state).map((issue) => issue.kind));
  const options = (Object.keys(ISSUE_LIBRARY) as IssueKind[])
    .filter((kind) => !open.has(kind))
    .map((kind) => ({ item: kind, weight: ISSUE_LIBRARY[kind].weight }));
  if (options.length === 0) return null;
  return raiseIssue(state, rng.weighted(options), minute);
}

/** Once per game day. A neglected house fails more often, not catastrophically faster. */
export function dailyHouseholdTick(state: HouseholdState, rng: Rng, minute: number): HouseholdIssue | null {
  const condition = conditionScore(state);
  const chance = 0.09 + (100 - condition) / 1200;
  if (!rng.chance(chance)) return null;
  return randomIssue(state, rng, minute);
}

export function scheduleContractor(state: HouseholdState, issueId: string, minute: number, rng: Rng): number | null {
  const issue = state.issues.find((entry) => entry.id === issueId);
  if (!issue || issue.fixed) return null;
  const profile = ISSUE_LIBRARY[issue.kind];
  // Contractors keep realistic schedules (Section 11): they are not instant.
  const lead = rng.int(90, 480);
  issue.contractorDueMinute = minute + lead;
  return issue.contractorDueMinute + profile.workMinutes;
}

export function completeContractorWork(state: HouseholdState, minute: number): HouseholdIssue[] {
  const finished: HouseholdIssue[] = [];
  for (const issue of state.issues) {
    if (issue.fixed || issue.contractorDueMinute === null) continue;
    const profile = ISSUE_LIBRARY[issue.kind];
    if (minute >= issue.contractorDueMinute + profile.workMinutes) {
      issue.fixed = true;
      issue.resolvedWith = "professional";
      finished.push(issue);
    }
  }
  return finished;
}

/** The player fixes it themselves: cheaper, costs time and competence. */
export function resolveIssue(state: HouseholdState, issueId: string, method: "self" | "professional"): boolean {
  const issue = state.issues.find((entry) => entry.id === issueId);
  if (!issue || issue.fixed) return false;
  issue.fixed = true;
  issue.resolvedWith = method;
  return true;
}
