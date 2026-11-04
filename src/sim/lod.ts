/**
 * Hierarchical NPC simulation (Section 4 and requirement 18.16).
 *
 * Three tiers, all driven by the same schedule and need functions:
 *
 *   full        on the property: one-minute resolution
 *   coarse      nearby or expected: fifteen-minute resolution
 *   statistical off in the city: half-day resolution, aggregate only
 *
 * The point is that no NPC is ever "spawned on demand" (Section 4). An off-screen
 * character keeps accumulating need decay, schedule progression and mood drift at
 * a cheaper rate, so when they arrive their state reflects the time that passed.
 */

import type { Npc } from "./types.ts";
import type { NpcId } from "./types.ts";

export type SimTier = "full" | "coarse" | "statistical";

export const TIER_INTERVAL_MINUTES: Record<SimTier, number> = {
  full: 1,
  coarse: 15,
  statistical: 720,
};

export type TierBudget = {
  full: number;
  coarse: number;
};

export type TierInput = {
  npcs: Npc[];
  budget: TierBudget;
  isOnProperty: (npc: Npc) => boolean;
  isExpected: (npc: Npc) => boolean;
};

export type TierAssignment = Map<NpcId, SimTier>;

/**
 * Assign tiers under a hard budget.
 *
 * On-property characters take full slots first. Anyone who misses a slot —
 * including on-property characters when the full budget is smaller than the
 * resident population — degrades down the tiers instead of making the tick more
 * expensive. The budget is therefore a real cap, not a hint; if a house can hold
 * more residents than the full budget, that budget is wrong, not the tiering.
 */
export function assignTiers(input: TierInput): TierAssignment {
  const { npcs, budget, isOnProperty, isExpected } = input;
  const assignment: TierAssignment = new Map();

  const onProperty: Npc[] = [];
  const expected: Npc[] = [];
  const rest: Npc[] = [];

  for (const npc of npcs) {
    if (!npc.alive) {
      assignment.set(npc.id, "statistical");
      continue;
    }
    if (isOnProperty(npc)) onProperty.push(npc);
    else if (isExpected(npc)) expected.push(npc);
    else rest.push(npc);
  }

  const fullPool = onProperty.slice(0, Math.max(0, budget.full));
  for (const npc of fullPool) assignment.set(npc.id, "full");

  // Leftover residents compete with expected visitors for the coarse slots.
  const coarseCandidates = [...onProperty.slice(fullPool.length), ...expected];
  const coarsePool = coarseCandidates.slice(0, Math.max(0, budget.coarse));
  for (const npc of coarsePool) assignment.set(npc.id, "coarse");
  for (const npc of coarseCandidates.slice(coarsePool.length)) assignment.set(npc.id, "statistical");

  for (const npc of rest) assignment.set(npc.id, "statistical");

  return assignment;
}

export function isDue(tier: SimTier, lastMinute: number, nowMinute: number): boolean {
  return nowMinute - lastMinute >= TIER_INTERVAL_MINUTES[tier];
}

export function countTiers(assignment: TierAssignment): Record<SimTier, number> {
  const counts: Record<SimTier, number> = { full: 0, coarse: 0, statistical: 0 };
  for (const tier of assignment.values()) counts[tier] += 1;
  return counts;
}
