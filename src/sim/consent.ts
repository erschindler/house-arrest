/**
 * The consent state machine (Sections 5 and 18.3).
 *
 * This is the most important file in the project and the one the brief leaves as
 * a single paragraph. Everything else in the adult layer hangs off it, so it is
 * modelled as an explicit, testable machine with these properties:
 *
 *   - Nothing sexual happens before both participants affirm. `begin()` throws
 *     otherwise, and there is no code path that skips it.
 *   - Consent is re-validated on every tick while the scene is active. An NPC can
 *     and does change their mind; the scene ends itself with consequences.
 *   - A safeword is a hard stop from any live state, matched or not. After a stop
 *     the scene cannot be resumed: any further act call throws.
 *   - Family and non-adults are rejected at construction, not filtered later.
 *   - Content toggles are re-read live: turning explicit content off mid-scene
 *     ends the scene the same way a withdrawal does.
 *
 * The engine deliberately has no notion of what an act looks like. It gates
 * *state and intensity*, and the presentation layer may only show what the
 * current state permits. That keeps the hard rules engine-side and unskippable.
 */

import type { ContentGate } from "../content/gate.ts";
import { assertHardInvariants } from "../content/gate.ts";
import type { Rng } from "../core/rng.ts";
import type { MemoryStore } from "./memory.ts";
import type { RelationshipStore } from "./relationship.ts";
import type { LogInput, Npc, NpcId } from "./types.ts";
import { negotiateTerms } from "./kink.ts";
import type { NegotiationOutcome, SceneTerms } from "./kink.ts";

export type ConsentState =
  | "offered"
  | "negotiating"
  | "affirmed"
  | "active"
  | "paused"
  | "withdrawn"
  | "safeworded"
  | "aftercare"
  | "closed";

export class ConsentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsentError";
  }
}

export type SceneDeps = {
  gate: ContentGate;
  relationships: RelationshipStore;
  memories: MemoryStore;
  now: () => number;
  log: (entry: LogInput) => void;
};

export type SceneSnapshot = {
  aId: NpcId;
  bId: NpcId;
  state: ConsentState;
  terms: SceneTerms | null;
  intensity: number;
  ticks: number;
  affirmations: NpcId[];
  endedReason: string | null;
};

const FINISHED: ConsentState[] = ["withdrawn", "safeworded", "closed"];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function assertEligible(deps: SceneDeps, a: Npc, b: Npc): void {
  for (const npc of [a, b]) {
    try {
      assertHardInvariants({ id: npc.id, age: npc.age, isMinor: npc.isMinor }, "sexual");
    } catch (error) {
      throw new ConsentError((error as Error).message);
    }
    if (!npc.alive) throw new ConsentError(`${npc.id} is not available`);
  }
  if (deps.relationships.get(a.id, b.id).family) {
    throw new ConsentError("family relationships can never be romantic or sexual (18.4)");
  }
  if (!deps.gate.allows({ kind: "sexual", level: "suggestive" })) {
    throw new ConsentError("sexual content is disabled in content settings");
  }
}

export class IntimacyScene {
  readonly aId: NpcId;
  readonly bId: NpcId;
  state: ConsentState = "offered";
  terms: SceneTerms | null = null;
  negotiation: NegotiationOutcome | null = null;
  intensity = 0;
  ticks = 0;
  endedReason: string | null = null;

  private affirmations = new Set<NpcId>();
  private readonly deps: SceneDeps;
  private readonly a: Npc;
  private readonly b: Npc;

  constructor(deps: SceneDeps, a: Npc, b: Npc, restored?: SceneSnapshot) {
    this.deps = deps;
    this.a = a;
    this.b = b;
    this.aId = a.id;
    this.bId = b.id;

    if (restored) {
      this.state = restored.state;
      this.terms = restored.terms;
      this.intensity = restored.intensity;
      this.ticks = restored.ticks;
      this.endedReason = restored.endedReason;
      this.affirmations = new Set(restored.affirmations);
      return;
    }

    assertEligible(deps, a, b);
    deps.log({
      kind: "scene.offered",
      summary: `${a.givenName} ${a.familyName} approached ${b.givenName} ${b.familyName}. Nothing has happened yet.`,
      participants: [a.id, b.id],
      gated: true,
    });
  }

  get isFinished(): boolean {
    return FINISHED.includes(this.state);
  }

  get canProceed(): boolean {
    return this.state === "active";
  }

  private requireState(allowed: ConsentState[], action: string): void {
    if (!allowed.includes(this.state)) {
      throw new ConsentError(`cannot ${action}: consent state is "${this.state}"`);
    }
  }

  private requireActive(action: string): void {
    if (this.state !== "active") {
      throw new ConsentError(`cannot ${action}: consent is ${this.state === "paused" ? "paused" : `"${this.state}"`}`);
    }
  }

  /**
   * Put terms on the table. The NPC may counter-offer: refused categories are
   * dropped, ceilings drop, conditions are added. Returns the counter-offer so a
   * UI can present it; the player accepts by affirming.
   */
  negotiate(requested: SceneTerms): NegotiationOutcome {
    this.requireState(["offered", "negotiating"], "negotiate terms");
    const rel = this.deps.relationships.get(this.aId, this.bId);
    const comfort = Math.min(this.a.sexual.comfort, this.b.sexual.comfort);
    const outcome = negotiateTerms(this.deps.gate, this.a, this.b, requested, rel.axes.trust, comfort);
    this.negotiation = outcome;

    if (outcome.declined) {
      this.terms = null;
      this.conclude("declined", this.bId, outcome.refusals.map((r) => `${r.category}: ${r.reason}`).join("; "));
      return outcome;
    }

    this.terms = outcome.accepted;
    this.state = "negotiating";
    this.deps.log({
      kind: "scene.negotiated",
      summary:
        `${this.a.givenName} and ${this.b.givenName} agreed terms: ` +
        `${outcome.accepted.categories.length} category/categories, ceiling ${outcome.accepted.intensityCeiling}/10, ` +
        `${outcome.refusals.length} refusal(s).`,
      participants: [this.aId, this.bId],
      gated: true,
    });
    return outcome;
  }

  /** Each participant affirms independently. Two affirmations are required. */
  affirm(by: NpcId): ConsentState {
    this.requireState(["negotiating"], "affirm consent");
    if (by !== this.aId && by !== this.bId) throw new ConsentError(`${by} is not a participant in this scene`);
    if (!this.terms) throw new ConsentError("there are no agreed terms to affirm");
    this.affirmations.add(by);
    if (this.affirmations.size >= 2) {
      this.state = "affirmed";
      this.deps.log({
        kind: "scene.affirmed",
        summary: `Both participants affirmed. Scene may begin.`,
        participants: [this.aId, this.bId],
        gated: true,
      });
    }
    return this.state;
  }

  begin(): void {
    if (this.state === "negotiating") {
      throw new ConsentError("both participants must affirm before anything happens");
    }
    this.requireState(["affirmed"], "begin the scene");
    if (this.affirmations.size < 2) throw new ConsentError("both participants must affirm before anything happens");
    if (!this.terms) throw new ConsentError("scene has no terms");
    if (!this.deps.gate.allows({ kind: "sexual", level: "explicit" })) {
      throw new ConsentError("explicit content is disabled in content settings");
    }
    this.state = "active";
    this.intensity = 1;
  }

  /** Escalation is bounded by the negotiated ceiling and cannot jump. */
  requestIntensity(next: number): void {
    this.requireActive("change intensity");
    if (!this.terms) throw new ConsentError("scene has no terms");
    if (next > this.terms.intensityCeiling) {
      throw new ConsentError(`intensity ${next} exceeds the negotiated ceiling ${this.terms.intensityCeiling}`);
    }
    if (next - this.intensity > 3) {
      throw new ConsentError("intensity may not jump more than 3 points without a check-in");
    }
    this.intensity = Math.max(1, next);
  }

  pause(): void {
    this.requireActive("pause");
    this.state = "paused";
  }

  /** Resuming is a fresh consent event: both must affirm again. */
  resume(): ConsentState {
    this.requireState(["paused"], "resume");
    this.affirmations.clear();
    this.state = "negotiating";
    return this.state;
  }

  /**
   * Hard stop. Honoured from any live state, whether or not the word matches the
   * agreed safewords — a stop request is never ignored, it is only logged.
   */
  safeword(by: NpcId, word: string): void {
    const live: ConsentState[] = ["negotiating", "affirmed", "active", "paused"];
    if (!live.includes(this.state)) throw new ConsentError(`cannot safeword from state "${this.state}"`);
    const matched = this.terms?.safewords.includes(word.toLowerCase()) ?? false;
    this.affirmations.clear();
    this.conclude("safeword", by, matched ? `safeword "${word}"` : `unrecognised stop word "${word}" honoured as a stop`);
  }

  withdraw(by: NpcId, reason: string): void {
    if (this.isFinished) return;
    this.affirmations.clear();
    this.conclude("withdrawn", by, reason);
  }

  /**
   * Advance one beat. Called by the world while a scene is active. Re-validates
   * content settings, participant state and willingness; a failed check ends the
   * scene rather than pausing it.
   */
  tick(rng: Rng): void {
    if (this.state !== "active") return;
    this.ticks += 1;

    if (!this.deps.gate.allows({ kind: "sexual", level: "explicit" })) {
      this.withdraw(this.bId, "content settings changed during the scene");
      return;
    }
    if (!this.a.alive || !this.b.alive) {
      this.withdraw(this.bId, "a participant became unavailable");
      return;
    }

    if (!rng.chance(this.willingness())) {
      this.withdraw(this.bId, "changed their mind mid-scene");
    }
  }

  /** 0..1 probability the scene continues. Low trust, high stress or high intensity ends it. */
  willingness(): number {
    const rel = this.deps.relationships.get(this.aId, this.bId);
    const comfort = Math.min(this.a.sexual.comfort, this.b.sexual.comfort);
    const mood = (this.a.mood + this.b.mood) / 2;
    const stress = (this.a.stress + this.b.stress) / 2;
    const alignment = (this.a.sexual.orientation === "asexual" ? -0.3 : 0) + (this.b.sexual.orientation === "asexual" ? -0.3 : 0);
    return clamp01(0.35 + comfort * 0.35 + rel.axes.trust / 400 + mood / 600 - stress / 260 - this.intensity / 45 + alignment);
  }

  aftercare(quality: number): void {
    this.requireState(["aftercare"], "provide aftercare");
    const q = clamp01(quality);
    const now = this.deps.now();
    this.deps.relationships.apply(this.aId, this.bId, { trust: q * 4, attachment: q * 3, satisfaction: q * 3 }, now);
    this.deps.memories.add({
      atMinute: now,
      kind: "intimate",
      summary: "Aftercare after a negotiated scene.",
      participants: [this.aId, this.bId],
      tags: ["aftercare"],
      salience: 0.4,
      valence: 0.5 * q,
    });
    this.state = "closed";
    this.endedReason = "aftercare complete";
  }

  close(): void {
    if (!this.isFinished) this.state = "closed";
  }

  private conclude(
    kind: "completed" | "safeword" | "withdrawn" | "declined",
    endedBy: NpcId,
    note: string,
  ): void {
    const now = this.deps.now();
    const rel = this.deps.relationships.get(this.aId, this.bId);
    const intensityLabel = `${this.intensity}/10`;

    switch (kind) {
      case "completed": {
        this.state = "aftercare";
        this.endedReason = "completed";
        this.deps.relationships.apply(this.aId, this.bId, { satisfaction: 8, attachment: 3, trust: 2, familiarity: 5 }, now);
        this.a.sexual.comfort = clamp01(this.a.sexual.comfort + 0.01);
        this.b.sexual.comfort = clamp01(this.b.sexual.comfort + 0.01);
        this.deps.memories.add({
          atMinute: now,
          kind: "intimate",
          summary: `Consensual intimacy at intensity ${intensityLabel}.`,
          participants: [this.aId, this.bId],
          tags: ["intimacy", "consensual"],
          salience: 0.55,
          valence: 0.6,
        });
        this.deps.log({
          kind: "scene.completed",
          summary: `Scene completed at intensity ${intensityLabel}; aftercare pending.`,
          participants: [this.aId, this.bId],
          gated: true,
        });
        break;
      }
      case "safeword": {
        this.state = "safeworded";
        this.endedReason = `safeword: ${note}`;
        // Being stopped and stopping cleanly builds trust, not damage.
        this.deps.relationships.apply(this.aId, this.bId, { trust: 3, respect: 2, satisfaction: -3 }, now);
        this.deps.memories.add({
          atMinute: now,
          kind: "intimate",
          summary: `A safeword ended a scene at intensity ${intensityLabel}. It was honoured immediately.`,
          participants: [this.aId, this.bId],
          tags: ["safeword", "boundary"],
          salience: 0.6,
          valence: 0.05,
        });
        this.deps.log({
          kind: "scene.safeword",
          summary: `Safeword honoured. Scene stopped at intensity ${intensityLabel}.`,
          participants: [this.aId, this.bId],
          gated: true,
        });
        break;
      }
      case "withdrawn": {
        this.state = "withdrawn";
        this.endedReason = `withdrawn: ${note}`;
        if (endedBy === this.bId) {
          this.deps.relationships.apply(
            this.aId,
            this.bId,
            { satisfaction: -10, trust: -3, resentment: 5, romanticInterest: -4 },
            now,
          );
          this.b.sexual.comfort = clamp01(this.b.sexual.comfort - 0.02);
        } else {
          this.deps.relationships.apply(this.aId, this.bId, { satisfaction: -6 }, now);
        }
        this.deps.memories.add({
          atMinute: now,
          kind: "intimate",
          summary: `A scene was stopped: ${note}. Intensity had reached ${intensityLabel}.`,
          participants: [this.aId, this.bId],
          tags: ["withdrawn", "boundary"],
          salience: 0.7,
          valence: -0.4,
        });
        this.deps.log({
          kind: "scene.withdrawn",
          summary: `Consent withdrawn (${note}) at intensity ${intensityLabel}. Scene ended.`,
          participants: [this.aId, endedBy],
          gated: true,
        });
        break;
      }
      case "declined": {
        this.state = "closed";
        this.endedReason = `declined: ${note}`;
        this.deps.relationships.apply(this.aId, this.bId, { satisfaction: -2 }, now);
        this.deps.memories.add({
          atMinute: now,
          kind: "social",
          summary: `An approach was declined: ${note}.`,
          participants: [this.aId, this.bId],
          tags: ["declined"],
          salience: 0.35,
          valence: -0.15,
        });
        this.deps.log({
          kind: "scene.declined",
          summary: `Approach declined: ${note}.`,
          participants: [this.aId, this.bId],
          gated: true,
        });
        break;
      }
    }

    // Reputation is a player-level consequence of the other person's experience.
    if (this.isFinished || this.state === "aftercare") {
      rel.interactions += 1;
      rel.lastInteractionMinute = now;
    }
  }

  /** Non-explicit status line, safe to display or log anywhere. */
  describe(): string {
    const ceiling = this.terms ? `ceiling ${this.terms.intensityCeiling}/10` : "no terms";
    return `${this.state} (intensity ${this.intensity}, ${ceiling}, ${this.ticks} beats)`;
  }

  toSnapshot(): SceneSnapshot {
    return {
      aId: this.aId,
      bId: this.bId,
      state: this.state,
      terms: this.terms,
      intensity: this.intensity,
      ticks: this.ticks,
      affirmations: [...this.affirmations],
      endedReason: this.endedReason,
    };
  }
}
