/**
 * Dynamic event engine (Section 14).
 *
 * Events are candidates with a weight, a cooldown, an eligibility predicate and a
 * resolver. They are never scripted missions: each one reads world state, and if
 * the state that would justify it is not there, it cannot fire. Content-gated
 * events are filtered before eligibility is even evaluated, which is how "disabled
 * content never generates" is enforced (Section 2, 18.6).
 */

import type { ContentGate, ContentTag } from "../content/gate.ts";
import type { Rng } from "../core/rng.ts";
import type { Economy } from "./economy.ts";
import type { HouseholdState, IssueKind } from "./household.ts";
import { ISSUE_LIBRARY, activeIssues, conditionScore, randomIssue } from "./household.ts";
import type { MemoryStore } from "./memory.ts";
import type { RelationshipStore } from "./relationship.ts";
import type { Npc, NpcId } from "./types.ts";

export type EventContext = {
  rng: Rng;
  minute: number;
  player: Npc;
  npcs: Map<NpcId, Npc>;
  relationships: RelationshipStore;
  memories: MemoryStore;
  household: HouseholdState;
  economy: Economy;
  gate: ContentGate;
};

export type EventResolution = {
  kind: string;
  summary: string;
  participants: NpcId[];
  gated: boolean;
};

export type CandidateEvent = {
  id: string;
  weight: number;
  cooldownMinutes: number;
  /** If set, the event is invisible to the engine unless the gate permits it. */
  requires?: ContentTag;
  eligible(ctx: EventContext): boolean;
  resolve(ctx: EventContext): EventResolution | null;
};

function others(ctx: EventContext, predicate: (npc: Npc) => boolean): Npc[] {
  const out: Npc[] = [];
  for (const npc of ctx.npcs.values()) {
    if (npc.id === ctx.player.id) continue;
    if (!npc.alive) continue;
    if (predicate(npc)) out.push(npc);
  }
  return out;
}

export function builtinEvents(): CandidateEvent[] {
  return [
    {
      id: "social.unexpectedVisitor",
      weight: 3,
      cooldownMinutes: 600,
      eligible: (ctx) => others(ctx, (n) => ctx.relationships.get(n.id, ctx.player.id).axes.familiarity >= 15).length > 0,
      resolve: (ctx) => {
        const pool = others(ctx, (n) => ctx.relationships.get(n.id, ctx.player.id).axes.familiarity >= 15);
        const guest = ctx.rng.pick(pool);
        ctx.relationships.apply(guest.id, ctx.player.id, { familiarity: 4, friendship: 1 }, ctx.minute);
        ctx.memories.add({
          atMinute: ctx.minute,
          kind: "social",
          summary: `${guest.givenName} ${guest.familyName} arrived unannounced.`,
          participants: [guest.id, ctx.player.id],
          tags: ["visit"],
          salience: 0.3,
          valence: 0.2,
        });
        return {
          kind: "social",
          summary: `${guest.givenName} ${guest.familyName} turned up without calling.`,
          participants: [guest.id, ctx.player.id],
          gated: false,
        };
      },
    },
    {
      id: "household.failure",
      weight: 1.2,
      cooldownMinutes: 1440,
      eligible: (ctx) => conditionScore(ctx.household) < 85 && activeIssues(ctx.household).length < 4,
      resolve: (ctx) => {
        const issue = randomIssue(ctx.household, ctx.rng, ctx.minute);
        if (!issue) return null;
        return {
          kind: "household",
          summary: `${ISSUE_LIBRARY[issue.kind].label} (severity ${issue.severity}, about $${ISSUE_LIBRARY[issue.kind].cost} to fix).`,
          participants: [ctx.player.id],
          gated: false,
        };
      },
    },
    {
      id: "household.neighbourComplaint",
      weight: 1.2,
      cooldownMinutes: 2880,
      eligible: (ctx) => conditionScore(ctx.household) < 65,
      resolve: (ctx) => {
        ctx.player.stress = Math.min(100, ctx.player.stress + 6);
        return {
          kind: "household",
          summary: "A neighbour complained about the state of the property.",
          participants: [ctx.player.id],
          gated: false,
        };
      },
    },
    {
      id: "social.argument",
      weight: 1.6,
      cooldownMinutes: 1440,
      eligible: (ctx) => others(ctx, (n) => ctx.relationships.get(n.id, ctx.player.id).axes.resentment >= 35).length > 0,
      resolve: (ctx) => {
        const pool = others(ctx, (n) => ctx.relationships.get(n.id, ctx.player.id).axes.resentment >= 35);
        const npc = ctx.rng.pick(pool);
        ctx.relationships.apply(npc.id, ctx.player.id, { trust: -4, resentment: 3, satisfaction: -5 }, ctx.minute);
        ctx.memories.add({
          atMinute: ctx.minute,
          kind: "conflict",
          summary: `An argument with ${npc.givenName}.`,
          participants: [npc.id, ctx.player.id],
          tags: ["argument"],
          salience: 0.5,
          valence: -0.5,
        });
        return {
          kind: "social",
          summary: `${npc.givenName} picked a fight about something that had been building for days.`,
          participants: [npc.id, ctx.player.id],
          gated: false,
        };
      },
    },
    {
      id: "social.moneyRequest",
      weight: 0.9,
      cooldownMinutes: 4320,
      eligible: (ctx) => others(ctx, (n) => ctx.relationships.get(n.id, ctx.player.id).axes.friendship >= 45).length > 0,
      resolve: (ctx) => {
        const pool = others(ctx, (n) => ctx.relationships.get(n.id, ctx.player.id).axes.friendship >= 45);
        const npc = ctx.rng.pick(pool);
        const amount = ctx.rng.int(40, 260);
        ctx.relationships.apply(npc.id, ctx.player.id, { familiarity: 2 }, ctx.minute);
        return {
          kind: "social",
          summary: `${npc.givenName} asked to borrow $${amount}.`,
          participants: [npc.id, ctx.player.id],
          gated: false,
        };
      },
    },
    {
      id: "authority.suspiciousIncident",
      weight: 1,
      cooldownMinutes: 2880,
      requires: { kind: "dark" },
      eligible: (ctx) => ctx.player.paranoia >= 25 || ctx.player.guilt >= 25,
      resolve: (ctx) => {
        ctx.player.paranoia = Math.min(100, ctx.player.paranoia + 8);
        ctx.memories.add({
          atMinute: ctx.minute,
          kind: "discovery",
          summary: "A patrol car slowed down outside the house.",
          participants: [ctx.player.id],
          tags: ["authority", "suspicion"],
          salience: 0.6,
          valence: -0.5,
        });
        return {
          kind: "authority",
          summary: "A patrol car slowed down outside and moved on.",
          participants: [ctx.player.id],
          gated: true,
        };
      },
    },
    {
      id: "violence.threat",
      weight: 0.5,
      cooldownMinutes: 5760,
      requires: { kind: "violence", level: "graphic" },
      eligible: (ctx) => others(ctx, (n) => ctx.relationships.get(n.id, ctx.player.id).axes.resentment >= 60).length > 0,
      resolve: (ctx) => {
        const pool = others(ctx, (n) => ctx.relationships.get(n.id, ctx.player.id).axes.resentment >= 60);
        const npc = ctx.rng.pick(pool);
        ctx.player.stress = Math.min(100, ctx.player.stress + 8);
        return {
          kind: "violence",
          summary: `${npc.givenName} made a threat at the door and left.`,
          participants: [npc.id, ctx.player.id],
          gated: true,
        };
      },
    },
    {
      id: "economy.billShock",
      weight: 0.8,
      cooldownMinutes: 7200,
      eligible: (ctx) => ctx.economy.balance > 0,
      resolve: (ctx) => {
        const amount = ctx.rng.int(120, 480);
        ctx.economy.spend(Math.min(amount, ctx.economy.balance), "Unexpected bill", ctx.minute);
        return {
          kind: "economy",
          summary: `An unexpected bill for $${amount} arrived.`,
          participants: [ctx.player.id],
          gated: false,
        };
      },
    },
    {
      id: "social.guestOverstays",
      weight: 1.2,
      cooldownMinutes: 1440,
      eligible: (ctx) => others(ctx, (n) => ctx.relationships.get(n.id, ctx.player.id).axes.familiarity >= 40).length > 0,
      resolve: (ctx) => {
        const pool = others(ctx, (n) => ctx.relationships.get(n.id, ctx.player.id).axes.familiarity >= 40);
        const npc = ctx.rng.pick(pool);
        ctx.relationships.apply(npc.id, ctx.player.id, { familiarity: 3, respect: -2 }, ctx.minute);
        ctx.player.stress = Math.min(100, ctx.player.stress + 4);
        return {
          kind: "social",
          summary: `${npc.givenName} stayed well past when they said they would leave.`,
          participants: [npc.id, ctx.player.id],
          gated: false,
        };
      },
    },
  ];
}

export class EventEngine {
  private cooldowns = new Map<string, number>();
  readonly candidates: CandidateEvent[];
  readonly intervalMinutes: number;
  readonly baseChance: number;

  constructor(candidates: CandidateEvent[], intervalMinutes = 180, baseChance = 0.45) {
    this.candidates = candidates;
    this.intervalMinutes = intervalMinutes;
    this.baseChance = baseChance;
  }

  /** Called every simulated minute; internally rate-limits itself. */
  tick(ctx: EventContext): EventResolution | null {
    if (ctx.minute % this.intervalMinutes !== 0) return null;
    if (!ctx.rng.chance(this.baseChance)) return null;

    const eligible = this.candidates.filter((candidate) => {
      if (candidate.requires && !ctx.gate.allows(candidate.requires)) return false;
      const until = this.cooldowns.get(candidate.id) ?? 0;
      if (ctx.minute < until) return false;
      return candidate.eligible(ctx);
    });

    if (eligible.length === 0) return null;

    const chosen = ctx.rng.weighted(eligible.map((candidate) => ({ item: candidate, weight: candidate.weight })));
    const resolution = chosen.resolve(ctx);
    if (!resolution) return null;
    this.cooldowns.set(chosen.id, ctx.minute + chosen.cooldownMinutes);
    return resolution;
  }

  setCooldown(id: string, untilMinute: number): void {
    this.cooldowns.set(id, untilMinute);
  }

  cooldownEntries(): [string, number][] {
    return [...this.cooldowns.entries()];
  }

  restoreCooldowns(entries: [string, number][]): void {
    this.cooldowns = new Map(entries);
  }
}

export function issueLabel(kind: IssueKind): string {
  return ISSUE_LIBRARY[kind].label;
}
