import { getSettings } from "../settings";

/**
 * The table's sound effects, synthesised with WebAudio: no files to fetch or
 * cache, a few hundred bytes of code, and every sound follows the volume.
 *
 * One AudioContext for the whole app. Browsers (iOS above all) only let one
 * start from a tap, so `unlockAudio` runs from the first pointer or key press
 * and again from the Sound toggle; until then, and whenever Sound is off
 * (the default) or the page is hidden, every call is a no-op.
 *
 * The scenes call these from the Animator's stock moves (deal, flip, chips),
 * the roulette wheel and the reels; useHand plays `win` when a result lands.
 */
export type Sfx = "card" | "flip" | "chip" | "reel" | "win" | "bigWin" | "jackpot";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

/** Creates or resumes the context. Call from a user gesture. */
export function unlockAudio(): void {
  if (!getSettings().sound) return;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Unlocks on the first press anywhere, then keeps listening in case Sound is turned on later. */
export function installAudioUnlock(): void {
  const onGesture = () => unlockAudio();
  window.addEventListener("pointerdown", onGesture, { passive: true });
  window.addEventListener("keydown", onGesture);
}

/** The context and its start time `delayMs` from now, or null when nothing should sound. */
function ready(delayMs = 0): { ac: AudioContext; out: GainNode; t: number } | null {
  const s = getSettings();
  if (!s.sound || !ctx || !master || ctx.state !== "running" || document.hidden) return null;
  master.gain.value = s.volume;
  return { ac: ctx, out: master, t: ctx.currentTime + Math.max(0, delayMs) / 1000 };
}

/** A decaying envelope on a new gain node feeding `out`. */
function envelope(ac: AudioContext, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

/** Filtered noise: a card's slide, a flick, the click of a chip's edge. */
function hiss(ac: AudioContext, out: AudioNode, t: number, o: { freq: number; q: number; peak: number; decay: number; sweep?: number }) {
  const src = ac.createBufferSource();
  src.buffer = noise;
  const f = ac.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = o.q;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.sweep) f.frequency.exponentialRampToValueAtTime(o.sweep, t + o.decay);
  src.connect(f).connect(envelope(ac, out, t, o.peak, 0.004, o.decay));
  src.start(t, Math.random() * 0.3);
  src.stop(t + o.decay + 0.05);
}

function tone(ac: AudioContext, out: AudioNode, t: number, o: { freq: number; to?: number; type?: OscillatorType; peak: number; decay: number }) {
  const osc = ac.createOscillator();
  osc.type = o.type ?? "triangle";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.decay);
  osc.connect(envelope(ac, out, t, o.peak, 0.005, o.decay));
  osc.start(t);
  osc.stop(t + o.decay + 0.05);
}

const jitter = (x: number, by = 0.08) => x * (1 + (Math.random() * 2 - 1) * by);

/** Plays one effect, `delayMs` from now (an animation's delay, already scaled). */
export function play(name: Sfx, delayMs = 0): void {
  const r = ready(delayMs);
  if (!r) return;
  const { ac, out, t } = r;
  switch (name) {
    case "card":
      hiss(ac, out, t, { freq: jitter(2600), q: 0.9, peak: 0.35, decay: 0.09, sweep: 1400 });
      break;
    case "flip":
      hiss(ac, out, t, { freq: jitter(4200), q: 1.4, peak: 0.25, decay: 0.035 });
      break;
    case "chip":
      tone(ac, out, t, { freq: jitter(2400, 0.05), type: "sine", peak: 0.18, decay: 0.05 });
      tone(ac, out, t + 0.028, { freq: jitter(3300, 0.05), type: "sine", peak: 0.12, decay: 0.04 });
      hiss(ac, out, t, { freq: 5000, q: 2, peak: 0.12, decay: 0.02 });
      break;
    case "reel":
      tone(ac, out, t, { freq: 150, to: 55, type: "sine", peak: 0.45, decay: 0.12 });
      hiss(ac, out, t, { freq: 1800, q: 1, peak: 0.15, decay: 0.03 });
      break;
    case "win":
    case "bigWin": {
      const notes = name === "win" ? [523.25, 659.25, 783.99] : [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((f, i) => tone(ac, out, t + i * 0.085, { freq: f, peak: 0.22, decay: 0.32 }));
      break;
    }
    case "jackpot":
      for (let rep = 0; rep < 3; rep++) {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ac, out, t + rep * 0.55 + i * 0.09, { freq: f, peak: 0.24, decay: 0.4 }));
      }
      for (let i = 0; i < 14; i++) tone(ac, out, t + 0.2 + i * 0.11, { freq: jitter(2093, 0.15), type: "sine", peak: 0.06, decay: 0.5 });
      break;
  }
}

/**
 * The ball running round a roulette wheel for `durationMs`: clicks on the
 * frets, slowing down as the wheel does, then a few bounces into the pocket.
 */
export function wheel(durationMs: number): void {
  const r = ready();
  if (!r) return;
  const { ac, out, t } = r;
  const total = durationMs / 1000;
  let at = 0;
  let gap = 0.045;
  while (at < total * 0.92) {
    hiss(ac, out, t + at, { freq: jitter(3800, 0.1), q: 3, peak: 0.08 + 0.1 * (at / total), decay: 0.018 });
    at += gap;
    gap *= 1.035;
  }
  for (let i = 0; i < 3; i++) tone(ac, out, t + total * 0.9 + i * 0.09 * (1 - i * 0.2), { freq: 1700, type: "sine", peak: 0.14 / (i + 1), decay: 0.05 });
}
