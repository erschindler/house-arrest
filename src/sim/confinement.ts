/**
 * Confinement, as a state of mind rather than a sentence.
 *
 * The premise changed: the player does not stay inside because a monitor says so,
 * they stay inside because the doorstep is the edge of the world. That is a
 * different system, not a different label — a legal restriction is enforced from
 * outside and punished when broken, while agoraphobia is enforced from inside and
 * *rewards* avoidance until the house is the only place left.
 *
 * So the model has two axes that pull against each other:
 *
 *   fear      — how bad the outside feels. Rises with days indoors, falls only
 *               through deliberate exposure. Avoidance is self-reinforcing.
 *   tolerance — how much of the outside the player can currently stand. Rises
 *               with exposure practice, decays when unused.
 *
 * The door is the whole interface. `approach` walks the player toward it and
 * returns what happens; `stepOutside` is only possible once fear is low enough,
 * and even then it can end in a panic attack that sends them back in. Nothing
 * here is random: a panic is a threshold being crossed, so the same save always
 * panics at the same doorstep.
 *
 * Legal mode exists because the brief's original premise is still a valid story.
 * In that mode fear is low, the monitor is real, and crossing the threshold is
 * recorded — the same door, a different consequence.
 */

import type { Npc } from "./types.ts";

export type ConfinementMode = "agoraphobic" | "legal";

export type ThresholdStage = "calm" | "uneasy" | "atTheDoor" | "panic" | "outside";

export type ConfinementState = {
  mode: ConfinementMode;
  /** 0..100 dread of the outside. */
  fear: number;
  /** 0..100 current arousal. Decays on its own; spikes at the door. */
  anxiety: number;
  /** 0..100 how much outside the player can currently stand. */
  tolerance: number;
  panicAttacks: number;
  lastPanicMinute: number | null;
  /** Consecutive days with no time outside. */
  insideStreak: number;
  exposureMinutes: number;
  exposureDays: number;
  outsideMinutes: number;
  doorAttempts: number;
  /** Day index of the last day the player spent any time outside. */
  lastDayOutside: number;
  /** Day index of the last day exposure was practised. */
  lastExposureDay: number;
};

export type ApproachOutcome = {
  reached: number;
  stage: ThresholdStage;
  anxiety: number;
  fear: number;
  panicked: boolean;
  crossed: boolean;
  summary: string;
};

export type ExposureOutcome = {
  minutes: number;
  anxiety: number;
  fear: number;
  panicked: boolean;
  crossed: boolean;
  trippedMonitor: boolean;
  summary: string;
};

/** Anxiety at which the body overrules the intention. */
export const PANIC_ANXIETY = 70;
/** Fear above which stepping out is not possible without a panic. */
export const OUTSIDE_FEAR_GATE = 30;
/** Days indoors before avoidance starts compounding. */
export const AVOIDANCE_ONSET_DAYS = 3;
/** Fear at which the house has effectively closed over the player. */
export const COLLAPSE_FEAR = 90;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function createConfinementState(mode: ConfinementMode = "agoraphobic"): ConfinementState {
  return {
    mode,
    fear: mode === "agoraphobic" ? 48 : 12,
    anxiety: mode === "agoraphobic" ? 22 : 4,
    tolerance: mode === "agoraphobic" ? 34 : 70,
    panicAttacks: 0,
    lastPanicMinute: null,
    insideStreak: 0,
    exposureMinutes: 0,
    exposureDays: 0,
    outsideMinutes: 0,
    doorAttempts: 0,
    lastDayOutside: -1,
    lastExposureDay: -1,
  };
}

export class Confinement {
  private state: ConfinementState;

  constructor(state?: Partial<ConfinementState>) {
    this.state = { ...createConfinementState(state?.mode ?? "agoraphobic"), ...state };
  }

  get mode(): ConfinementMode {
    return this.state.mode;
  }

  get fear(): number {
    return this.state.fear;
  }

  get anxiety(): number {
    return this.state.anxiety;
  }

  get tolerance(): number {
    return this.state.tolerance;
  }

  get insideStreak(): number {
    return this.state.insideStreak;
  }

  get outsideMinutes(): number {
    return this.state.outsideMinutes;
  }

  get panicAttacks(): number {
    return this.state.panicAttacks;
  }

  /** True once the player cannot realistically reach the door any more. */
  get housebound(): boolean {
    return this.state.fear >= COLLAPSE_FEAR;
  }

  /** Anxiety decays on its own; fear does not. */
  tickMinute(minutes: number, player?: Npc): void {
    const before = this.state.anxiety;
    this.state.anxiety = Math.max(0, this.state.anxiety - 0.05 * minutes);
    if (player && before > 40 && this.state.anxiety <= 40) {
      // Coming down is a relief, and relief costs a little stress.
      player.stress = Math.max(0, player.stress - 0.5);
    }
  }

  /**
   * Walk toward the front door. `proximity` is 0 (middle of the room) to 1 (hand
   * on the handle); `resolve` is 0 (barely trying) to 1 (deliberate).
   *
   * Anxiety is a function of proximity and fear, damped by resolve — the same
   * person on the same day always panics at the same point.
   */
  approach(proximity: number, resolve: number, atMinute: number, player?: Npc): ApproachOutcome {
    const p = clamp01(proximity);
    const r = clamp01(resolve);
    this.state.doorAttempts += 1;

    const spike = p * (14 + this.state.fear * 0.35) * (1 - r * 0.6);
    this.state.anxiety = clamp(this.state.anxiety + spike, 0, 100);

    const panicked = this.state.anxiety >= PANIC_ANXIETY;
    if (panicked) {
      this.state.panicAttacks += 1;
      this.state.lastPanicMinute = atMinute;
      this.state.fear = clamp(this.state.fear + 2.5, 0, 100);
      this.state.anxiety = Math.min(100, this.state.anxiety);
      if (player) {
        player.stress = Math.min(100, player.stress + 12);
        player.needs.comfort = Math.max(0, player.needs.comfort - 6);
      }
      return {
        reached: p,
        stage: "panic",
        anxiety: this.state.anxiety,
        fear: this.state.fear,
        panicked: true,
        crossed: false,
        summary:
          `Panic at ${Math.round(p * 100)}% of the way to the door. ` +
          `Heart rate through the roof, hands shaking, back inside within seconds.`,
      };
    }

    const crossed = p >= 1 && this.state.fear <= OUTSIDE_FEAR_GATE + r * 25;
    if (crossed) {
      this.state.tolerance = clamp(this.state.tolerance + 0.5, 0, 100);
    }

    return {
      reached: p,
      stage: crossed ? "outside" : this.state.anxiety > 45 ? "atTheDoor" : this.state.anxiety > 20 ? "uneasy" : "calm",
      anxiety: this.state.anxiety,
      fear: this.state.fear,
      panicked: false,
      crossed,
      summary: crossed
        ? "The door opened and nothing happened. That is the whole victory."
        : `Reached ${Math.round(p * 100)}% of the way, anxiety ${Math.round(this.state.anxiety)}/100.`,
    };
  }

  /**
   * Deliberate practice: standing at the threshold, then further, for minutes at a
   * time. Lowers fear slowly and raises tolerance; can still end in a panic.
   */
  practiseExposure(minutes: number, atMinute: number, player?: Npc): ExposureOutcome {
    const bounded = Math.max(1, Math.min(240, Math.round(minutes)));
    const day = Math.floor(atMinute / 1440);
    this.state.exposureMinutes += bounded;
    if (this.state.lastExposureDay !== day) {
      this.state.exposureDays += 1;
      this.state.lastExposureDay = day;
    }

    this.state.anxiety = clamp(this.state.anxiety + bounded * 0.1, 0, 100);
    const panicked = this.state.anxiety >= PANIC_ANXIETY;
    if (panicked) {
      this.state.panicAttacks += 1;
      this.state.lastPanicMinute = atMinute;
      this.state.fear = clamp(this.state.fear + 1.5, 0, 100);
      if (player) player.stress = Math.min(100, player.stress + 8);
      return {
        minutes: 0,
        anxiety: this.state.anxiety,
        fear: this.state.fear,
        panicked: true,
        crossed: false,
        trippedMonitor: false,
        summary: "The exposure session ended in a panic. No ground gained, a little lost.",
      };
    }

    this.state.fear = clamp(this.state.fear - bounded * 0.03, 0, 100);
    this.state.tolerance = clamp(this.state.tolerance + bounded * 0.03, 0, 100);
    if (player) player.stress = Math.max(0, player.stress - bounded * 0.05);

    return {
      minutes: bounded,
      anxiety: this.state.anxiety,
      fear: this.state.fear,
      panicked: false,
      crossed: false,
      trippedMonitor: false,
      summary: `${bounded} minutes of exposure. Fear ${Math.round(this.state.fear)}/100, tolerance ${Math.round(this.state.tolerance)}/100.`,
    };
  }

  /**
   * Actually leave. Refused (returned as an outcome, not an exception) while fear
   * is above the gate; legal mode records the breach instead of panicking.
   */
  stepOutside(minutes: number, atMinute: number, player?: Npc): ExposureOutcome {
    const bounded = Math.max(1, Math.min(720, Math.round(minutes)));
    const legal = this.state.mode === "legal";

    if (!legal && this.state.fear > OUTSIDE_FEAR_GATE) {
      const outcome = this.approach(1, 0.2, atMinute, player);
      return {
        minutes: 0,
        anxiety: outcome.anxiety,
        fear: outcome.fear,
        panicked: outcome.panicked,
        crossed: false,
        trippedMonitor: false,
        summary: `Not possible at fear ${Math.round(this.state.fear)}/100. The door is as far as it goes.`,
      };
    }

    this.state.outsideMinutes += bounded;
    this.state.lastDayOutside = Math.floor(atMinute / 1440);
    this.state.insideStreak = 0;
    this.state.fear = clamp(this.state.fear - bounded * 0.02, 0, 100);
    this.state.tolerance = clamp(this.state.tolerance + bounded * 0.05, 0, 100);
    if (player) player.needs.fun = Math.min(100, player.needs.fun + bounded * 0.05);

    return {
      minutes: bounded,
      anxiety: this.state.anxiety,
      fear: this.state.fear,
      panicked: false,
      crossed: true,
      trippedMonitor: legal,
      summary: legal
        ? `${bounded} minutes outside, and the monitor logged every one of them.`
        : `${bounded} minutes outside. Fear ${Math.round(this.state.fear)}/100.`,
    };
  }

  /** Once per game day. Avoidance compounds; exposure is the only way down. */
  daily(day: number, player?: Npc): void {
    if (this.state.lastDayOutside !== day) {
      this.state.insideStreak += 1;
    } else {
      this.state.insideStreak = 0;
    }

    const exposureToday = this.state.lastExposureDay === day;
    const drift = this.state.mode === "agoraphobic" ? 0.35 : 0.05;
    const compounding = Math.max(0, this.state.insideStreak - AVOIDANCE_ONSET_DAYS) * 0.3;

    if (!exposureToday) {
      this.state.fear = clamp(this.state.fear + drift + compounding, 0, 100);
      this.state.tolerance = clamp(this.state.tolerance - 0.5, 0, 100);
    } else {
      this.state.fear = clamp(this.state.fear - 0.2, 0, 100);
    }

    this.state.anxiety = Math.max(0, this.state.anxiety - 4);

    if (player) {
      player.stress = clamp(player.stress + this.state.fear * 0.02, 0, 100);
    }
  }

  snapshot(): ConfinementState {
    return { ...this.state };
  }

  restore(state: ConfinementState): void {
    this.state = { ...createConfinementState(state.mode), ...state };
  }

  describe(): string {
    return (
      `${this.state.mode} — fear ${Math.round(this.state.fear)}/100, ` +
      `tolerance ${Math.round(this.state.tolerance)}/100, ` +
      `inside ${this.state.insideStreak} day(s), ${this.state.panicAttacks} panic(s)`
    );
  }
}
