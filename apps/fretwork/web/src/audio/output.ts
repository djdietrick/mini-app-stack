import { type ClickClock, dueClicks, startClock } from "../../../src/practice/metronome.js";
import { midiToFreq, pitchClass } from "../../../src/theory/index.js";
import { getSettings, onSettings } from "../settings";
import { currentAudio, setAudioSession, unlockAudio } from "./context";
import { getState as micState, holdInput } from "./noteStream";

/**
 * Everything Fretwork plays: prompt tones, the metronome click and a drone,
 * on the AudioContext the mic uses (context.ts), through one master gain that
 * follows the volume and mute settings.
 *
 * **Self-hearing.** The mic would grade the app's own notes. What each sound
 * does about it:
 *
 * - Prompt tones hold the mic deaf (noteStream.holdInput) while they sound,
 *   plus a short tail for the room and the output latency. The player is
 *   listening then anyway. The "headphones" setting turns the hold off, since
 *   the mic can't hear headphones; that is also how to check a tone's tuning
 *   with the app's own tuner.
 * - The click is a 30 ms blip at 1.7–2.2 kHz: above the detector's range
 *   (70–1400 Hz) and shorter than the 60 ms a note must hold to fire. It is
 *   never gated, so notes played on the beat still count.
 * - The drone sustains, so a gate can't work around it. It is meant for
 *   headphones, and the screens that offer it say so.
 */

let master: { ctx: AudioContext; gain: GainNode } | null = null;

/** Seconds of silence after a prompt tone before the mic listens again. */
const TAIL = 0.15;
/** How far ahead of the audio clock the metronome schedules, and how often it wakes. */
const LOOKAHEAD = 0.12;
const TICK_MS = 25;

function masterLevel(): number {
  const { volume, muted } = getSettings();
  return muted ? 0 : volume;
}

function bus(ctx: AudioContext): GainNode {
  if (master?.ctx !== ctx) {
    const gain = ctx.createGain();
    gain.gain.value = masterLevel();
    gain.connect(ctx.destination);
    master = { ctx, gain };
  }
  return master.gain;
}

/** Seconds between scheduling a sound and hearing it. */
function latency(ctx: AudioContext): number {
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
}

/**
 * Gets sound going. Call it from a tap: iOS only starts audio in a user
 * gesture. Returns null where Web Audio is missing.
 */
export function unlockOutput(): AudioContext | null {
  const mic = micState().status;
  if (mic !== "listening" && mic !== "asking") setAudioSession("playback");
  return unlockAudio();
}

// ---------- tones ----------

export interface ToneOptions {
  /** Seconds between note starts. */
  gap?: number;
  /** Seconds each note rings. */
  duration?: number;
}

/**
 * Plays notes one after another with a plucked-string envelope: a sawtooth
 * for the harmonics plus a sine to anchor the fundamental, through a low-pass
 * that closes as the note decays. Oscillators are exactly in tune at the
 * player's A4, which a Karplus–Strong delay line is not without fractional
 * delay. Holds the mic deaf until the last note has died away.
 *
 * Plays nothing (and returns false) where Web Audio is missing. When no tap
 * has unlocked sound yet, check `audioRunning()` first and offer a button.
 */
export function playNotes(midis: readonly number[], { gap = 0.6, duration = 1.1 }: ToneOptions = {}): boolean {
  const ctx = unlockOutput();
  if (!ctx || !midis.length) return false;
  const out = bus(ctx);
  const { a4, headphones } = getSettings();
  const t0 = ctx.currentTime + 0.03;
  midis.forEach((midi, i) => pluck(ctx, out, midiToFreq(midi, a4), t0 + i * gap, duration));
  const end = t0 + (midis.length - 1) * gap + duration;
  if (!headphones && masterLevel() > 0) {
    holdInput(performance.now() + (end - ctx.currentTime + latency(ctx) + TAIL) * 1000);
  }
  return true;
}

function pluck(ctx: AudioContext, out: AudioNode, freq: number, at: number, duration: number): void {
  const saw = ctx.createOscillator();
  saw.type = "sawtooth";
  saw.frequency.value = freq;
  const sine = ctx.createOscillator();
  sine.frequency.value = freq;
  const sineLevel = ctx.createGain();
  sineLevel.gain.value = 0.6;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(Math.min(freq * 10, 12000), at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.5, 220), at + Math.min(0.5, duration));

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.linearRampToValueAtTime(0.32, at + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  saw.connect(filter);
  sine.connect(sineLevel).connect(filter);
  filter.connect(amp).connect(out);
  for (const o of [saw, sine]) {
    o.start(at);
    o.stop(at + duration + 0.05);
  }
  saw.onended = () => amp.disconnect();
}

// ---------- drone ----------

let drone: { ctx: AudioContext; oscs: OscillatorNode[]; level: GainNode } | null = null;

function droneGain(): number {
  return getSettings().droneLevel * 0.25;
}

/**
 * A sustained root and fifth in the guitar's lowest octave (E2 up), until
 * stopDrone. Call it from a tap. For headphones: the mic hears it too.
 */
export function startDrone(rootPc: number): boolean {
  stopDrone();
  const ctx = unlockOutput();
  if (!ctx) return false;
  const root = 40 + pitchClass(rootPc - 40);
  const { a4 } = getSettings();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  filter.Q.value = 0.5;
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.0001, ctx.currentTime);
  level.gain.linearRampToValueAtTime(droneGain(), ctx.currentTime + 0.4);
  filter.connect(level).connect(bus(ctx));
  const oscs = [root, root + 7].map((midi) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = midiToFreq(midi, a4);
    o.connect(filter);
    o.start();
    return o;
  });
  drone = { ctx, oscs, level };
  return true;
}

export function stopDrone(): void {
  if (!drone) return;
  const { ctx, oscs, level } = drone;
  drone = null;
  const t = ctx.currentTime;
  level.gain.cancelScheduledValues(t);
  level.gain.setValueAtTime(level.gain.value, t);
  level.gain.linearRampToValueAtTime(0.0001, t + 0.3);
  for (const o of oscs) o.stop(t + 0.35);
  oscs[0].onended = () => level.disconnect();
}

// ---------- metronome ----------

/**
 * A click on the look-ahead pattern: a timer wakes every 25 ms and schedules
 * the beats due in the next 120 ms on the audio clock (the timing itself is
 * src/practice/metronome.ts, node-tested). `onBeat` fires as each beat is
 * heard, for a visual pulse; the sound never waits on it.
 */
export class Metronome {
  onBeat: ((beat: number, accent: boolean) => void) | null = null;
  private clock: ClickClock | null = null;
  private timer: number | undefined;
  private visuals = new Set<number>();
  private bpm = 80;

  constructor(private readonly beatsPerBar = 4) {}

  get running(): boolean {
    return this.clock !== null;
  }

  /** Call it from a tap, or once something else has unlocked sound. */
  start(bpm: number): boolean {
    this.stop();
    const ctx = unlockOutput();
    if (!ctx) return false;
    this.bpm = bpm;
    this.clock = startClock(ctx.currentTime, 0.1);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
    return true;
  }

  /** Takes effect from the next beat not yet scheduled. */
  setBpm(bpm: number): void {
    this.bpm = bpm;
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.clock = null;
    this.visuals.forEach((id) => window.clearTimeout(id));
    this.visuals.clear();
  }

  private tick(): void {
    const ctx = currentAudio();
    if (!ctx || !this.clock) return;
    const now = ctx.currentTime;
    const { clicks, clock } = dueClicks(this.clock, this.bpm, now, now + LOOKAHEAD, this.beatsPerBar);
    this.clock = clock;
    const out = bus(ctx);
    for (const c of clicks) {
      click(ctx, out, c.time, c.accent);
      const id = window.setTimeout(
        () => {
          this.visuals.delete(id);
          this.onBeat?.(c.beat, c.accent);
        },
        Math.max(0, (c.time - now + latency(ctx)) * 1000),
      );
      this.visuals.add(id);
    }
  }
}

function click(ctx: AudioContext, out: AudioNode, at: number, accent: boolean): void {
  const o = ctx.createOscillator();
  o.frequency.value = accent ? 2200 : 1700;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, at + 0.001);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
  o.connect(amp).connect(out);
  o.start(at);
  o.stop(at + 0.04);
  o.onended = () => amp.disconnect();
}

// Volume, mute and drone level follow the settings as they change.
onSettings(() => {
  if (master) master.gain.gain.setTargetAtTime(masterLevel(), master.ctx.currentTime, 0.02);
  if (drone) drone.level.gain.setTargetAtTime(droneGain(), drone.ctx.currentTime, 0.05);
});
