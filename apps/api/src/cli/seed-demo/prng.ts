/**
 * Seeded PRNG for the demo seed: every fresh run draws the same sequence, so the
 * demo laboratory always has the same customers, instruments and readings.
 * mulberry32 is tiny and good enough for fixture data (not for anything secret).
 */
export type Rng = {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Approximately N(mean, sd), via Box-Muller. */
  normal(mean: number, sd: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Weighted pick: `weights[i]` is the relative weight of `items[i]`. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** New array, Fisher-Yates shuffled. */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * Independent generator derived from this one's seed and a label. Each seed
   * step forks its own, so skipping work on a re-run (idempotence) never shifts
   * the draws of the steps after it.
   */
  fork(label: string): Rng;
};

/** Hash a string seed to a 32-bit integer (FNV-1a). */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRng(seed: string | number): Rng {
  const seedText = String(seed);
  let state = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number =>
    min + Math.floor(next() * (max - min + 1));

  const float = (min: number, max: number): number =>
    min + next() * (max - min);

  const normal = (mean: number, sd: number): number => {
    const u1 = Math.max(next(), Number.EPSILON);
    const u2 = next();
    return (
      mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    );
  };

  const pick = <T>(items: readonly T[]): T => {
    const item = items[int(0, items.length - 1)];
    if (item === undefined) throw new Error("pick() from an empty list");
    return item;
  };

  const weighted = <T>(items: readonly T[], weights: readonly number[]): T => {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let threshold = next() * total;
    for (let i = 0; i < items.length; i += 1) {
      threshold -= weights[i] ?? 0;
      if (threshold < 0) {
        const item = items[i];
        if (item !== undefined) return item;
      }
    }
    const last = items[items.length - 1];
    if (last === undefined) throw new Error("weighted() from an empty list");
    return last;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      const a = copy[i];
      const b = copy[j];
      if (a === undefined || b === undefined) continue;
      copy[i] = b;
      copy[j] = a;
    }
    return copy;
  };

  return {
    next,
    int,
    float,
    normal,
    chance: (probability) => next() < probability,
    pick,
    weighted,
    shuffle,
    fork: (label) => createRng(`${seedText}/${label}`),
  };
}
