/**
 * The fictional internet (brief §8).
 *
 * Three things live here, and they are deliberately separated:
 *
 *   1. **A social feed.** NPCs post about their own lives, drawn from their
 *      schedule and mood. The feed is how the player sees the city without going
 *      anywhere — which is the only way a character under house arrest can watch
 *      the world.
 *   2. **Exposure.** Anything the player posts adds to a footprint that the
 *      investigation system can eventually read. Posting is a real choice with a
 *      real cost, not free flavour text.
 *   3. **Listings.** Abstract, non-instructive services behind the `dark` content
 *      tag, each of which produces a *state* change (a paper trail, one piece of
 *      evidence gone, a handset). Prices, not procedures. There is nothing here
 *      that describes how anything is done, and nothing that can be used as a
 *      guide: an entry is a label, a price and a game effect.
 *
 * Explicit posting is the interesting gating case. It is the one place the player
 * can *generate* content that must obey the gate, so it throws rather than
 * silently downgrading: a UI that offers a button the settings forbid is a bug,
 * and a swallowed error hides it.
 */

import type { ContentGate } from "../content/gate.ts";
import type { Rng } from "../core/rng.ts";
import type { Economy } from "./economy.ts";
import type { InvestigationState } from "./investigation.ts";
import { recordEvidence } from "./investigation.ts";
import type { MemoryStore } from "./memory.ts";
import type { RelationshipStore } from "./relationship.ts";
import { blockAt } from "./schedule.ts";
import type { LogInput, Npc, NpcId } from "./types.ts";

export type PostKind = "status" | "complaint" | "photo" | "explicitPhoto";

export type SocialPost = {
  id: string;
  author: NpcId | "player";
  kind: PostKind;
  body: string;
  tags: string[];
  atMinute: number;
  likes: number;
  replies: number;
};

export type NetState = {
  posts: SocialPost[];
  counter: number;
  nextPostMinute: number;
  /** 0..100. How much of the player's life exists in public. */
  exposure: number;
  followers: number;
};

export type NetDeps = {
  gate: ContentGate;
  relationships: RelationshipStore;
  memories: MemoryStore;
  npcs: Map<NpcId, Npc>;
  rng: Rng;
  now: () => number;
  log: (entry: LogInput) => void;
  playerId: NpcId;
};

export type DarkListing = {
  id: string;
  label: string;
  price: number;
  detail: string;
  effect: "paperTrail" | "removeEvidence" | "burner";
};

export const DARK_LISTINGS: DarkListing[] = [
  {
    id: "documents",
    label: "Document service",
    price: 900,
    detail: "Replacement paperwork. It leaves a paper trail of its own.",
    effect: "paperTrail",
  },
  {
    id: "disposal",
    label: "Disposal service",
    price: 2400,
    detail: "Removes one piece of physical evidence nobody has found yet.",
    effect: "removeEvidence",
  },
  {
    id: "burner",
    label: "Burner handset",
    price: 120,
    detail: "A second phone. Lowers exposure; another account to keep track of.",
    effect: "burner",
  },
];

export type PurchaseResult = {
  ok: boolean;
  listing: DarkListing;
  summary: string;
};

const POST_LIMIT = 240;

const NPC_STATUS = [
  "Another week, another schedule.",
  "Coffee, then everything else.",
  "Nothing worth posting. Posting anyway.",
  "Somebody's dog has been barking for an hour.",
];

const NPC_COMPLAINT = [
  "Whole street lost power for twenty minutes.",
  "Third late delivery this month.",
  "The roadworks outside will outlive me.",
  "Rent went up again. Of course it did.",
];

const NPC_WORK = [
  "Double shift. Do not talk to me.",
  "Covering for someone who is not sick.",
  "The system went down and we all just stood there.",
];

const PLAYER_KINDS: Record<PostKind, string[]> = {
  status: ["Home again. Same four walls.", "Day whatever of this."],
  complaint: ["The heating is making a noise I cannot afford.", "Everything in this house is older than I am."],
  photo: ["Took a photo of the back yard.", "The light in the kitchen at six."],
  explicitPhoto: ["Posted a photo that nobody asked for."],
};

export class Net {
  posts: SocialPost[] = [];
  counter = 0;
  nextPostMinute = 0;
  exposure = 0;
  followers = 0;

  private readonly deps: NetDeps;

  constructor(deps: NetDeps, snapshot?: NetState) {
    this.deps = deps;
    if (snapshot) this.restore(snapshot);
  }

  private push(author: NpcId | "player", kind: PostKind, body: string, tags: string[]): SocialPost {
    this.counter += 1;
    const post: SocialPost = {
      id: `post-${this.counter}`,
      author,
      kind,
      body,
      tags,
      atMinute: this.deps.now(),
      likes: this.deps.rng.int(0, author === "player" ? 9 : 24),
      replies: this.deps.rng.int(0, author === "player" ? 2 : 7),
    };
    this.posts.push(post);
    if (this.posts.length > POST_LIMIT) this.posts.splice(0, this.posts.length - POST_LIMIT);
    return post;
  }

  /**
   * Player post. Explicit posts are the only self-authored content that can be
   * gated, so they are checked here and refused outright when the settings do not
   * permit them.
   */
  post(kind: PostKind, body?: string, about?: NpcId): SocialPost {
    if (kind === "explicitPhoto") {
      const nudity = this.deps.gate.allows({ kind: "nudity", level: "full" });
      const exhibitionism = this.deps.gate.allows({ kind: "fetish", category: "exhibitionism", intensity: 4 });
      if (!nudity || !exhibitionism) {
        throw new Error("content settings do not permit explicit posts");
      }
    }

    const text = body ?? this.deps.rng.pick(PLAYER_KINDS[kind]);
    const post = this.push("player", kind, text, kind === "explicitPhoto" ? ["explicit"] : []);

    this.exposure = Math.min(100, this.exposure + (kind === "explicitPhoto" ? 12 : kind === "photo" ? 6 : 3));
    this.followers = Math.max(0, this.followers + this.deps.rng.int(-1, 4));

    if (about) {
      this.deps.relationships.apply(this.deps.playerId, about, { respect: -2, familiarity: 2 }, this.deps.now());
      this.deps.memories.add({
        atMinute: this.deps.now(),
        kind: "social",
        summary: "You posted about someone who knows you.",
        participants: [this.deps.playerId, about],
        tags: ["online"],
        salience: 0.35,
        valence: -0.2,
      });
    }

    this.deps.log({
      kind: "net",
      summary: `Posted ${kind === "explicitPhoto" ? "a photo" : `a ${kind}`} (exposure ${this.exposure}/100).`,
      participants: [this.deps.playerId],
      gated: kind === "explicitPhoto",
    });
    return post;
  }

  feed(limit = 10, author?: NpcId | "player"): SocialPost[] {
    const source = author ? this.posts.filter((post) => post.author === author) : this.posts;
    return source.slice(Math.max(0, source.length - limit));
  }

  /** NPC posts, generated from what that character is actually doing. */
  tick(): SocialPost | null {
    const minute = this.deps.now();
    if (minute < this.nextPostMinute) return null;
    this.nextPostMinute = minute + this.deps.rng.int(120, 420);

    const candidates: { item: Npc; weight: number }[] = [];
    for (const npc of this.deps.npcs.values()) {
      if (npc.id === this.deps.playerId || !npc.alive) continue;
      const weight = 0.2 + npc.personality.extraversion;
      candidates.push({ item: npc, weight });
    }
    if (candidates.length === 0) return null;
    if (!this.deps.rng.chance(0.6)) return null;

    const npc = this.deps.rng.weighted(candidates);
    const block = blockAt(npc, minute);
    const pool = block.activity === "work" ? NPC_WORK : npc.mood < -20 ? NPC_COMPLAINT : NPC_STATUS;
    const body = this.deps.rng.pick(pool);
    const post = this.push(npc.id, "status", body, [block.activity]);

    if (post.likes > 12) {
      this.deps.relationships.apply(npc.id, this.deps.playerId, { familiarity: 0.2 }, minute);
    }
    return post;
  }

  /**
   * Buying from the listings. Effects are abstract state changes; the whole point
   * is that every one of them has a cost the player did not ask for.
   */
  purchase(listingId: string, economy: Economy, investigation: InvestigationState): PurchaseResult {
    const listing = DARK_LISTINGS.find((entry) => entry.id === listingId);
    if (!listing) throw new Error(`unknown listing ${listingId}`);
    if (!this.deps.gate.allows({ kind: "dark" })) {
      throw new Error("listings require dark themes in content settings");
    }

    if (listing.effect === "removeEvidence") {
      const target = investigation.evidence.find((entry) => !entry.discovered && entry.kind !== "testimony");
      if (!target) {
        return { ok: false, listing, summary: "Nothing to remove: no undiscovered physical evidence." };
      }
      if (!economy.spend(listing.price, listing.label, this.deps.now())) {
        return { ok: false, listing, summary: `Cannot afford $${listing.price}.` };
      }
      investigation.evidence = investigation.evidence.filter((entry) => entry.id !== target.id);
      this.exposure = Math.max(0, this.exposure - 6);
      return { ok: true, listing, summary: `One piece of evidence is gone. (${target.kind})` };
    }

    if (!economy.spend(listing.price, listing.label, this.deps.now())) {
      return { ok: false, listing, summary: `Cannot afford $${listing.price}.` };
    }

    if (listing.effect === "paperTrail") {
      recordEvidence(investigation, "document", this.deps.playerId, this.deps.now());
      this.exposure = Math.min(100, this.exposure + 4);
      return { ok: true, listing, summary: "New paperwork. And a document that points at you." };
    }

    this.exposure = Math.max(0, this.exposure - 12);
    return { ok: true, listing, summary: "A second handset. Exposure down, another account to maintain." };
  }

  availableListings(): DarkListing[] {
    return this.deps.gate.allows({ kind: "dark" }) ? DARK_LISTINGS : [];
  }

  snapshot(): NetState {
    return {
      posts: this.posts.map((post) => ({ ...post, tags: [...post.tags] })),
      counter: this.counter,
      nextPostMinute: this.nextPostMinute,
      exposure: this.exposure,
      followers: this.followers,
    };
  }

  restore(state: NetState): void {
    this.posts = state.posts.map((post) => ({ ...post, tags: [...post.tags] }));
    this.counter = state.counter;
    this.nextPostMinute = state.nextPostMinute;
    this.exposure = state.exposure;
    this.followers = state.followers;
  }
}
