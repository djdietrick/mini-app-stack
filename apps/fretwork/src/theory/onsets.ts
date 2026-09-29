import { A4_HZ, freqToMidi } from "./notes.js";
import type { PitchEstimate } from "./pitch.js";

/**
 * Turns per-frame pitch estimates into note events: one event per note
 * played, not one per frame. Pure, like the detector; the SPA feeds it a
 * frame every 10 ms or so, and tests feed it synthetic plucks.
 *
 * - A noise gate on RMS, with hysteresis so a note dying away around the
 *   threshold does not flicker open and shut.
 * - A note fires once its pitch has held within ±`toleranceCents` of one
 *   semitone for `holdMs`, which rides out the pick's noisy attack.
 * - It does not fire again while the same note rings out.
 * - A re-attack of the same note (RMS jumping `reattackRatio` above the
 *   quietest it has been since the last event) arms it to fire again, so
 *   repeated notes count.
 *
 * Events carry pitch only. The string is unknowable from audio (see
 * fretboard.ts); engines decide what counts as correct.
 */

export interface NoteEvent {
  midi: number;
  /** How far off the equal-tempered note, averaged over the hold. */
  cents: number;
  /** Time the note settled, in the caller's clock (ms). */
  at: number;
}

export interface TrackerFrame {
  pitch: PitchEstimate | null;
  /** Level of the newest audio, 0–1. Keep the window short so attacks show. */
  rms: number;
  /** Time of the frame in ms. */
  at: number;
}

export interface NoteTrackerOptions {
  a4?: number;
  /** RMS that opens the gate. */
  gate?: number;
  /** RMS below which an open gate closes and the ringing note is forgotten. Default 0.6 × gate. */
  release?: number;
  holdMs?: number;
  toleranceCents?: number;
  reattackRatio?: number;
  /** No re-attack is recognised this soon after an event. */
  refractoryMs?: number;
}

interface Candidate {
  midi: number;
  since: number;
  cents: number[];
}

export class NoteTracker {
  private readonly a4: number;
  private readonly gate: number;
  private readonly release: number;
  private readonly holdMs: number;
  private readonly tolerance: number;
  private readonly reattackRatio: number;
  private readonly refractoryMs: number;

  private open = false;
  private candidate: Candidate | null = null;
  /** The note currently ringing, which must not fire again until re-attacked. */
  private active: number | null = null;
  private trough = Infinity;
  private lastEventAt = -Infinity;

  constructor(options: NoteTrackerOptions = {}) {
    this.a4 = options.a4 ?? A4_HZ;
    this.gate = options.gate ?? 0.01;
    this.release = options.release ?? this.gate * 0.6;
    this.holdMs = options.holdMs ?? 60;
    this.tolerance = (options.toleranceCents ?? 50) / 100;
    this.reattackRatio = options.reattackRatio ?? 1.6;
    this.refractoryMs = options.refractoryMs ?? 100;
  }

  reset(): void {
    this.open = false;
    this.candidate = null;
    this.active = null;
    this.trough = Infinity;
    this.lastEventAt = -Infinity;
  }

  push(frame: TrackerFrame): NoteEvent | null {
    const { pitch, rms, at } = frame;

    if (!this.open) {
      if (rms < this.gate) return null;
      this.open = true;
    } else if (rms < this.release) {
      this.reset();
      return null;
    }

    if (this.active !== null) {
      if (rms > this.trough * this.reattackRatio && at - this.lastEventAt >= this.refractoryMs) {
        this.active = null;
        this.candidate = null;
      } else {
        this.trough = Math.min(this.trough, rms);
      }
    }

    if (!pitch) {
      this.candidate = null;
      return null;
    }

    const exact = freqToMidi(pitch.freq, this.a4);
    const c = this.candidate;
    if (c && Math.abs(exact - c.midi) <= this.tolerance) {
      c.cents.push((exact - c.midi) * 100);
    } else {
      const midi = Math.round(exact);
      this.candidate = { midi, since: at, cents: [(exact - midi) * 100] };
      return null;
    }

    if (at - c.since < this.holdMs || c.midi === this.active) return null;

    this.active = c.midi;
    this.trough = rms;
    this.lastEventAt = at;
    const cents = c.cents.reduce((s, v) => s + v, 0) / c.cents.length;
    return { midi: c.midi, cents, at };
  }
}
