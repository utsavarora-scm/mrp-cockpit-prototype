/**
 * Deterministic randomness.
 *
 * Every random number in the dataset comes from here, seeded once. Two runs on
 * two machines produce byte-identical data, which is what makes the demo
 * rehearsable — nothing on screen can change between the practice run and the
 * real one.
 *
 * Streams are derived from a label rather than shared, so tuning one part of the
 * generator (say, demand volumes) does not shift every item id downstream of it.
 * That property matters a great deal while calibrating.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** Uniform pick. Throws on an empty list rather than returning undefined. */
  pick<T>(items: readonly T[]): T;
  /** Weighted pick, weights need not be normalised. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Fisher–Yates, returning a new array. */
  shuffle<T>(items: readonly T[]): T[];
  /** Normal deviate via Box–Muller, clamped to ±4σ so outliers stay plausible. */
  normal(mean: number, stdDev: number): number;
}

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick() called on an empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted: (items, weights) => {
      if (items.length === 0) throw new Error('weighted() called on an empty list');
      let total = 0;
      for (const weight of weights) total += weight;
      let roll = next() * total;
      for (let i = 0; i < items.length; i += 1) {
        roll -= weights[i] ?? 0;
        if (roll <= 0) return items[i] as (typeof items)[number];
      }
      return items[items.length - 1] as (typeof items)[number];
    },
    shuffle: (items) => {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i] as (typeof copy)[number];
        copy[i] = copy[j] as (typeof copy)[number];
        copy[j] = a;
      }
      return copy;
    },
    normal: (mean, stdDev) => {
      const u = Math.max(next(), 1e-12);
      const v = next();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return mean + stdDev * Math.max(-4, Math.min(4, z));
    },
  };

  return rng;
}

/** FNV-1a, so a stream label maps to a stable 32-bit offset. */
function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Independent, reproducible stream per named section of the generator. */
export function streamFactory(masterSeed: number): (label: string) => Rng {
  return (label: string) => mulberry32((masterSeed ^ hashLabel(label)) >>> 0);
}
