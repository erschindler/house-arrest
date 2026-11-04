/**
 * Custody: the people in the room when nobody is in the room.
 *
 * A captive is not an inventory item. They are hungry, frightened, restrained or
 * not, and they are looking for a way out. The state here is deliberately small
 * and physical — restraints, last meal, terror, attempts — because those are the
 * things that decide whether the room holds together while the player is asleep.
 *
 * Escape is a probability per minute derived from state, drawn from the world rng,
 * so it is deterministic for a given save. A gagged captive makes no noise; an
 * ungagged one makes noise the facility either contains or does not.
 */

import type { Rng } from "../core/rng.ts";
import type { LogInput, Npc, NpcId } from "./types.ts";

export type Restraints = {
  wrists: boolean;
  ankles: boolean;
  gag: boolean;
};

export type Captive = {
  npcId: NpcId;
  since: number;
  restraints: Restraints;
  fedAtMinute: number;
  terror: number;
  compliance: number;
  escapeAttempts: number;
  deliveredBy: NpcId | null;
};

export type CustodyState = {
  captives: Captive[];
};

export type CustodyDeps = {
  npcs: Map<NpcId, Npc>;
  rng: Rng;
  now: () => number;
  log: (entry: LogInput) => void;
  /** 0..100 sound rating of the room they are in. */
  noiseMitigation: () => number;
};

export function createCustodyState(): CustodyState {
  return { captives: [] };
}

export class Custody {
  private readonly deps: CustodyDeps;
  private captives: Captive[] = [];
  private escapees: NpcId[] = [];

  constructor(deps: CustodyDeps, state?: CustodyState) {
    this.deps = deps;
    if (state) this.captives = state.captives.map((entry) => ({ ...entry, restraints: { ...entry.restraints } }));
  }

  list(): Captive[] {
    return this.captives.map((entry) => ({ ...entry, restraints: { ...entry.restraints } }));
  }

  holds(npcId: NpcId): boolean {
    return this.captives.some((entry) => entry.npcId === npcId);
  }

  get(npcId: NpcId): Captive | undefined {
    return this.captives.find((entry) => entry.npcId === npcId);
  }

  /**
   * Take someone. Refuses family, the player, the dead, and anyone already held:
   * those are all bugs in the caller, not choices in the fiction.
   */
  take(npcId: NpcId, deliveredBy: NpcId | null = null): boolean {
    const npc = this.deps.npcs.get(npcId);
    if (!npc || !npc.alive || npc.isMinor) return false;
    if (npcId === "npc-player" || this.holds(npcId)) return false;
    if (npc.homeLocation !== "elsewhere") return false;

    const now = this.deps.now();
    this.captives.push({
      npcId,
      since: now,
      restraints: { wrists: true, ankles: true, gag: false },
      fedAtMinute: now,
      terror: Math.max(40, npc.stress),
      compliance: 0,
      escapeAttempts: 0,
      deliveredBy,
    });

    npc.stress = 100;
    this.deps.log({
      kind: "custody",
      summary: `${npc.givenName} ${npc.familyName} is in the room.`,
      participants: [npcId, ...(deliveredBy ? [deliveredBy] : [])],
      gated: true,
    });
    return true;
  }

  release(npcId: NpcId): boolean {
    const index = this.captives.findIndex((entry) => entry.npcId === npcId);
    if (index === -1) return false;
    this.captives.splice(index, 1);
    this.deps.log({ kind: "custody", summary: "The room is empty again.", participants: [npcId], gated: true });
    return true;
  }

  feed(npcId: NpcId): boolean {
    const captive = this.captives.find((entry) => entry.npcId === npcId);
    if (!captive) return false;
    captive.fedAtMinute = this.deps.now();
    captive.compliance = Math.min(100, captive.compliance + 2);
    captive.terror = Math.max(0, captive.terror - 1);
    return true;
  }

  restrain(npcId: NpcId, part: keyof Restraints, on: boolean): boolean {
    const captive = this.captives.find((entry) => entry.npcId === npcId);
    if (!captive) return false;
    captive.restraints[part] = on;
    if (part === "gag" && on) captive.terror = Math.min(100, captive.terror + 4);
    return true;
  }

  /** Noise the room has to contain right now, 0..100. */
  noiseLevel(): number {
    let noise = 0;
    for (const captive of this.captives) {
      if (captive.restraints.gag) continue;
      noise += 18 + captive.terror * 0.35;
    }
    return Math.min(100, noise);
  }

  tickMinute(minutes: number): void {
    const now = this.deps.now();
    const containment = this.deps.noiseMitigation();

    for (const captive of this.captives.slice()) {
      const npc = this.deps.npcs.get(captive.npcId);
      if (!npc || !npc.alive) {
        this.captives = this.captives.filter((entry) => entry.npcId !== captive.npcId);
        continue;
      }

      const hungry = now - captive.fedAtMinute;
      captive.terror = Math.min(100, captive.terror + (hungry > 720 ? 0.04 : 0.015) * minutes);
      captive.compliance = Math.min(100, captive.compliance + Math.min(0.01, captive.terror / 100000) * minutes);

      const wristFactor = captive.restraints.wrists ? 0.15 : 1;
      const ankleFactor = captive.restraints.ankles ? 0.5 : 1;
      const base = 0.0015 * wristFactor * ankleFactor * (1 + captive.terror / 100);
      if (this.deps.rng.chance(Math.min(0.4, base * minutes))) {
        captive.escapeAttempts += 1;
        if (!captive.restraints.wrists || this.deps.rng.chance(0.35)) {
          this.captives = this.captives.filter((entry) => entry.npcId !== captive.npcId);
          this.escapees.push(captive.npcId);
          this.deps.log({
            kind: "custody",
            summary: `${npc.givenName} ${npc.familyName} got out.`,
            participants: [captive.npcId],
            gated: true,
          });
          continue;
        }
      }

      // A noisy room is a witness generator, whatever the walls are made of.
      const leak = Math.max(0, this.noiseLevel() - containment);
      if (leak > 25 && this.deps.rng.chance(0.00035 * minutes)) {
        this.deps.log({
          kind: "custody",
          summary: "Someone outside heard something from the house and stood still to listen.",
          participants: [captive.npcId],
          gated: true,
        });
      }
    }
  }

  /** Escapes are reported once so the world can add heat and evidence. */
  takeEscapees(): NpcId[] {
    const out = this.escapees.slice();
    this.escapees.length = 0;
    return out;
  }

  snapshot(): CustodyState {
    return { captives: this.captives.map((entry) => ({ ...entry, restraints: { ...entry.restraints } })) };
  }

  restore(state: CustodyState): void {
    this.captives = state.captives.map((entry) => ({ ...entry, restraints: { ...entry.restraints } }));
    this.escapees = [];
  }
}
