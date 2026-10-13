/**
 * Small deterministic RNG (mulberry32). Deterministic given a seed so games
 * are reproducible in tests; production seeds come from fresh randomness.
 */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive the next seed in a chain, so a rematch deals a different game. */
export function nextSeed(seed: number): number {
  return Math.floor(makeRng(seed)() * 2 ** 31);
}

/** Fisher-Yates shuffle returning a new array. Fair and unbiased. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Pick one item uniformly at random. */
export function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}
