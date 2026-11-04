/**
 * Save format (Section 18.13: the game saves and restores the complete simulated
 * world).
 *
 * Serialization is canonical: keys are sorted so the same world always produces
 * byte-identical JSON. That gives us world hashing for free, which is how the
 * determinism and save/restore tests are written — and it is also the mechanism a
 * future replication or replay layer can build on.
 */

import { hashString } from "../core/rng.ts";
import type { RngState } from "../core/rng.ts";
import type { ContentSettings } from "../content/gate.ts";
import type { SceneSnapshot } from "../sim/consent.ts";
import type { EconomySnapshot } from "../sim/economy.ts";
import type { EmploymentState } from "../sim/jobs.ts";
import type { NetState } from "../sim/net.ts";
import type { PhoneState } from "../sim/phone.ts";
import type { HouseholdState } from "../sim/household.ts";
import type { InvestigationState } from "../sim/investigation.ts";
import type { SimTier } from "../sim/lod.ts";
import type { Relationship } from "../sim/relationship.ts";
import type { GameEventLogEntry, Memory, Npc, NpcId } from "../sim/types.ts";

export const SNAPSHOT_VERSION = 3;

export type WorldSnapshot = {
  version: number;
  seed: number;
  rng: RngState;
  clockMinutes: number;
  settings: ContentSettings;
  playerId: NpcId;
  npcs: Npc[];
  relationships: Relationship[];
  memories: Memory[];
  memoryCounter: number;
  economy: EconomySnapshot;
  employment: EmploymentState;
  phone: PhoneState;
  net: NetState;
  household: HouseholdState;
  investigation: InvestigationState;
  cooldowns: [string, number][];
  log: GameEventLogEntry[];
  logCounter: number;
  tiers: [NpcId, SimTier][];
  tierRefreshedAt: number;
  reputation: number;
  scene: SceneSnapshot | null;
};

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortValue(source[key]);
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function serializeWorld(snapshot: WorldSnapshot): string {
  return stableStringify(snapshot);
}

export function deserializeWorld(text: string): WorldSnapshot {
  const parsed = JSON.parse(text) as WorldSnapshot;
  if (parsed.version !== SNAPSHOT_VERSION) {
    throw new Error(`unsupported save version ${parsed.version} (expected ${SNAPSHOT_VERSION})`);
  }
  return parsed;
}

/** Stable 8-hex-digit world fingerprint. Two identical worlds hash identically. */
export function hashSnapshot(snapshot: WorldSnapshot): string {
  return hashString(stableStringify(snapshot)).toString(16).padStart(8, "0");
}
