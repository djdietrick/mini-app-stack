/**
 * Synthetic guitar-ish signals for the detector and tracker tests. Seeded, so
 * a failure reproduces. Not exported from the theory index: tests only.
 */

export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sine(freq: number, sampleRate: number, length: number, amp = 0.5): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

/** Sum of harmonics with the given amplitudes (index 0 is the fundamental). */
export function harmonics(freq: number, amps: number[], sampleRate: number, length: number): Float32Array {
  const out = new Float32Array(length);
  amps.forEach((a, k) => {
    const f = freq * (k + 1);
    if (f >= sampleRate / 2) return;
    const phase = k * 0.7;
    for (let i = 0; i < length; i++) out[i] += a * Math.sin((2 * Math.PI * f * i) / sampleRate + phase);
  });
  return out;
}

/** Band-limited sawtooth: every harmonic, falling as 1/k. */
export function sawtooth(freq: number, sampleRate: number, length: number, amp = 0.4): Float32Array {
  const amps: number[] = [];
  for (let k = 1; freq * k < sampleRate / 2; k++) amps.push(amp / k);
  return harmonics(freq, amps, sampleRate, length);
}

export function noise(length: number, amp: number, seed = 1): Float32Array {
  const r = prng(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = amp * (r() * 2 - 1);
  return out;
}

/**
 * A Karplus–Strong plucked string. The two-point average in the loop adds
 * half a sample of delay, so the loop length is chosen to make N + 0.5 match
 * the requested pitch; `freq` on the result is the pitch actually produced.
 */
export function pluck(
  freq: number,
  sampleRate: number,
  length: number,
  opts: { seed?: number; loss?: number; amp?: number } = {},
): { samples: Float32Array; freq: number } {
  const N = Math.max(2, Math.round(sampleRate / freq - 0.5));
  const r = prng(opts.seed ?? 7);
  const loss = opts.loss ?? 0.996;
  const amp = opts.amp ?? 0.5;
  const out = new Float32Array(length);
  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = amp * (r() * 2 - 1);
  let prev = 0;
  for (let i = 0; i < length; i++) {
    const idx = i % N;
    const cur = line[idx];
    out[i] = cur;
    line[idx] = loss * 0.5 * (cur + prev);
    prev = cur;
  }
  return { samples: out, freq: sampleRate / (N + 0.5) };
}
