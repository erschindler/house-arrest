/**
 * Memory store (Section 4: "memory", Section 7: survivors carry trauma for years).
 *
 * Memories are world-level records with a participant list; recall is a filtered,
 * salience-weighted query. Salience decays, so what happened last week outranks
 * what happened two months ago unless it was severe — severity is capped but
 * never fully forgotten, which is what lets old violence and old betrayals keep
 * shaping behavior.
 */

import type { Memory, MemoryKind, NpcId } from "./types.ts";

export type MemoryInput = Omit<Memory, "id">;

const PRUNE_THRESHOLD = 0.02;
const DECAY_PER_DAY = 0.985;

export class MemoryStore {
  private items: Memory[] = [];
  private counter = 0;

  constructor(items: Memory[] = []) {
    this.items = items.slice();
    this.counter = items.length;
  }

  add(input: MemoryInput): Memory {
    this.counter += 1;
    const memory: Memory = { ...input, id: `mem-${this.counter}` };
    this.items.push(memory);
    return memory;
  }

  all(): Memory[] {
    return this.items;
  }

  count(): number {
    return this.items.length;
  }

  get(id: string): Memory | undefined {
    return this.items.find((m) => m.id === id);
  }

  /** Recall by participant and optional tag filter, strongest first. */
  recall(npcId: NpcId, options: { tags?: string[]; kinds?: MemoryKind[]; limit?: number } = {}): Memory[] {
    const { tags, kinds, limit = 10 } = options;
    const matches = this.items.filter((m) => {
      if (!m.participants.includes(npcId)) return false;
      if (kinds && !kinds.includes(m.kind)) return false;
      if (tags && tags.length > 0 && !tags.some((tag) => m.tags.includes(tag))) return false;
      return true;
    });
    matches.sort((x, y) => strength(y) - strength(x));
    return matches.slice(0, limit);
  }

  /** Capped aggregate of a subject's memories of a target — feeds suspicion and trust. */
  opinionOf(npcId: NpcId, subjectId: NpcId): { valence: number; count: number } {
    let weighted = 0;
    let total = 0;
    let count = 0;
    for (const m of this.items) {
      if (!m.participants.includes(npcId) || !m.participants.includes(subjectId)) continue;
      if (m.participants.length !== 2) continue;
      weighted += m.valence * m.salience;
      total += m.salience;
      count += 1;
    }
    return { valence: total === 0 ? 0 : weighted / total, count };
  }

  decayDaily(): void {
    const survivors: Memory[] = [];
    for (const m of this.items) {
      m.salience *= DECAY_PER_DAY;
      // Severe memories decay to a floor instead of vanishing.
      if (m.salience < PRUNE_THRESHOLD && Math.abs(m.valence) < 0.6) continue;
      survivors.push(m);
    }
    this.items = survivors;
  }

  /** Serialization keeps the id counter so restored ids never collide. */
  snapshotItems(): Memory[] {
    return this.items;
  }

  snapshotCounter(): number {
    return this.counter;
  }

  static fromSnapshot(items: Memory[], counter: number): MemoryStore {
    const store = new MemoryStore(items);
    store.counter = Math.max(counter, items.length);
    return store;
  }
}

export function strength(memory: Memory): number {
  return memory.salience;
}
