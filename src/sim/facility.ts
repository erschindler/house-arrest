/**
 * The hidden room.
 *
 * A concealed, soundproofed space is not a switch; it is a construction project
 * with a paper trail. Every stage costs money, takes in-game hours, and — the part
 * that matters — has a contractor attached to it. That contractor is a witness who
 * knows what is behind the wall, which is why the build feeds the leverage system
 * rather than standing apart from it.
 *
 * Two numbers decide whether the room is safe to use:
 *
 *   soundRating   how much noise stays inside. Soundproofing is the expensive
 *                 stage and the one that degrades fastest with use.
 *   concealment   how much the room looks like it is not there. The concealed door
 *                 buys most of it; sessions and sloppy clean-up spend it.
 *
 * Both are exposed as state, so the UE side never guesses: `noiseContained()` is
 * the only place that decides whether a scream leaves the basement.
 */

import type { Economy } from "./economy.ts";
import type { LocationId, LogInput, NpcId } from "./types.ts";

export type BuildStage = "frame" | "seal" | "soundproof" | "concealedDoor" | "drain" | "power" | "outfit";

export type StageSpec = {
  label: string;
  cost: number;
  /** In-game minutes of work. */
  minutes: number;
  requires: BuildStage[];
  concealment: number;
  sound: number;
};

export const BUILD_ORDER: BuildStage[] = ["frame", "seal", "soundproof", "concealedDoor", "drain", "power", "outfit"];

export const STAGE_SPECS: Record<BuildStage, StageSpec> = {
  frame: { label: "Frame and floor", cost: 900, minutes: 480, requires: [], concealment: 0, sound: 0 },
  seal: { label: "Seal and insulate", cost: 1400, minutes: 600, requires: ["frame"], concealment: 8, sound: 10 },
  soundproof: { label: "Soundproofing", cost: 2200, minutes: 720, requires: ["seal"], concealment: 4, sound: 42 },
  concealedDoor: { label: "Concealed door", cost: 1800, minutes: 480, requires: ["frame"], concealment: 32, sound: 4 },
  drain: { label: "Drain and wash-down", cost: 1200, minutes: 300, requires: ["frame"], concealment: 2, sound: 0 },
  power: { label: "Isolated power", cost: 800, minutes: 240, requires: ["frame"], concealment: 2, sound: 0 },
  outfit: {
    label: "Outfit the room",
    cost: 2600,
    minutes: 360,
    requires: ["soundproof", "concealedDoor", "drain", "power"],
    concealment: 0,
    sound: 12,
  },
};

/** Rooms with the adjacent void to hide something in. */
export const HIDDEN_ROOM_CANDIDATES: LocationId[] = ["basement", "guestBedroom"];

export type HiddenRoomState = {
  roomId: LocationId | null;
  stages: Record<BuildStage, boolean>;
  /** 0..100. How much it looks like it is not there. */
  concealment: number;
  /** 0..100. How much noise stays inside. */
  soundRating: number;
  sessions: number;
  discovered: boolean;
  contractorId: NpcId | null;
  project: { stage: BuildStage; dueMinute: number; contractorId: NpcId | null } | null;
  spend: number;
};

export type FacilityDeps = {
  economy: Economy;
  now: () => number;
  log: (entry: LogInput) => void;
};

function emptyStages(): Record<BuildStage, boolean> {
  return { frame: false, seal: false, soundproof: false, concealedDoor: false, drain: false, power: false, outfit: false };
}

export function createHiddenRoomState(): HiddenRoomState {
  return {
    roomId: null,
    stages: emptyStages(),
    concealment: 0,
    soundRating: 0,
    sessions: 0,
    discovered: false,
    contractorId: null,
    project: null,
    spend: 0,
  };
}

export class Facility {
  private readonly deps: FacilityDeps;
  private state: HiddenRoomState;

  constructor(deps: FacilityDeps, state?: HiddenRoomState) {
    this.deps = deps;
    this.state = state ? { ...createHiddenRoomState(), ...state, stages: { ...emptyStages(), ...state.stages } } : createHiddenRoomState();
  }

  get roomId(): LocationId | null {
    return this.state.roomId;
  }

  get concealment(): number {
    return this.state.concealment;
  }

  get soundRating(): number {
    return this.state.soundRating;
  }

  get discovered(): boolean {
    return this.state.discovered;
  }

  get contractorId(): NpcId | null {
    return this.state.contractorId;
  }

  get activeProject(): HiddenRoomState["project"] {
    return this.state.project;
  }

  stageDone(stage: BuildStage): boolean {
    return this.state.stages[stage];
  }

  /** Everything required to hold someone in it. */
  get ready(): boolean {
    return (
      this.state.roomId !== null &&
      this.state.stages.frame &&
      this.state.stages.seal &&
      this.state.stages.soundproof &&
      this.state.stages.concealedDoor &&
      this.state.stages.drain &&
      this.state.stages.outfit
    );
  }

  choose(roomId: LocationId): boolean {
    if (this.state.roomId !== null) return false;
    if (!HIDDEN_ROOM_CANDIDATES.includes(roomId)) return false;
    this.state.roomId = roomId;
    this.deps.log({
      kind: "facility",
      summary: `Building work begins in the ${roomId}. The entry will not survive the first stage.`,
      participants: [],
      gated: true,
    });
    return true;
  }

  /**
   * Start one stage. Refused (not thrown) when the prerequisites, the money or the
   * schedule are not there: this is a construction project, and the reasons are
   * things the player can fix.
   */
  begin(stage: BuildStage, contractorId: NpcId | null): { ok: boolean; reason: string } {
    if (this.state.roomId === null) return { ok: false, reason: "no room has been chosen" };
    if (this.state.project) return { ok: false, reason: "a stage is already in progress" };
    if (this.state.stages[stage]) return { ok: false, reason: `${STAGE_SPECS[stage].label} is already done` };

    const spec = STAGE_SPECS[stage];
    for (const required of spec.requires) {
      if (!this.state.stages[required]) {
        return { ok: false, reason: `${STAGE_SPECS[required].label} has to be finished first` };
      }
    }

    if (!this.deps.economy.spend(spec.cost, `Construction: ${spec.label}`, this.deps.now())) {
      return { ok: false, reason: `cannot afford $${spec.cost}` };
    }

    this.state.spend += spec.cost;
    this.state.project = {
      stage,
      dueMinute: this.deps.now() + spec.minutes,
      contractorId,
    };
    if (contractorId) this.state.contractorId = contractorId;

    this.deps.log({
      kind: "facility",
      summary: `${spec.label} started ($${spec.cost}, ${Math.round(spec.minutes / 60)}h).`,
      participants: contractorId ? [contractorId] : [],
      gated: true,
    });

    return { ok: true, reason: "started" };
  }

  /** Complete the active stage when its work is done. Returns the stage, if any. */
  tick(minute: number): BuildStage | null {
    const project = this.state.project;
    if (!project || minute < project.dueMinute) return null;

    const spec = STAGE_SPECS[project.stage];
    this.state.stages[project.stage] = true;
    this.state.concealment = Math.min(100, this.state.concealment + spec.concealment);
    this.state.soundRating = Math.min(100, this.state.soundRating + spec.sound);
    this.state.project = null;

    this.deps.log({
      kind: "facility",
      summary: `${spec.label} finished. Concealment ${Math.round(this.state.concealment)}, sound rating ${Math.round(this.state.soundRating)}.`,
      participants: project.contractorId ? [project.contractorId] : [],
      gated: true,
    });

    return project.stage;
  }

  /** Noise that escapes the room, 0..100. The only place this is decided. */
  noiseContained(sourceNoise: number): number {
    const clamped = Math.max(0, Math.min(100, sourceNoise));
    if (!this.state.stages.soundproof) return clamped;
    return Math.max(0, clamped - this.state.soundRating);
  }

  /** Every use spends the room: the door sticks, the foam compresses, the drain smells. */
  registerUse(wear = 1): void {
    this.state.sessions += 1;
    this.state.concealment = Math.max(0, this.state.concealment - wear * 0.8);
    this.state.soundRating = Math.max(0, this.state.soundRating - wear * 0.35);
  }

  /** Nightly decay, plus the chance the build itself is noticed. */
  daily(rng: { chance(probability: number): boolean }): void {
    this.state.concealment = Math.max(0, this.state.concealment - 0.15);
    if (this.state.discovered) return;
    if (this.state.roomId === null) return;
    const risk = (100 - this.state.concealment) * 0.0004;
    if (rng.chance(risk)) {
      this.state.discovered = true;
      this.deps.log({
        kind: "facility",
        summary: "The hidden room was found. Everything behind that door is now a scene.",
        participants: [],
        gated: true,
      });
    }
  }

  snapshot(): HiddenRoomState {
    return { ...this.state, stages: { ...this.state.stages }, project: this.state.project ? { ...this.state.project } : null };
  }

  restore(state: HiddenRoomState): void {
    this.state = {
      ...createHiddenRoomState(),
      ...state,
      stages: { ...emptyStages(), ...state.stages },
      project: state.project ? { ...state.project } : null,
    };
  }

  describe(): string {
    if (this.state.roomId === null) return "no hidden room";
    const done = BUILD_ORDER.filter((stage) => this.state.stages[stage]).length;
    return (
      `${this.state.roomId}: ${done}/${BUILD_ORDER.length} stages, ` +
      `concealment ${Math.round(this.state.concealment)}, sound ${Math.round(this.state.soundRating)}, ` +
      `${this.state.sessions} session(s)${this.state.discovered ? ", DISCOVERED" : ""}`
    );
  }
}
