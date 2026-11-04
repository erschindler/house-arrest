/**
 * The phone (brief §9).
 *
 * A phone is not a chat log. In a life sim it is the only channel the player has
 * to a world that keeps moving without them, and it is the place where
 * relationships are maintained or neglected between visits. So the model is:
 *
 *   - Outbound actions are cheap and always available: text, call, mute, block.
 *   - Inbound messages are *generated*, never scripted. Who texts you is a
 *     weighted draw over your existing relationships, so a friend you have not
 *     spoken to in a month does not text you, and someone with forty points of
 *     resentment does.
 *   - Answers depend on the world, not on the player's convenience: nobody picks
 *     up at 03:00, and nobody picks up mid-shift unless you are close.
 *
 * Nothing here writes explicit text. The flirty pool is behind the `suggestive`
 * content tag, and when the gate refuses it the phone falls back to a warm line
 * rather than silently censoring a message into a blank — disabled content must
 * not generate, and it also must not produce a broken thread.
 */

import type { ContentGate } from "../content/gate.ts";
import type { Rng } from "../core/rng.ts";
import type { MemoryStore } from "./memory.ts";
import type { RelationshipStore } from "./relationship.ts";
import { blockAt } from "./schedule.ts";
import type { LogInput, Npc, NpcId } from "./types.ts";

export type PhoneMessageKind = "text" | "call" | "voicemail";

export type PhoneMessage = {
  id: string;
  npcId: NpcId;
  direction: "in" | "out";
  kind: PhoneMessageKind;
  atMinute: number;
  body: string;
  read: boolean;
  /** True when a content gate was consulted to choose this message. */
  gated: boolean;
};

export type PhoneThread = {
  npcId: NpcId;
  muted: boolean;
  blocked: boolean;
  messages: PhoneMessage[];
};

export type PhoneState = {
  threads: PhoneThread[];
  counter: number;
  nextNudgeMinute: number;
};

export type PhoneDeps = {
  gate: ContentGate;
  relationships: RelationshipStore;
  memories: MemoryStore;
  npcs: Map<NpcId, Npc>;
  rng: Rng;
  now: () => number;
  log: (entry: LogInput) => void;
  playerId: NpcId;
};

export type CallResult = {
  answered: boolean;
  message: PhoneMessage;
  reason: string;
};

const THREAD_LIMIT = 120;

const CASUAL = [
  "You around later?",
  "Did your power go out too?",
  "Saw a van outside your place. Everything okay?",
  "Are you still doing that thing on Saturday?",
  "Found your spare key in my coat. That's a problem for both of us.",
  "The bins went out a day early. Just so you know.",
];

const WARM = [
  "Thinking of you. No rush to answer.",
  "Left something on your porch. Don't make it weird.",
  "I know things have been odd. I'm still here.",
  "Call me when you can. Not urgent. Just wanted to hear you.",
];

const TENSE = [
  "We should talk about what happened.",
  "Don't bother calling back.",
  "I heard what you said. From someone else.",
  "I'm not angry. I'm done being surprised.",
];

const FLIRTY = [
  "Can't stop thinking about last week.",
  "Come by tonight. Bring nothing.",
  "I left the light on. You know the one.",
];

export class Phone {
  threads: PhoneThread[] = [];
  counter = 0;
  nextNudgeMinute = 0;

  private readonly deps: PhoneDeps;

  constructor(deps: PhoneDeps, snapshot?: PhoneState) {
    this.deps = deps;
    if (snapshot) this.restore(snapshot);
  }

  private findThread(npcId: NpcId): PhoneThread | undefined {
    return this.threads.find((thread) => thread.npcId === npcId);
  }

  private threadFor(npcId: NpcId): PhoneThread {
    const existing = this.findThread(npcId);
    if (existing) return existing;
    const thread: PhoneThread = { npcId, muted: false, blocked: false, messages: [] };
    this.threads.push(thread);
    return thread;
  }

  private push(npcId: NpcId, direction: "in" | "out", kind: PhoneMessageKind, body: string, gated: boolean): PhoneMessage {
    this.counter += 1;
    const message: PhoneMessage = {
      id: `msg-${this.counter}`,
      npcId,
      direction,
      kind,
      atMinute: this.deps.now(),
      body,
      read: direction === "out",
      gated,
    };
    const thread = this.threadFor(npcId);
    thread.messages.push(message);
    if (thread.messages.length > THREAD_LIMIT) {
      thread.messages.splice(0, thread.messages.length - THREAD_LIMIT);
    }
    return message;
  }

  /** Which pool a message should come from, given the state of the relationship. */
  private toneFor(npcId: NpcId): { pool: string[]; gated: boolean } {
    const rel = this.deps.relationships.get(this.deps.playerId, npcId);
    if (rel.axes.resentment >= 45) return { pool: TENSE, gated: false };
    if (rel.axes.romanticInterest >= 25 || rel.axes.attraction >= 35) {
      const permitted = this.deps.gate.allows({ kind: "sexual", level: "suggestive" });
      return permitted ? { pool: FLIRTY, gated: true } : { pool: WARM, gated: true };
    }
    if (rel.axes.friendship >= 40 || rel.axes.trust >= 40) return { pool: WARM, gated: false };
    return { pool: CASUAL, gated: false };
  }

  /** Outbound text. Cheap, always available, and it is what keeps a contact warm. */
  text(npcId: NpcId, body?: string): PhoneMessage {
    const thread = this.threadFor(npcId);
    if (thread.blocked) throw new Error(`${npcId} has blocked this number`);
    const npc = this.deps.npcs.get(npcId);
    if (!npc || !npc.alive) throw new Error(`unknown contact ${npcId}`);

    const text = body ?? this.deps.rng.pick(CASUAL);
    const message = this.push(npcId, "out", "text", text, false);
    this.deps.relationships.apply(this.deps.playerId, npcId, { familiarity: 2, friendship: 1 }, this.deps.now());
    this.deps.log({
      kind: "phone",
      summary: `Texted ${npc.givenName}.`,
      participants: [this.deps.playerId, npcId],
      gated: false,
    });
    return message;
  }

  /**
   * Outbound call. Whether it is answered is a fact about the target's day, not
   * about the player's wish: asleep, at work, or simply not close enough.
   */
  call(npcId: NpcId): CallResult {
    const thread = this.threadFor(npcId);
    const npc = this.deps.npcs.get(npcId);
    if (!npc || !npc.alive) throw new Error(`unknown contact ${npcId}`);

    if (thread.blocked) {
      const message = this.push(npcId, "out", "call", "Call failed: number blocked.", false);
      return { answered: false, message, reason: "blocked" };
    }

    const block = blockAt(npc, this.deps.now());
    const rel = this.deps.relationships.get(this.deps.playerId, npcId);
    const asleep = block.activity === "sleep";
    const busy = block.location === "workplace" && rel.axes.friendship < 60;
    const reachable = 0.3 + rel.axes.friendship / 220 + rel.axes.trust / 320;

    if (asleep || busy || !this.deps.rng.chance(reachable)) {
      const reason = asleep ? "asleep" : busy ? "at work" : "no answer";
      const message = this.push(npcId, "out", "voicemail", `Call not answered (${reason}).`, false);
      this.deps.relationships.apply(this.deps.playerId, npcId, { familiarity: 1 }, this.deps.now());
      return { answered: false, message, reason };
    }

    const minutes = this.deps.rng.int(3, 22);
    const message = this.push(npcId, "in", "call", `Connected for ${minutes} minutes.`, false);
    this.deps.relationships.apply(this.deps.playerId, npcId, { familiarity: 3, trust: 2, satisfaction: 2 }, this.deps.now());
    this.deps.log({
      kind: "phone",
      summary: `Called ${npc.givenName}. Talked for ${minutes} minutes.`,
      participants: [this.deps.playerId, npcId],
      gated: false,
    });
    return { answered: true, message, reason: "answered" };
  }

  /** Marks a thread read; returns how many messages that changed. */
  markRead(npcId: NpcId): number {
    const thread = this.findThread(npcId);
    if (!thread) return 0;
    let changed = 0;
    for (const message of thread.messages) {
      if (!message.read) {
        message.read = true;
        changed += 1;
      }
    }
    return changed;
  }

  mute(npcId: NpcId, muted = true): void {
    this.threadFor(npcId).muted = muted;
  }

  /** Blocking is not deleting: the history stays, the person cannot reach you. */
  block(npcId: NpcId): void {
    const thread = this.threadFor(npcId);
    thread.blocked = true;
    this.deps.relationships.apply(this.deps.playerId, npcId, { trust: -8, resentment: 6 }, this.deps.now());
    this.deps.log({
      kind: "phone",
      summary: `Blocked ${npcId}.`,
      participants: [this.deps.playerId, npcId],
      gated: false,
    });
  }

  unblock(npcId: NpcId): void {
    this.threadFor(npcId).blocked = false;
  }

  unreadCount(): number {
    let count = 0;
    for (const thread of this.threads) {
      for (const message of thread.messages) {
        if (!message.read && message.direction === "in") count += 1;
      }
    }
    return count;
  }

  lastMessage(npcId: NpcId): PhoneMessage | undefined {
    const thread = this.findThread(npcId);
    return thread?.messages[thread.messages.length - 1];
  }

  /** Recent activity across every thread, newest last. */
  recent(limit = 10): PhoneMessage[] {
    const all: PhoneMessage[] = [];
    for (const thread of this.threads) all.push(...thread.messages);
    all.sort((a, b) => a.atMinute - b.atMinute || a.id.localeCompare(b.id));
    return all.slice(Math.max(0, all.length - limit));
  }

  /**
   * Inbound message generation. Rate-limited by `nextNudgeMinute`, and weighted by
   * how much each contact actually has to say to the player: friendship invites
   * contact, resentment demands it, and a blocked or muted thread removes the
   * candidate entirely.
   */
  tick(): PhoneMessage | null {
    const minute = this.deps.now();
    if (minute < this.nextNudgeMinute) return null;
    this.nextNudgeMinute = minute + this.deps.rng.int(180, 540);

    const candidates: { item: Npc; weight: number }[] = [];
    for (const npc of this.deps.npcs.values()) {
      if (npc.id === this.deps.playerId || !npc.alive) continue;
      const thread = this.findThread(npc.id);
      if (thread?.blocked) continue;
      const rel = this.deps.relationships.get(this.deps.playerId, npc.id);
      const weight =
        Math.max(0, rel.axes.friendship) +
        Math.max(0, rel.axes.resentment) * 0.7 +
        rel.axes.familiarity * 0.35 -
        (thread?.muted ? 200 : 0);
      if (weight <= 0) continue;
      candidates.push({ item: npc, weight });
    }

    if (candidates.length === 0) return null;
    if (!this.deps.rng.chance(0.55)) return null;

    const npc = this.deps.rng.weighted(candidates);
    const tone = this.toneFor(npc.id);
    const body = this.deps.rng.pick(tone.pool);
    const message = this.push(npc.id, "in", "text", body, tone.gated);

    const rel = this.deps.relationships.get(this.deps.playerId, npc.id);
    if (rel.axes.resentment >= 45) {
      npc.mood = Math.max(-100, npc.mood - 2);
      this.deps.memories.add({
        atMinute: minute,
        kind: "social",
        summary: `${npc.givenName} sent a message that was not friendly.`,
        participants: [npc.id, this.deps.playerId],
        tags: ["phone", "tension"],
        salience: 0.3,
        valence: -0.3,
      });
    } else {
      npc.mood = Math.min(100, npc.mood + 1);
    }

    this.deps.log({
      kind: "phone",
      summary: `${npc.givenName} texted you.`,
      participants: [npc.id, this.deps.playerId],
      gated: tone.gated,
    });
    return message;
  }

  snapshot(): PhoneState {
    return {
      threads: this.threads.map((thread) => ({
        npcId: thread.npcId,
        muted: thread.muted,
        blocked: thread.blocked,
        messages: thread.messages.map((message) => ({ ...message })),
      })),
      counter: this.counter,
      nextNudgeMinute: this.nextNudgeMinute,
    };
  }

  restore(state: PhoneState): void {
    this.threads = state.threads.map((thread) => ({
      npcId: thread.npcId,
      muted: thread.muted,
      blocked: thread.blocked,
      messages: thread.messages.map((message) => ({ ...message })),
    }));
    this.counter = state.counter;
    this.nextNudgeMinute = state.nextNudgeMinute;
  }
}
