/**
 * Deterministic, serializable PRNG (mulberry32). The entire RNG state is a
 * single uint32 stored in the game state, so the same seed + same inputs
 * always reproduce the same game. Never use Math.random() in the core.
 */
export interface RngState {
  s: number;
}

export function makeRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Advances the RNG state in place and returns a float in [0, 1). */
export function nextFloat(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function nextInt(rng: RngState, n: number): number {
  return Math.floor(nextFloat(rng) * n);
}
