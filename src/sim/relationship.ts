/**
 * The relationship model (Section 5).
 *
 * Ten independent axes rather than one "affinity" number, because the design
 * needs respect and resentment to move in opposite directions at the same time,
 * and jealousy to persist after a breakup. Everything is stored in a single
 * canonical store keyed on the ordered id pair, so A→B and B→A cannot diverge —
 * opinions are mutual relationships here, not per-viewer records. If we later
 * need asymmetric memory (A forgave, B did not), that belongs in the memory
 * store, not in duplicated axes.
 */

import type { NpcId } from "./types.ts";
import { HardBlockError } from "../content/gate.ts";

export const REL_AXES = [
  "attraction",
  "friendship",
  "trust",
  "romanticInterest",
  "jealousy",
  "respect",
  "resentment",
  "familiarity",
  "attachment",
  "satisfaction",
] as const;

export type RelAxis = (typeof REL_AXES)[number];
export type RelationshipAxes = Record<RelAxis, number>;

export type Relationship = {
  a: NpcId;
  b: NpcId;
  axes: RelationshipAxes;
  /** Family bonds are permanently non-romantic and non-sexual (18.4). */
  family: boolean;
  romantic: boolean;
  kinkDisclosed: boolean;
  interactions: number;
  lastInteractionMinute: number;
};

export type RelationshipDelta = Partial<RelationshipAxes>;

const AXIS_FLOOR = -100;
const AXIS_CEILING = 100;

export function defaultAxes(): RelationshipAxes {
  return {
    attraction: 0,
    friendship: 0,
    trust: 0,
    romanticInterest: 0,
    jealousy: 0,
    respect: 0,
    resentment: 0,
    familiarity: 0,
    attachment: 0,
    satisfaction: 0,
  };
}

function clamp(value: number): number {
  return Math.max(AXIS_FLOOR, Math.min(AXIS_CEILING, value));
}

export class RelationshipStore {
  private map = new Map<string, Relationship>();

  constructor(entries: Relationship[] = []) {
    for (const entry of entries) this.map.set(keyFor(entry.a, entry.b), entry);
  }

  keyFor(a: NpcId, b: NpcId): string {
    return keyFor(a, b);
  }

  /** Get or lazily create. Never returns undefined: every pair has a relationship. */
  get(a: NpcId, b: NpcId): Relationship {
    const key = keyFor(a, b);
    let rel = this.map.get(key);
    if (!rel) {
      rel = {
        a: a < b ? a : b,
        b: a < b ? b : a,
        axes: defaultAxes(),
        family: false,
        romantic: false,
        kinkDisclosed: false,
        interactions: 0,
        lastInteractionMinute: 0,
      };
      this.map.set(key, rel);
    }
    return rel;
  }

  peek(a: NpcId, b: NpcId): Relationship | undefined {
    return this.map.get(keyFor(a, b));
  }

  all(): Relationship[] {
    return [...this.map.values()];
  }

  markFamily(a: NpcId, b: NpcId): Relationship {
    const rel = this.get(a, b);
    rel.family = true;
    rel.romantic = false;
    rel.axes.romanticInterest = 0;
    rel.axes.attraction = 0;
    return rel;
  }

  /**
   * Apply a delta. Family pairs cannot gain romantic or sexual axes — this
   * throws rather than silently clamping, so a bug surfaces as a failing test
   * instead of a quietly wrong world.
   */
  apply(a: NpcId, b: NpcId, delta: RelationshipDelta, atMinute = 0): Relationship {
    const rel = this.get(a, b);
    if (rel.family && ((delta.romanticInterest ?? 0) > 0 || (delta.attraction ?? 0) > 0)) {
      throw new HardBlockError(`cannot apply romantic/sexual delta to family pair ${a} <-> ${b} (18.4)`);
    }
    for (const axis of REL_AXES) {
      const change = delta[axis];
      if (change === undefined) continue;
      rel.axes[axis] = clamp(rel.axes[axis] + change);
    }
    rel.interactions += 1;
    rel.lastInteractionMinute = atMinute;
    if (rel.axes.romanticInterest >= 25) rel.romantic = true;
    if (rel.axes.romanticInterest <= 0 && rel.axes.attachment <= 5) rel.romantic = false;
    return rel;
  }

  /**
   * Daily drift. Relationships left alone cool off; resentment and jealousy fade
   * much more slowly than attraction, which is what makes old damage cost
   * something. Returns the pairs that changed materially.
   */
  decayDaily(currentMinute: number): void {
    for (const rel of this.map.values()) {
      const daysQuiet = (currentMinute - rel.lastInteractionMinute) / 1440;
      const neglect = Math.min(1, daysQuiet / 4);
      rel.axes.attraction = clamp(rel.axes.attraction - 0.4 * neglect);
      rel.axes.romanticInterest = clamp(rel.axes.romanticInterest - 0.3 * neglect);
      rel.axes.satisfaction = clamp(rel.axes.satisfaction - 0.2 * neglect);
      rel.axes.familiarity = clamp(rel.axes.familiarity - 0.1 * neglect);
      rel.axes.jealousy = clamp(rel.axes.jealousy * 0.97);
      rel.axes.resentment = clamp(rel.axes.resentment * 0.995);
      rel.axes.trust = clamp(rel.axes.trust * 0.999);
      if (rel.axes.romanticInterest < 25) rel.romantic = false;
    }
  }

  /** Cheap summary used by the demo and by dialogue selection later. */
  summary(a: NpcId, b: NpcId): string {
    const rel = this.get(a, b);
    const parts = REL_AXES.filter((axis) => Math.abs(rel.axes[axis]) >= 10).map(
      (axis) => `${axis} ${rel.axes[axis] >= 0 ? "+" : ""}${rel.axes[axis].toFixed(0)}`,
    );
    const flags = [rel.family ? "family" : null, rel.romantic ? "romantic" : null].filter(Boolean).join(", ");
    return `${parts.length === 0 ? "neutral" : parts.join(" ")}${flags ? ` [${flags}]` : ""}`;
  }
}

export function keyFor(a: NpcId, b: NpcId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
