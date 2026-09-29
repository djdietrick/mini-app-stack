import {
  type NoteEvent,
  NoteTracker,
  PitchDetector,
  nearestNote,
  rms,
} from "../../../src/theory/index.js";
import { getSettings } from "../settings";
import { type Capture, MIC_CONSTRAINTS, openCapture } from "./capture";

/**
 * One microphone for the whole app. Screens use it through useNoteStream();
 * this module owns the AudioContext, the detector and the tracker, and the
 * mic is released once no screen is using it.
 *
 * Audio never leaves the browser: frames go from the worklet to the detector
 * and are dropped. Only note events and a live pitch come out.
 *
 * Taps on the fretboard enter the same stream (`tap`), so an engine grades
 * one kind of event whether or not the mic is on. That is the fallback when
 * the mic is denied or unsupported, and what demos and e2e tests drive.
 */

export type MicStatus = "idle" | "asking" | "listening" | "denied" | "unsupported";

export interface LivePitch {
  freq: number;
  midi: number;
  cents: number;
  clarity: number;
}

export interface StreamNote extends NoteEvent {
  source: "mic" | "tap";
  /** Where a tap landed on the neck. Never set for the mic, which hears pitch, not position. */
  position?: { string: number; fret: number };
}

export interface NoteStreamState {
  status: MicStatus;
  /** Why the last start failed or the mic stopped, in words for the player. */
  error?: string;
  /** The pitch being played now, for the tuner. Null between notes. */
  live: LivePitch | null;
  /** Input level (RMS of the newest audio), 0–1. */
  level: number;
  mode?: Capture["mode"];
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
}

function supported(): boolean {
  return !!navigator.mediaDevices?.getUserMedia && !!audioContextCtor() && window.isSecureContext;
}

let state: NoteStreamState = { status: supported() ? "idle" : "unsupported", live: null, level: 0 };
const stateListeners = new Set<() => void>();
const noteListeners = new Set<(n: StreamNote) => void>();

let ctx: AudioContext | null = null;
let media: MediaStream | null = null;
let capture: Capture | null = null;
let detector: PitchDetector | null = null;
let tracker: { t: NoteTracker; a4: number; gate: number } | null = null;
let lastPitchAt = 0;
let pending: NoteStreamState | null = null;
let frameRequested = false;
/** Bumped by stop(), so a start() still awaiting permission knows it was cancelled. */
let generation = 0;

/** How long the tuner keeps showing a pitch through unpitched frames. */
const LIVE_HOLD_MS = 250;

function set(patch: Partial<NoteStreamState>, immediate = true): void {
  if (immediate) {
    state = { ...(pending ?? state), ...patch };
    pending = null;
    stateListeners.forEach((l) => l());
    return;
  }
  // Frame-rate updates (level, live pitch) coalesce to one render per animation frame.
  pending = { ...(pending ?? state), ...patch };
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    if (!pending) return;
    state = pending;
    pending = null;
    stateListeners.forEach((l) => l());
  });
}

function emit(note: StreamNote): void {
  noteListeners.forEach((l) => l(note));
}

function onFrame(frame: Float32Array): void {
  if (!detector) return;
  const { a4, gate } = getSettings();
  if (!tracker || tracker.a4 !== a4 || tracker.gate !== gate) {
    tracker = { t: new NoteTracker({ a4, gate }), a4, gate };
  }
  const now = performance.now();
  const pitch = detector.detect(frame);
  const level = rms(frame, frame.length / 2);
  const ev = tracker.t.push({ pitch, rms: level, at: now });
  if (ev) emit({ ...ev, source: "mic" });

  let live = (pending ?? state).live;
  if (pitch && level >= gate * 0.6) {
    const { midi, cents } = nearestNote(pitch.freq, a4);
    live = { freq: pitch.freq, midi, cents, clarity: pitch.clarity };
    lastPitchAt = now;
  } else if (now - lastPitchAt > LIVE_HOLD_MS) {
    live = null;
  }
  set({ level, live }, false);
}

function describeError(err: unknown): Pick<NoteStreamState, "status" | "error"> {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return { status: "denied" };
    case "NotFoundError":
    case "OverconstrainedError":
    case "DevicesNotFoundError":
      return { status: "unsupported", error: "No microphone was found on this device." };
    case "NotReadableError":
    case "AbortError":
      return { status: "idle", error: "The microphone is busy. Close any other app using it, then try again." };
    default:
      return { status: "idle", error: "The microphone could not start. Try again." };
  }
}

/**
 * Must be called from a user gesture (a tap): iOS Safari only lets an
 * AudioContext start inside one, so the context is created before the first
 * await.
 */
export async function start(): Promise<void> {
  if (state.status === "listening" || state.status === "asking") return;
  const Ctor = audioContextCtor();
  if (!supported() || !Ctor) {
    set({ status: "unsupported" });
    return;
  }
  const gen = ++generation;
  ctx = new Ctor({ latencyHint: "interactive" });
  void ctx.resume();
  set({ status: "asking", error: undefined });

  try {
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    if (gen !== generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    media = stream;
    const c = await openCapture(ctx, stream, onFrame);
    if (gen !== generation) {
      c.stop();
      return;
    }
    capture = c;
    detector = new PitchDetector(c.frameSize, { sampleRate: c.sampleRate });
    tracker = null;
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (gen !== generation) return;
      stop();
      set({ error: "The microphone stopped. Tap to turn it back on." });
    });
    set({ status: "listening", mode: c.mode });
  } catch (err) {
    if (gen !== generation) return;
    teardown();
    set({ ...describeError(err), live: null, level: 0 });
  }
}

function teardown(): void {
  capture?.stop();
  capture = null;
  media?.getTracks().forEach((t) => t.stop());
  media = null;
  void ctx?.close().catch(() => undefined);
  ctx = null;
  detector = null;
  tracker = null;
}

/** Releases the mic, so the browser's recording indicator goes away. */
export function stop(): void {
  generation++;
  teardown();
  set({
    status: state.status === "unsupported" || state.status === "denied" ? state.status : "idle",
    live: null,
    level: 0,
    mode: undefined,
  });
}

/** A note from the tap fallback, graded exactly like one from the mic. */
export function tap(midi: number, position?: { string: number; fret: number }): void {
  emit({ midi, cents: 0, at: performance.now(), source: "tap", position });
}

export function getState(): NoteStreamState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function onNote(listener: (n: StreamNote) => void): () => void {
  noteListeners.add(listener);
  return () => noteListeners.delete(listener);
}

// iOS suspends the context when the page is hidden; pick it back up on return.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && ctx?.state !== "running") void ctx?.resume();
});

// Show "denied" before the first tap when the browser already knows.
void navigator.permissions
  ?.query({ name: "microphone" as PermissionName })
  .then((p) => {
    const apply = () => {
      if (p.state === "denied" && state.status === "idle") set({ status: "denied" });
      if (p.state !== "denied" && state.status === "denied") set({ status: "idle" });
    };
    apply();
    p.onchange = apply;
  })
  .catch(() => undefined);
