/**
 * Rumor propagation across the NPC social graph (Sections 5 "aftermath" and 7
 * "NPCs discuss incidents with one another").
 *
 * A rumor is a salience-weighted, valence-tagged claim about a subject. It walks
 * the graph hop by hop: extroverted, trusting friends pass it on, salience decays
 * per hop, and it dies out on its own. Listeners form an opinion of the subject
 * and, if the listener is the player, it feeds reputation.
 */

import type { Rng } from "../core/rng.ts";
import type { MemoryStore } from "./memory.ts";
import type { RelationshipStore } from "./relationship.ts";
import type { LogInput, Npc, NpcId } from "./types.ts";

export type RumorSeed = {
  subject: NpcId;
  summary: string;
  tags: string[];
  salience: number;
  valence: number;
};

export type GossipDeps = {
  relationships: RelationshipStore;
  memories: MemoryStore;
  npcs: Map<NpcId, Npc>;
  rng: Rng;
  now: () => number;
  log: (entry: LogInput) => void;
  playerId: NpcId;
};

export type GossipResult = {
  heardBy: NpcId[];
  reachingPlayer: boolean;
  reputationDelta: number;
};

const MAX_HOPS = 4;
const MAX_LISTENERS = 24;

export function spreadRumor(deps: GossipDeps, originId: NpcId, seed: RumorSeed): GossipResult {
  const visited = new Set<NpcId>([originId, seed.subject]);
  const heardBy: NpcId[] = [];
  let frontier: { id: NpcId; salience: number; hop: number }[] = [{ id: originId, salience: seed.salience, hop: 0 }];
  let reputationDelta = 0;
  let reachingPlayer = false;

  while (frontier.length > 0 && heardBy.length < MAX_LISTENERS) {
    const next: { id: NpcId; salience: number; hop: number }[] = [];

    for (const node of frontier) {
      const teller = deps.npcs.get(node.id);
      if (!teller) continue;

      for (const contact of contactsOf(deps.relationships, node.id)) {
        if (visited.has(contact)) continue;
        const listener = deps.npcs.get(contact);
        if (!listener) continue;

        const rel = deps.relationships.get(node.id, contact);
        const warmth = (rel.axes.friendship + rel.axes.trust) / 200;
        const pass = 0.12 + teller.personality.extraversion * 0.3 + node.salience * 0.45 + warmth * 0.2 - node.hop * 0.08;
        if (!deps.rng.chance(Math.max(0, Math.min(0.95, pass)))) continue;

        visited.add(contact);
        heardBy.push(contact);
        const salience = node.salience * 0.75;

        deps.memories.add({
          atMinute: deps.now(),
          kind: "discovery",
          summary: `${seed.summary} (heard from ${teller.givenName})`,
          participants: [contact, seed.subject],
          tags: ["rumor", ...seed.tags],
          salience,
          valence: seed.valence,
        });

        // Hearing it changes how the listener regards the subject.
        deps.relationships.apply(contact, seed.subject, {
          respect: -seed.valence * 4 * salience,
          trust: -Math.max(0, seed.valence) * 3 * salience,
          resentment: Math.max(0, -seed.valence) * 4 * salience,
        }, deps.now());

        if (contact === deps.playerId) {
          reachingPlayer = true;
          reputationDelta += seed.valence * salience * 10;
        }

        if (node.hop + 1 < MAX_HOPS && salience > 0.05) {
          next.push({ id: contact, salience, hop: node.hop + 1 });
        }
      }
    }

    frontier = next;
  }

  if (heardBy.length > 0) {
    deps.log({
      kind: "gossip",
      summary: `${seed.summary} — ${heardBy.length} person/people heard it${reachingPlayer ? ", including you" : ""}.`,
      participants: [seed.subject, ...heardBy],
      gated: false,
    });
  }

  return { heardBy, reachingPlayer, reputationDelta };
}

function contactsOf(store: RelationshipStore, id: NpcId): NpcId[] {
  const out: NpcId[] = [];
  for (const rel of store.all()) {
    if (rel.a === id) out.push(rel.b);
    else if (rel.b === id) out.push(rel.a);
  }
  return out;
}
