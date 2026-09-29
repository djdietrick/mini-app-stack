import type { NoteResult, RespondConfig, RunInput } from "../domain/types.js";
import { type Position, positionsOfMidi, positionsOfPitchClass } from "../theory/fretboard.js";
import { type PitchClass, pitchClass } from "../theory/notes.js";

/**
 * The `respond` engine: flashcards. One prompt at a time, answered by playing
 * (or tapping) it. A pure reducer like find.ts: the SPA supplies timestamps
 * and random numbers in the actions, so tests can replay any deck exactly.
 *
 *   note-on-string   "F♯ on the G string". On one string a pitch occurs once
 *                    per octave, so this is fully checkable: the exact pitch,
 *                    accepting either end of the window's octave (0 or 12).
 *   play-heard-note  the app plays a pitch; the player plays it back.
 *   interval         a root and an interval; two pitches the right distance
 *                    apart, root first, going up.
 *   octave           a note on a string, then its octave on a higher string
 *                    (the 2- and 3-string shapes). The first note is checked
 *                    like note-on-string; the second is exactly 12 above it.
 *   target-degree    a drone sounds a root and fifth; the player lands on a
 *                    degree above the root, in any octave. Notes the drone
 *                    itself sounds are ignored rather than missed, so a
 *                    speaker-played drone the mic picks up costs nothing.
 *
 * The deck is adaptive: each next card is drawn at random, weighted toward
 * cards missed or slow earlier in this deck, and never the same card twice
 * running.
 */

export type Card =
  | { kind: "note-on-string"; pc: PitchClass; string: number; targets: Position[] }
  | { kind: "play-heard-note"; midi: number }
  | { kind: "interval"; root: PitchClass; semitones: number }
  /** `targets`: where the first note is on `string`, each with its octave on a higher string. */
  | { kind: "octave"; pc: PitchClass; string: number; targets: Position[] }
  /** `targets`: every position of the degree in the window, for revealing it. */
  | { kind: "target-degree"; root: PitchClass; semitones: number; targets: Position[] };

export const DEFAULT_INTERVALS: readonly number[] = [3, 4, 5, 7, 12];
/** target-degree: the minor and major 3rd. Over a root-and-fifth drone, either is a colour. */
export const DEFAULT_DEGREES: readonly number[] = [3, 4];

export interface Heard {
  midi: number;
  at: number;
  /** Where the note was tapped. Absent for the mic, which can't know. */
  position?: { string: number; fret: number };
}

export type Feedback =
  /** `elsewhere`: the right pitch tapped on another string. It counts. */
  | { kind: "right"; midi: number; elsewhere: boolean }
  | { kind: "wrong-octave"; midi: number; expected: number }
  | { kind: "wrong-note"; midi: number }
  /** interval: the root heard; now the second note. Not a miss. */
  | { kind: "root"; midi: number }
  /** interval: a second note the wrong distance above the root. */
  | { kind: "wrong-interval"; midi: number; semitones: number }
  /** target-degree: a note the drone itself is sounding. Ignored, never shown. */
  | { kind: "drone"; midi: number }
  | { kind: "skipped" }
  | { kind: "timeout" };

export interface CardResult {
  card: Card;
  /** Right with no miss. */
  ok: boolean;
  /** From the prompt to the right answer, or to the skip or timeout. */
  ms: number;
  misses: number;
  /** The pitch that answers the card (for an interval, the upper note; for an octave, the lower one, on its string). */
  midi: number;
  /** Where the answer is, when the card pins it to a string. */
  position: Position | null;
}

export interface RespondState {
  prompt: RespondConfig["prompt"];
  total: number;
  pool: Card[];
  card: Card | null;
  /** 0-based index of the card showing. */
  index: number;
  /** asking → answered (right, skipped or timed out) → next card. */
  phase: "asking" | "answered";
  shownAt: number;
  misses: number;
  /** interval: the root as played, once heard. */
  rootMidi: number | null;
  last: { heard: Heard | null; feedback: Feedback } | null;
  results: CardResult[];
  startedAt: number | null;
  endedAt: number | null;
}

export type RespondAction =
  /** Deals the first card. `rand` in [0, 1). */
  | { type: "start"; at: number; rand: number }
  /** Moves the current card's clock, if nothing has been played on it (e.g. the mic just came on). */
  | { type: "reclock"; at: number }
  | { type: "heard"; note: Heard }
  | { type: "skip"; at: number }
  | { type: "timeout"; at: number }
  /** After an answer: the next card, or the end of the deck. */
  | { type: "next"; at: number; rand: number };

export function cardKey(c: Card): string {
  switch (c.kind) {
    case "note-on-string":
      return `${c.pc}@${c.string}`;
    case "play-heard-note":
      return `${c.midi}`;
    case "interval":
      return `${c.root}+${c.semitones}`;
    case "octave":
      return `${c.pc}@${c.string}^8`;
    case "target-degree":
      return `${c.root}>${c.semitones}`;
  }
}

/** Every card the config can ask, each playable inside its fret window and strings. */
export function cardPool(config: RespondConfig): Card[] {
  const pcs = [...new Set(config.pitchClasses.map(pitchClass))];
  switch (config.prompt) {
    case "note-on-string":
      return config.strings.flatMap((string) =>
        pcs.flatMap((pc) => {
          const targets = positionsOfPitchClass(pc, config.frets, [string]);
          return targets.length ? [{ kind: "note-on-string" as const, pc, string, targets }] : [];
        }),
      );
    case "play-heard-note": {
      const midis = new Set(pcs.flatMap((pc) => positionsOfPitchClass(pc, config.frets, config.strings).map((p) => p.midi)));
      return [...midis].sort((a, b) => a - b).map((midi) => ({ kind: "play-heard-note" as const, midi }));
    }
    case "interval": {
      const intervals = config.intervals ?? DEFAULT_INTERVALS;
      return pcs.flatMap((root) =>
        intervals
          .filter((semitones) =>
            positionsOfPitchClass(root, config.frets, config.strings).some(
              (p) => positionsOfMidi(p.midi + semitones, config.frets, config.strings).length > 0,
            ),
          )
          .map((semitones) => ({ kind: "interval" as const, root, semitones })),
      );
    }
    case "octave":
      return config.strings.flatMap((string) => {
        const higher = config.strings.filter((s) => s < string);
        return pcs.flatMap((pc) => {
          const targets = positionsOfPitchClass(pc, config.frets, [string]).filter(
            (p) => positionsOfMidi(p.midi + 12, config.frets, higher).length > 0,
          );
          return targets.length ? [{ kind: "octave" as const, pc, string, targets }] : [];
        });
      });
    case "target-degree": {
      const degrees = config.intervals ?? DEFAULT_DEGREES;
      return pcs.flatMap((root) =>
        degrees.flatMap((semitones) => {
          const targets = positionsOfPitchClass(root + semitones, config.frets, config.strings);
          return targets.length ? [{ kind: "target-degree" as const, root, semitones, targets }] : [];
        }),
      );
    }
  }
}

/**
 * The next card, weighted by how this deck has gone: a card missed last time
 * it came up weighs 4, a slow one (over 1.5× the median right answer) 2, a
 * quick one 0.5, an unseen one 1. The card just shown is left out.
 */
export function drawCard(pool: Card[], results: CardResult[], previous: Card | null, rand: number): Card | null {
  if (!pool.length) return null;
  const prevKey = previous ? cardKey(previous) : null;
  const candidates = pool.length > 1 ? pool.filter((c) => cardKey(c) !== prevKey) : pool;
  const lastByKey = new Map(results.map((r) => [cardKey(r.card), r]));
  const quick = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  const median = quick.length ? quick[Math.floor(quick.length / 2)] : Infinity;
  const weights = candidates.map((c) => {
    const r = lastByKey.get(cardKey(c));
    if (!r) return 1;
    if (!r.ok) return 4;
    return r.ms > median * 1.5 ? 2 : 0.5;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  let x = Math.min(Math.max(rand, 0), 0.999999) * sum;
  for (let i = 0; i < candidates.length; i++) {
    x -= weights[i];
    if (x < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

export function initRespond(config: RespondConfig): RespondState {
  const pool = cardPool(config);
  return {
    prompt: config.prompt,
    total: config.cards,
    pool,
    card: null,
    index: 0,
    phase: "asking",
    shownAt: 0,
    misses: 0,
    rootMidi: null,
    last: null,
    results: [],
    startedAt: null,
    // Nothing in the window to ask: over before it starts.
    endedAt: pool.length ? null : 0,
  };
}

export function respondReducer(s: RespondState, a: RespondAction): RespondState {
  if (s.endedAt !== null) return s;
  switch (a.type) {
    case "start":
      if (s.startedAt !== null) return s;
      return deal({ ...s, startedAt: a.at }, a.at, a.rand);
    case "reclock":
      if (!s.card || s.phase !== "asking" || s.last !== null) return s;
      return { ...s, shownAt: a.at, startedAt: s.index === 0 ? a.at : s.startedAt };
    case "heard":
      return heard(s, a.note);
    case "skip":
    case "timeout":
      if (!s.card || s.phase !== "asking") return s;
      return answer(s, a.at, false, { heard: null, feedback: { kind: a.type === "skip" ? "skipped" : "timeout" } });
    case "next":
      if (s.phase !== "answered") return s;
      if (s.results.length >= s.total) return { ...s, endedAt: a.at };
      return deal({ ...s, index: s.index + 1 }, a.at, a.rand);
  }
}

function deal(s: RespondState, at: number, rand: number): RespondState {
  return {
    ...s,
    card: drawCard(s.pool, s.results, s.card, rand),
    phase: "asking",
    shownAt: at,
    misses: 0,
    rootMidi: null,
    last: null,
  };
}

function heard(s: RespondState, note: Heard): RespondState {
  const card = s.card;
  if (!card || s.phase !== "asking") return s;
  const feedback = grade(card, s.rootMidi, note);
  const last = { heard: note, feedback };
  switch (feedback.kind) {
    case "right":
      return answer(s, note.at, s.misses === 0, last, note.midi);
    case "root":
      return { ...s, rootMidi: feedback.midi, last };
    case "drone":
      return s;
    default:
      return { ...s, misses: s.misses + 1, last };
  }
}

/** How a heard note answers a card. `rootMidi` is the interval root already played, if any. */
export function grade(card: Card, rootMidi: number | null, note: Heard): Feedback {
  const { midi } = note;
  switch (card.kind) {
    case "note-on-string": {
      if (card.targets.some((p) => p.midi === midi)) {
        const elsewhere = !!note.position && note.position.string !== card.string;
        return { kind: "right", midi, elsewhere };
      }
      if (pitchClass(midi) === card.pc) return { kind: "wrong-octave", midi, expected: nearest(card.targets.map((p) => p.midi), midi) };
      return { kind: "wrong-note", midi };
    }
    case "play-heard-note":
      if (midi === card.midi) return { kind: "right", midi, elsewhere: false };
      if (pitchClass(midi) === pitchClass(card.midi)) return { kind: "wrong-octave", midi, expected: card.midi };
      return { kind: "wrong-note", midi };
    case "interval":
      if (rootMidi === null) {
        return pitchClass(midi) === card.root ? { kind: "root", midi } : { kind: "wrong-note", midi };
      }
      if (midi === rootMidi + card.semitones) return { kind: "right", midi, elsewhere: false };
      // The root again: start the interval from this one instead. Not a miss.
      if (pitchClass(midi) === card.root) return { kind: "root", midi };
      return { kind: "wrong-interval", midi, semitones: midi - rootMidi };
    case "octave": {
      // The first note, as note-on-string grades it; played again, it restarts the octave.
      if (card.targets.some((p) => p.midi === midi)) return { kind: "root", midi };
      if (rootMidi === null) {
        if (pitchClass(midi) === card.pc) return { kind: "wrong-octave", midi, expected: nearest(card.targets.map((p) => p.midi), midi) };
        return { kind: "wrong-note", midi };
      }
      if (midi === rootMidi + 12) return { kind: "right", midi, elsewhere: false };
      return { kind: "wrong-interval", midi, semitones: midi - rootMidi };
    }
    case "target-degree": {
      const want = pitchClass(card.root + card.semitones);
      if (pitchClass(midi) === want) return { kind: "right", midi, elsewhere: false };
      if (pitchClass(midi) === card.root || pitchClass(midi) === pitchClass(card.root + 7)) return { kind: "drone", midi };
      return { kind: "wrong-note", midi };
    }
  }
}

/** Ends the card. `heardMidi` is the right answer as played; absent after a skip or timeout. */
function answer(s: RespondState, at: number, ok: boolean, last: RespondState["last"], heardMidi?: number): RespondState {
  const card = s.card!;
  const result: CardResult = {
    card,
    ok,
    ms: Math.max(0, Math.round(at - s.shownAt)),
    misses: s.misses,
    ...resultNote(card, s.rootMidi, heardMidi),
  };
  return { ...s, phase: "answered", last, results: [...s.results, result] };
}

/**
 * The note a card's result records, and its position where the card pins
 * one to a string. Only cards on one string have a position: anywhere else
 * the mic can't say where the note was played.
 */
function resultNote(card: Card, rootMidi: number | null, heardMidi?: number): Pick<CardResult, "midi" | "position"> {
  switch (card.kind) {
    case "note-on-string": {
      const position = card.targets.find((p) => p.midi === heardMidi) ?? card.targets[0];
      return { midi: position.midi, position };
    }
    case "octave": {
      const position = card.targets.find((p) => p.midi === rootMidi) ?? card.targets[0];
      return { midi: position.midi, position };
    }
    default:
      return { midi: heardMidi ?? answerMidi(card, rootMidi), position: null };
  }
}

/** The pitch that answers a card, for revealing it after a skip. */
export function answerMidi(card: Card, rootMidi: number | null = null): number {
  switch (card.kind) {
    case "note-on-string":
      return card.targets[0].midi;
    case "play-heard-note":
      return card.midi;
    case "interval":
      return (rootMidi ?? lowestRoot(card)) + card.semitones;
    case "octave":
      return (rootMidi ?? card.targets[0].midi) + 12;
    case "target-degree":
      return card.targets[0].midi;
  }
}

/** An interval's root in the lowest octave a guitar has (E2 = 40 and up). */
function lowestRoot(card: Extract<Card, { kind: "interval" }>): number {
  return 40 + pitchClass(card.root - 40);
}

function nearest(midis: number[], midi: number): number {
  return midis.reduce((best, m) => (Math.abs(m - midi) < Math.abs(best - midi) ? m : best), midis[0]);
}

export interface RespondStats {
  answered: number;
  right: number;
  /** Right first time, in a row, ending now. */
  streak: number;
  /** Mean time to a right answer, ms; null before the first. */
  averageMs: number | null;
}

export function respondStats(s: RespondState): RespondStats {
  const right = s.results.filter((r) => r.ok);
  let streak = 0;
  for (let i = s.results.length - 1; i >= 0 && s.results[i].ok; i--) streak++;
  return {
    answered: s.results.length,
    right: right.length,
    streak,
    averageMs: right.length ? Math.round(right.reduce((a, r) => a + r.ms, 0) / right.length) : null,
  };
}

export function respondNotes(s: RespondState): NoteResult[] {
  return s.results.map((r) => ({
    midi: r.midi,
    ok: r.ok,
    ms: Math.min(r.ms, 600_000),
    string: r.position?.string ?? null,
    fret: r.position?.fret ?? null,
  }));
}

/** The run to POST once the deck has ended. */
export function respondRun(s: RespondState, exerciseId: string, startedAtIso: string): RunInput {
  const notes = respondNotes(s);
  const notesClean = notes.filter((n) => n.ok).length;
  return {
    exerciseId,
    startedAt: startedAtIso,
    durationMs: Math.max(0, Math.round((s.endedAt ?? 0) - (s.startedAt ?? 0))),
    tempo: null,
    notesTotal: notes.length,
    notesClean,
    clean: notes.length > 0 && notesClean === notes.length,
    notes,
  };
}
