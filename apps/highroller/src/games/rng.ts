/**
 * Randomness, as a port. The server injects one built on `crypto.randomInt`
 * (src/cryptoRng.ts, wired at the entrypoints); tests use `seededRng` so a
 * hand can be replayed exactly. Nothing in src/games or src/domain draws a
 * random number any other way.
 */
export interface Rng {
  /** A uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/**
 * mulberry32: small, fast and good enough for tests and simulations. Never
 * used to deal a real hand.
 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError(`bad bound ${maxExclusive}`);
      return Math.floor(next() * maxExclusive);
    },
  };
}

/** Fisher–Yates. Returns a new array; the input is left as it was. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The first `k` cards of a uniformly shuffled `items`, by a partial
 * Fisher–Yates: k draws instead of items.length. Games that need only the top
 * of a shoe (blackjack keeps 80 of 312) take this rather than a full shuffle.
 */
export function sample<T>(items: readonly T[], k: number, rng: Rng): T[] {
  if (k > items.length) throw new RangeError(`can't take ${k} of ${items.length}`);
  const out = items.slice();
  for (let i = 0; i < k; i++) {
    const j = i + rng.int(out.length - i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, k);
}
