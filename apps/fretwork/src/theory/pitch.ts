/**
 * Monophonic pitch detection with the McLeod Pitch Method (MPM): a normalised
 * square difference function (NSDF) over one frame, then the first "key
 * maximum" within `cutoff` of the highest one. Picking the first near-best
 * peak rather than the best one is what resists the octave errors plain
 * autocorrelation makes on guitar, whose 2nd harmonic is often louder than
 * the fundamental.
 *
 * Pure and dependency-free, so node tests drive it with synthetic signals and
 * the SPA runs the same code on microphone frames. One detector per stream:
 * it reuses its buffers, so a frame every 10 ms makes no garbage.
 *
 * Reference: McLeod & Wyvill, "A Smarter Way to Find Pitch" (ICMC 2005).
 */

export interface PitchEstimate {
  freq: number;
  /** Height of the chosen NSDF peak, 0–1. Pitched notes sit above 0.9; noise well below. */
  clarity: number;
}

export interface PitchOptions {
  sampleRate: number;
  /** Lowest pitch reported. 70 Hz leaves room below drop D (73.4 Hz). */
  minFreq?: number;
  /** Highest pitch reported. Fret 24 on the high E is 1319 Hz. */
  maxFreq?: number;
  /** Frames quieter than this RMS return null without any analysis. */
  minRms?: number;
  /** A frame whose best peak is lower than this is not a pitch: noise, a chord, a pick scrape. */
  minClarity?: number;
  /** MPM's k: the first key maximum at least this fraction of the highest one wins. */
  cutoff?: number;
}

const DEFAULTS = { minFreq: 70, maxFreq: 1400, minRms: 0.001, minClarity: 0.8, cutoff: 0.93 };

export function rms(frame: ArrayLike<number>, start = 0, end = frame.length): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += frame[i] * frame[i];
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

/** Smallest power of two ≥ n. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * A frame size that holds at least three periods of the lowest string at this
 * sample rate: 2048 at 44.1 or 48 kHz, 4096 at 96 kHz.
 */
export function frameSizeFor(sampleRate: number): number {
  return nextPow2(Math.ceil(sampleRate * 0.04));
}

export class PitchDetector {
  readonly sampleRate: number;
  readonly frameSize: number;
  private readonly opts: Required<Omit<PitchOptions, "sampleRate">>;
  private readonly minLag: number;
  private readonly maxLag: number;
  private readonly x: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly nsdf: Float64Array;
  private readonly fft: Fft;

  constructor(frameSize: number, options: PitchOptions) {
    this.sampleRate = options.sampleRate;
    this.frameSize = frameSize;
    this.opts = { ...DEFAULTS, ...stripUndefined(options) };
    this.minLag = Math.max(2, Math.floor(this.sampleRate / this.opts.maxFreq));
    // The NSDF gets unreliable past half the frame: too few samples overlap.
    this.maxLag = Math.min(Math.ceil(this.sampleRate / this.opts.minFreq) + 2, Math.floor(frameSize / 2));
    const n = nextPow2(frameSize * 2);
    this.fft = new Fft(n);
    this.x = new Float64Array(frameSize);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.nsdf = new Float64Array(this.maxLag + 2);
  }

  /** The pitch of one frame, or null for silence, noise and anything unpitched. */
  detect(frame: ArrayLike<number>): PitchEstimate | null {
    const W = this.frameSize;
    if (frame.length < W) throw new Error(`frame has ${frame.length} samples, expected ${W}`);
    const { x, re, im, nsdf } = this;
    const offset = frame.length - W;

    // Remove DC: a mic offset would otherwise read as a huge lag-0 lobe.
    let mean = 0;
    for (let i = 0; i < W; i++) mean += frame[offset + i];
    mean /= W;
    let sumSq = 0;
    for (let i = 0; i < W; i++) {
      const v = frame[offset + i] - mean;
      x[i] = v;
      sumSq += v * v;
    }
    if (Math.sqrt(sumSq / W) < this.opts.minRms) return null;

    // Autocorrelation r'(τ) through the FFT: |X|², transformed again.
    re.fill(0);
    im.fill(0);
    re.set(x);
    this.fft.transform(re, im);
    for (let i = 0; i < re.length; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }
    this.fft.transform(re, im);
    const scale = 1 / re.length;

    // n'(τ) = 2 r'(τ) / m'(τ), where m'(τ) = Σ x_j² + x_{j+τ}² over the overlap.
    let m = 2 * sumSq;
    for (let tau = 0; tau <= this.maxLag; tau++) {
      if (tau > 0) m -= x[tau - 1] * x[tau - 1] + x[W - tau] * x[W - tau];
      nsdf[tau] = m > 1e-12 ? (2 * re[tau] * scale) / m : 0;
    }

    // Key maxima: the highest point of each positive lobe after the lag-0 one.
    let tau = 1;
    while (tau <= this.maxLag && nsdf[tau] > 0) tau++;
    let chosen = -1;
    let highest = 0;
    const peaks: number[] = [];
    while (tau <= this.maxLag) {
      while (tau <= this.maxLag && nsdf[tau] <= 0) tau++;
      let best = -1;
      while (tau <= this.maxLag && nsdf[tau] > 0) {
        if (best < 0 || nsdf[tau] > nsdf[best]) best = tau;
        tau++;
      }
      // A lobe cut off by maxLag has no real peak inside the range.
      if (best >= this.minLag && best < this.maxLag) {
        peaks.push(best);
        highest = Math.max(highest, nsdf[best]);
      }
    }
    if (peaks.length === 0) return null;
    for (const p of peaks) {
      if (nsdf[p] >= this.opts.cutoff * highest) {
        chosen = p;
        break;
      }
    }

    // Parabolic interpolation around the chosen lag, for sub-sample precision.
    const a = nsdf[chosen - 1];
    const b = nsdf[chosen];
    const c = nsdf[chosen + 1];
    const denom = a - 2 * b + c;
    const delta = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
    const clarity = Math.min(1, b - 0.25 * (a - c) * delta);
    if (clarity < this.opts.minClarity) return null;
    const freq = this.sampleRate / (chosen + delta);
    if (freq < this.opts.minFreq || freq > this.opts.maxFreq) return null;
    return { freq, clarity };
  }
}

/** One-off convenience; streams should keep a PitchDetector. */
export function detectPitch(frame: ArrayLike<number>, options: PitchOptions): PitchEstimate | null {
  return new PitchDetector(frame.length, options).detect(frame);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** In-place iterative radix-2 FFT with precomputed twiddles and bit reversal. */
class Fft {
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(private readonly n: number) {
    const bits = Math.log2(n);
    if (!Number.isInteger(bits)) throw new Error("FFT size must be a power of two");
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
  }

  transform(re: Float64Array, im: Float64Array): void {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = cos[k];
          const wi = -sin[k];
          const a = start + j;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}
