/**
 * Seeded, serializable PRNG.
 *
 * Every stochastic decision in the simulation draws from here, and the state is
 * part of the world save. That gives us two things the design document asks for:
 * deterministic fallbacks (Section 16/18.14) and a complete save/restore of the
 * simulated world (18.13). No subsystem may use Math.random() or Date.now().
 */

export type RngState = { a: number; b: number; c: number; d: number };

export type Weighted<T> = { item: T; weight: number };

export type Rng = {
  readonly seed: number;
  next(): number;
  int(minInclusive: number, maxInclusive: number): number;
  index(length: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly Weighted<T>[]): T;
  getState(): RngState;
  setState(state: RngState): void;
};

/** FNV-1a, 32-bit. Used for string seeds and for world hashing. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Fisher-Yates using the seeded rng. A random comparator passed to sort() is not deterministic. */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng.index(i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** sfc32: small, fast, good enough for simulation, trivially serializable. */
export function createRng(seed: number | string): Rng {
  const seedNumber = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  let a = (seedNumber ^ 0x9e3779b9) >>> 0;
  let b = (seedNumber ^ 0x85ebca6b) >>> 0;
  let c = (seedNumber ^ 0xc2b2ae35) >>> 0;
  let d = (seedNumber + 0x6a09e667) >>> 0;
  if ((a | b | c | d) === 0) a = 1;

  const next = (): number => {
    let t = (a + b) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    d = (d + 1) >>> 0;
    t = (t + d) >>> 0;
    c = (c + t) >>> 0;
    return t / 4294967296;
  };

  // Discard the first outputs; sfc32 needs a little warm-up from raw seeds.
  for (let i = 0; i < 12; i += 1) next();

  const rng: Rng = {
    seed: seedNumber,
    next,
    int(minInclusive: number, maxInclusive: number): number {
      if (maxInclusive <= minInclusive) return minInclusive;
      return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
    },
    index(length: number): number {
      return length <= 0 ? 0 : Math.floor(next() * length);
    },
    chance(probability: number): boolean {
      return next() < probability;
    },
    pick(items) {
      if (items.length === 0) throw new Error("pick() called with an empty list");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted(items) {
      if (items.length === 0) throw new Error("weighted() called with an empty list");
      const total = items.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
      if (total <= 0) return items[0].item;
      let roll = next() * total;
      for (const entry of items) {
        roll -= Math.max(0, entry.weight);
        if (roll <= 0) return entry.item;
      }
      return items[items.length - 1].item;
    },
    getState(): RngState {
      return { a, b, c, d };
    },
    setState(state: RngState): void {
      a = state.a >>> 0;
      b = state.b >>> 0;
      c = state.c >>> 0;
      d = state.d >>> 0;
    },
  };

  return rng;
}
