/**
 * Leverage, compliance and accomplices.
 *
 * The design constraint that makes this a system rather than a dialogue option:
 * nobody is recruited by asking. Every character has a set of things that move
 * them — affection, fear, debt, dependency, a secret, or the mutual risk of
 * already being involved — and the strength of those things is derived from state
 * the world already has (relationship axes, personality, cash, disclosure). You
 * press on one of them, and the result is a compliance number, not a yes.
 *
 * Police are the interesting case. They are not a special "bribe" button: an
 * officer has the same leverage axes as anyone else, plus far more resistance,
 * and what they can do afterwards is different because of what they *are* — cover
 * a scene, suppress a report, or deliver someone to the door without a record.
 *
 * Everything here is deterministic given the rng stream. Secrets are hashed from
 * the character id rather than rolled, so a character's secret does not change
 * because you did something unrelated earlier in the day.
 */

import type { ContentGate } from "../content/gate.ts";
import type { Rng } from "../core/rng.ts";
import { hashString } from "../core/rng.ts";
import type { RelationshipStore } from "./relationship.ts";
import type { LogInput, Npc, NpcId } from "./types.ts";

export type LeverageKind = "secret" | "debt" | "fear" | "affection" | "dependency" | "complicity";

export type Approach = "charm" | "threat" | "favour" | "blackmail" | "burden";

export type RecruitRole = "courier" | "lookout" | "cleaner" | "alibi" | "supplier" | "talent" | "badge";

export type AccompliceStatus = "loyal" | "wavering" | "turned" | "gone";

export type Leverage = {
  kind: LeverageKind;
  /** 0..100. */
  strength: number;
  detail: string;
};

export type Assessment = {
  npcId: NpcId;
  leverage: Leverage[];
  /** 0..100. How much they resist regardless of what you offer. */
  resistance: number;
  best: Approach | null;
  /** True when any axis is strong enough to be worth pressing. */
  worthPressing: boolean;
  police: boolean;
};

export type PressOutcome = {
  npcId: NpcId;
  approach: Approach;
  kind: LeverageKind;
  /** 0..1. Remembered for the next recruit attempt. */
  compliance: number;
  refused: boolean;
  backfired: boolean;
  suspicion: number;
  summary: string;
};

export type Accomplice = {
  npcId: NpcId;
  role: RecruitRole;
  loyalty: number;
  suspicion: number;
  tasks: number;
  joinedMinute: number;
  status: AccompliceStatus;
};

export type AccompliceOrder = "coverTracks" | "clean" | "alibi" | "deliverVictim" | "silence" | "supplies";

export type OrderResult = {
  ok: boolean;
  order: AccompliceOrder;
  summary: string;
  heatDelta: number;
  /** 0..1 reduction applied to an existing witness's confidence. */
  witnessDamping: number;
  delivered: NpcId | null;
};

export type ManipulationState = {
  accomplices: Accomplice[];
  /** npcId -> last compliance achieved by pressing them. */
  pressure: [NpcId, number][];
  turned: NpcId[];
};

export type ManipulationDeps = {
  gate: ContentGate;
  relationships: RelationshipStore;
  npcs: Map<NpcId, Npc>;
  rng: Rng;
  now: () => number;
  log: (entry: LogInput) => void;
  playerId: NpcId;
};

const APPROACH_KIND: Record<Approach, LeverageKind> = {
  charm: "affection",
  threat: "fear",
  favour: "dependency",
  blackmail: "secret",
  burden: "debt",
};

// Police resistance sits around 60-80 and the strongest lever is worth roughly
// 55, so a 75% threshold was unreachable no matter how long you worked on them.
// 65% keeps them the hardest recruit in the game and makes the branch playable.
const ROLE_THRESHOLD: Record<RecruitRole, number> = {
  courier: 0.45,
  lookout: 0.45,
  alibi: 0.5,
  supplier: 0.55,
  cleaner: 0.58,
  talent: 0.62,
  badge: 0.65,
};

const ROLE_ORDERS: Record<RecruitRole, AccompliceOrder[]> = {
  courier: ["supplies"],
  lookout: ["alibi"],
  alibi: ["alibi"],
  supplier: ["supplies"],
  cleaner: ["clean"],
  talent: ["deliverVictim"],
  badge: ["coverTracks", "silence", "deliverVictim"],
};

export const ROLE_LABELS: Record<RecruitRole, string> = {
  courier: "courier",
  lookout: "lookout",
  alibi: "alibi",
  supplier: "supplier",
  cleaner: "cleaner",
  talent: "recruiter",
  badge: "police contact",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isPolice(npc: Npc): boolean {
  const occupation = npc.occupation.toLowerCase();
  return occupation.includes("police") || occupation.includes("officer") || occupation.includes("security");
}

/** A secret that would survive being said out loud. Hashed, not rolled. */
function secretStrength(npc: Npc): number {
  const hash = hashString(`${npc.id}|secret`);
  if (hash % 5 === 0) return 0;
  const exposure = 30 + (hash % 45);
  const authority = isPolice(npc) ? 15 : 0;
  return clamp(exposure + authority, 0, 100);
}

export class Manipulation {
  private readonly deps: ManipulationDeps;
  private accomplices: Accomplice[] = [];
  private pressure = new Map<NpcId, number>();
  private turned: NpcId[] = [];

  constructor(deps: ManipulationDeps) {
    this.deps = deps;
  }

  private npc(npcId: NpcId): Npc {
    const npc = this.deps.npcs.get(npcId);
    if (!npc) throw new Error(`unknown character ${npcId}`);
    return npc;
  }

  accomplicesList(): Accomplice[] {
    return this.accomplices.map((entry) => ({ ...entry }));
  }

  accompliceFor(npcId: NpcId): Accomplice | undefined {
    return this.accomplices.find((entry) => entry.npcId === npcId);
  }

  /** Everyone currently working for the player in a given role. */
  inRole(role: RecruitRole): Accomplice[] {
    return this.accomplices.filter((entry) => entry.role === role && entry.status !== "turned" && entry.status !== "gone");
  }

  leverageFor(npc: Npc): Leverage[] {
    const rel = this.deps.relationships.get(this.deps.playerId, npc.id);
    const existing = this.accompliceFor(npc.id);
    const secret = secretStrength(npc);

    const vectors: Leverage[] = [
      {
        kind: "affection",
        strength: clamp(rel.axes.attachment * 0.6 + rel.axes.friendship * 0.4, 0, 100),
        detail: `attachment ${Math.round(rel.axes.attachment)}, friendship ${Math.round(rel.axes.friendship)}`,
      },
      {
        kind: "fear",
        strength: clamp(npc.personality.neuroticism * 55 + npc.stress * 0.25, 0, 100),
        detail: `neuroticism ${npc.personality.neuroticism.toFixed(2)}, stress ${Math.round(npc.stress)}`,
      },
      {
        kind: "debt",
        strength: npc.cash < 500 ? clamp(35 + (500 - npc.cash) / 8, 0, 100) : 0,
        detail: npc.cash < 500 ? `$${Math.round(npc.cash)} to their name` : "solvent",
      },
      {
        kind: "dependency",
        strength: clamp(rel.axes.attachment * 0.5 + (npc.cash < 250 ? 25 : 0), 0, 100),
        detail: `depends on the player for ${npc.cash < 250 ? "money and" : ""} company`,
      },
      {
        kind: "secret",
        strength: secret,
        detail: secret > 0 ? "something they would not want repeated" : "nothing to hold over them",
      },
      {
        kind: "complicity",
        strength: existing ? clamp(40 + existing.tasks * 6, 0, 100) : 0,
        detail: existing ? `${existing.tasks} task(s) already done` : "not involved yet",
      },
    ];

    return vectors
      .filter((vector) => vector.strength > 0)
      .sort((a, b) => b.strength - a.strength || compareStrings(a.kind, b.kind));
  }

  resistanceFor(npc: Npc): number {
    const rel = this.deps.relationships.get(this.deps.playerId, npc.id);
    const base =
      28 +
      npc.personality.conscientiousness * 30 +
      npc.paranoia * 0.35 +
      (isPolice(npc) ? 22 : 0) -
      rel.axes.familiarity * 0.12 -
      rel.axes.trust * 0.08;
    return clamp(base, 5, 95);
  }

  assess(npcId: NpcId): Assessment {
    const npc = this.npc(npcId);
    const leverage = this.leverageFor(npc);
    const best = leverage[0] ? approachFor(leverage[0].kind) : null;
    return {
      npcId,
      leverage,
      resistance: this.resistanceFor(npc),
      best,
      worthPressing: (leverage[0]?.strength ?? 0) > this.resistanceFor(npc) * 0.45,
      police: isPolice(npc),
    };
  }

  /**
   * Press one axis. Returns compliance, not consent-to-a-role: recruiting is a
   * second, separate decision with a threshold, so a single good roll cannot hand
   * you a police officer.
   */
  press(npcId: NpcId, approach: Approach): PressOutcome {
    const npc = this.npc(npcId);
    const kind = APPROACH_KIND[approach];
    const vector = this.leverageFor(npc).find((entry) => entry.kind === kind);
    const strength = vector?.strength ?? 0;
    const resistance = this.resistanceFor(npc);
    const fit = personalityFit(npc, approach);
    const noise = this.deps.rng.int(-8, 8);
    const score = strength + fit * 25 - resistance + noise;
    // Pressure compounds: the same person worn down over several conversations
    // gives more than the first one did. That is the difference between a
    // persuasion system and a single dice roll with a nice label.
    const prior = this.pressure.get(npcId) ?? 0;
    // A police officer resists at around 75 and a strong lever is worth about 55,
    // so the unscaled roll plateaus near 0.4 and the branch is unreachable. The
    // curve below converges toward 1 for anyone you keep working on, which is the
    // intended shape: expensive, not impossible.
    const compliance = clamp01(0.4 + score / 90 + prior * 0.45);

    const refused = compliance < 0.35;
    const backfired = compliance < 0.2 && this.deps.rng.chance(0.55);
    const suspicion = backfired ? 20 : refused ? 7 : approach === "threat" || approach === "blackmail" ? 8 : 2;

    this.pressure.set(npcId, compliance);
    this.deps.relationships.apply(
      this.deps.playerId,
      npcId,
      approach === "charm" || approach === "favour"
        ? { trust: 2, friendship: 2 }
        : { trust: -6, resentment: 8 },
      this.deps.now(),
    );

    const summary = backfired
      ? `${npc.givenName} did not take it well. They are telling someone.`
      : refused
        ? `${npc.givenName} refused. ${vector ? vector.detail : "Nothing to press."}`
        : `${npc.givenName} is listening. Compliance ${Math.round(compliance * 100)}%.`;

    this.deps.log({
      kind: "manipulation",
      summary,
      participants: [this.deps.playerId, npcId],
      gated: true,
    });

    return { npcId, approach, kind, compliance, refused, backfired, suspicion, summary };
  }

  recruit(npcId: NpcId, role: RecruitRole): { ok: boolean; reason: string } {
    const npc = this.npc(npcId);
    if (this.accompliceFor(npcId)) return { ok: false, reason: "already involved" };

    if (role === "badge" && !isPolice(npc)) {
      return { ok: false, reason: "that is not a police officer" };
    }
    if ((role === "badge" || role === "talent" || role === "cleaner") && !this.deps.gate.allows({ kind: "dark" })) {
      return { ok: false, reason: "this role requires dark themes to be enabled" };
    }

    const compliance = this.pressure.get(npcId) ?? 0;
    const threshold = ROLE_THRESHOLD[role];
    if (compliance < threshold) {
      return {
        ok: false,
        reason: `compliance ${Math.round(compliance * 100)}% is below the ${Math.round(threshold * 100)}% this needs`,
      };
    }

    const accomplice: Accomplice = {
      npcId,
      role,
      loyalty: clamp(35 + compliance * 45, 0, 100),
      suspicion: 8,
      tasks: 0,
      joinedMinute: this.deps.now(),
      status: "loyal",
    };
    this.accomplices.push(accomplice);
    this.pressure.delete(npcId);

    this.deps.log({
      kind: "manipulation",
      summary: `${npc.givenName} ${npc.familyName} is now a ${ROLE_LABELS[role]}.`,
      participants: [this.deps.playerId, npcId],
      gated: true,
    });

    return { ok: true, reason: `${ROLE_LABELS[role]} recruited` };
  }

  /**
   * Give an accomplice an order. What they can do is decided by the role, not by
   * how much they like you; loyalty decides whether they do it now.
   */
  order(npcId: NpcId, order: AccompliceOrder): OrderResult {
    const accomplice = this.accompliceFor(npcId);
    const refused = (summary: string): OrderResult => ({
      ok: false,
      order,
      summary,
      heatDelta: 0,
      witnessDamping: 0,
      delivered: null,
    });

    if (!accomplice) return refused("nobody by that name is involved");
    if (accomplice.status === "turned") return refused(`${this.npc(npcId).givenName} has already gone to the police`);
    if (!ROLE_ORDERS[accomplice.role].includes(order)) {
      return refused(`a ${ROLE_LABELS[accomplice.role]} cannot do that`);
    }
    if (accomplice.loyalty < 25) {
      accomplice.suspicion = clamp(accomplice.suspicion + 10, 0, 100);
      return refused(`${this.npc(npcId).givenName} is too frightened to be useful right now`);
    }

    const ratio = accomplice.loyalty / 100;
    let heatDelta = 0;
    let witnessDamping = 0;
    let delivered: NpcId | null = null;
    let summary = "";

    switch (order) {
      case "coverTracks": {
        heatDelta = -(6 + Math.round(6 * ratio));
        summary = "The scene is logged as an unrelated disturbance. Nothing points at the house.";
        break;
      }
      case "silence": {
        witnessDamping = 0.45 + ratio * 0.35;
        summary = "A statement is quietly amended. The witness is less sure than they were.";
        break;
      }
      case "clean": {
        heatDelta = -(3 + Math.round(4 * ratio));
        summary = "The room is cleaned to a standard that would survive a casual look.";
        break;
      }
      case "alibi": {
        witnessDamping = 0.3 + ratio * 0.3;
        heatDelta = -2;
        summary = "Somebody credible says the player was somewhere else.";
        break;
      }
      case "supplies": {
        summary = "Supplies arrive without a receipt and without a name on the order.";
        break;
      }
      case "deliverVictim": {
        delivered = this.pickVictim(npcId);
        if (!delivered) return refused("nobody suitable could be moved without being noticed");
        summary = `${this.npc(delivered).givenName} ${this.npc(delivered).familyName} was brought to the door.`;
        break;
      }
      default:
        return refused("unknown order");
    }

    accomplice.tasks += 1;
    accomplice.loyalty = clamp(accomplice.loyalty - 3, 0, 100);
    accomplice.suspicion = clamp(accomplice.suspicion + 6 + (1 - ratio) * 10, 0, 100);

    this.deps.log({
      kind: "manipulation",
      summary,
      participants: [this.deps.playerId, npcId, ...(delivered ? [delivered] : [])],
      gated: true,
    });

    return { ok: true, order, summary, heatDelta, witnessDamping, delivered };
  }

  /** Someone with no one checking on them, and no relationship worth preserving. */
  private pickVictim(accompliceId: NpcId): NpcId | null {
    const candidates = [...this.deps.npcs.values()]
      .filter((npc) => {
        if (!npc.alive || npc.id === this.deps.playerId) return false;
        if (npc.homeLocation !== "elsewhere") return false;
        if (this.deps.relationships.get(this.deps.playerId, npc.id).family) return false;
        if (this.accompliceFor(npc.id)) return false;
        if (isPolice(npc)) return false;
        return true;
      })
      .map((npc) => ({
        npc,
        familiarity: this.deps.relationships.get(this.deps.playerId, npc.id).axes.familiarity + hashString(`${accompliceId}|${npc.id}`) % 7,
      }))
      .sort((a, b) => a.familiarity - b.familiarity || compareStrings(a.npc.id, b.npc.id));

    if (candidates.length === 0) return null;
    const pool = candidates.slice(0, Math.min(12, candidates.length));
    return this.deps.rng.pick(pool).npc.id;
  }

  /** Once per day: loyalty decays, suspicion grows with heat, and people flip. */
  daily(heat: number): void {
    for (const accomplice of this.accomplices) {
      if (accomplice.status === "gone") continue;

      accomplice.suspicion = clamp(
        accomplice.suspicion + 1 + heat * 0.06 + (100 - accomplice.loyalty) * 0.03,
        0,
        100,
      );
      accomplice.loyalty = clamp(accomplice.loyalty - 0.5, 0, 100);

      const before = accomplice.status;
      if (accomplice.suspicion >= 85) accomplice.status = "turned";
      else if (accomplice.loyalty <= 15) accomplice.status = "wavering";
      else accomplice.status = "loyal";

      if (accomplice.status !== before) {
        const npc = this.deps.npcs.get(accomplice.npcId);
        this.deps.log({
          kind: "manipulation",
          summary:
            accomplice.status === "turned"
              ? `${npc?.givenName ?? accomplice.npcId} has gone to the police.`
              : `${npc?.givenName ?? accomplice.npcId} is getting cold feet.`,
          participants: [accomplice.npcId],
          gated: true,
        });
        if (accomplice.status === "turned" && !this.turned.includes(accomplice.npcId)) {
          this.turned.push(accomplice.npcId);
        }
      }
    }
  }

  /** Betrayals are reported once, then the accomplice is gone from the network. */
  takeBetrayals(): NpcId[] {
    const reports = this.turned.slice();
    this.turned.length = 0;
    for (const npcId of reports) {
      const accomplice = this.accompliceFor(npcId);
      if (accomplice) {
        accomplice.status = "gone";
        accomplice.loyalty = 0;
      }
    }
    return reports;
  }

  snapshot(): ManipulationState {
    return {
      accomplices: this.accomplices.map((entry) => ({ ...entry })),
      pressure: [...this.pressure.entries()],
      turned: this.turned.slice(),
    };
  }

  restore(state: ManipulationState): void {
    this.accomplices = state.accomplices.map((entry) => ({ ...entry }));
    this.pressure = new Map(state.pressure);
    this.turned = state.turned.slice();
  }
}

function approachFor(kind: LeverageKind): Approach {
  switch (kind) {
    case "affection":
      return "charm";
    case "fear":
      return "threat";
    case "dependency":
      return "favour";
    case "secret":
      return "blackmail";
    case "debt":
      return "burden";
    case "complicity":
      return "burden";
  }
}

function personalityFit(npc: Npc, approach: Approach): number {
  switch (approach) {
    case "charm":
      return npc.personality.agreeableness * 0.6 + npc.personality.extraversion * 0.4;
    case "threat":
      return npc.personality.neuroticism * 0.7 + (1 - npc.personality.conscientiousness) * 0.3;
    case "favour":
      return npc.personality.agreeableness * 0.4 + (1 - npc.personality.openness) * 0.2;
    case "blackmail":
      return npc.personality.conscientiousness * 0.5 + npc.paranoia / 200;
    case "burden":
      return clamp01(npc.personality.neuroticism * 0.5 + (1 - npc.personality.agreeableness) * 0.3);
  }
}
