import type { NoteResult, RunInput, SequenceConfig } from "../domain/types.js";
import { type PitchClass, pitchClass } from "../theory/notes.js";
import { degreeNumber, findFormula, isMinorFormula } from "../theory/scales.js";
import { type ShapeNote, applyPattern, notesInOrder, shapeFor } from "../theory/sequence.js";
import { TEMPO_RANGE } from "./metronome.js";
import type { Heard } from "./find.js";

/**
 * The `sequence` engine: a scale or arpeggio shape played in order, to a
 * click. A pure reducer like find.ts and respond.ts; every action carries its
 * own timestamp.
 *
 * - Order and pitch are graded; rhythm is not (yet). The click sets the pace.
 * - A wrong note marks the current note missed, and the player stays on it
 *   until it is played right. A run is clean when every note was right first
 *   time.
 * - `exact` grading wants the shape's own pitch (so the octave, which keeps
 *   the player in the window); `pitch-class` takes the note name anywhere.
 * - The mic hears pitch, not position, so the right pitch counts wherever it
 *   was played. A tap on another string at that pitch counts too, and says so.
 * - The note just played, heard again, is neither right nor a miss: a re-pick
 *   or a string left ringing is not a mistake. No shape repeats a pitch
 *   back to back, so this never swallows a note that was asked for.
 * - The run starts at its first note played right, so the player can take
 *   their time getting ready (noodling first is not a miss), and a run can
 *   start hands-free.
 *
 * The tempo ladder (advanceLadder) is here too, so the server can apply the
 * same rule when it keeps progress.
 */

/** A note to play, and which part of a multi-part source it belongs to (0 otherwise). */
export interface SeqTarget extends ShapeNote {
  part: number;
}

export interface SeqNote {
  target: SeqTarget;
  /** Played right, at last. */
  done: boolean;
  /** A wrong note was heard while this was the one asked for. */
  missed: boolean;
  /** From the previous note played right (0 for the first) to this one. */
  ms: number;
}

export type SeqFeedback =
  | { kind: "right"; midi: number; elsewhere: boolean }
  | { kind: "wrong-octave"; midi: number; expected: number }
  | { kind: "wrong-note"; midi: number; expected: number }
  /** The previous note again. Not a miss. */
  | { kind: "repeat"; midi: number };

export interface SequenceState {
  grading: SequenceConfig["grading"];
  notes: SeqNote[];
  /** Index of the note asked for; `notes.length` once done. */
  index: number;
  startedAt: number | null;
  lastRightAt: number;
  last: { heard: Heard; feedback: SeqFeedback } | null;
  endedAt: number | null;
}

export type SequenceAction = { type: "heard"; note: Heard };

/** One formula (or note order) of a source, laid out in its window, before the pattern. */
export interface SequencePart {
  root: PitchClass;
  /** Minor-flavoured, for spelling. */
  minor: boolean;
  /** The formula id, or null for a note-order source. */
  formula: string | null;
  kind: "scale" | "arpeggio" | "notes";
  notes: ShapeNote[];
}

/**
 * The source's parts, each laid out in its window: one part for a scale,
 * an arpeggio or a note order, one per entry for a multi-part source (whose
 * degrees filter applies here).
 */
export function sequenceParts(config: SequenceConfig): SequencePart[] {
  const src = config.source;
  const strategy = config.shape ?? "lower-fret";
  switch (src.kind) {
    case "notes":
      return [
        {
          root: src.pitchClasses[0],
          minor: false,
          formula: null,
          kind: "notes",
          notes: notesInOrder(src.pitchClasses, config.frets, config.strings),
        },
      ];
    case "scale":
    case "arpeggio":
    case "parts": {
      const entries = src.kind === "parts" ? src.parts : [{ ...src, frets: undefined }];
      const keep = src.kind === "parts" && src.degrees ? new Set(src.degrees) : null;
      return entries.map((p) => {
        const formula = findFormula(p.kind, p.formula);
        const intervals = (formula?.intervals ?? []).filter((i) => !keep || keep.has(degreeNumber(i)));
        return {
          root: p.root,
          minor: !!formula && isMinorFormula(formula),
          formula: p.formula,
          kind: p.kind,
          notes: formula ? shapeFor(strategy, p.root, intervals, p.frets ?? config.frets, config.strings) : [],
        };
      });
    }
  }
}

/**
 * The notes to play, in order: each part's shape arranged by the pattern,
 * the parts one after another. Where one part ends on the pitch the next
 * starts on, it is played once: the grader treats a pitch heard twice
 * running as a re-pick.
 */
export function sequenceTargets(config: SequenceConfig): SeqTarget[] {
  const out: SeqTarget[] = [];
  sequenceParts(config).forEach((p, part) => {
    for (const n of applyPattern(p.notes, config.pattern)) {
      if (out.length && out[out.length - 1].midi === n.midi) continue;
      out.push({ ...n, part });
    }
  });
  return out;
}

/**
 * The root a sequence is heard against, for spelling and the drone: the
 * formula's root, the first note of a note order, and the last part of a
 * multi-part source (a progression resolves to its last chord).
 */
export function sequenceKey(config: SequenceConfig): { root: PitchClass; minor: boolean } {
  const parts = sequenceParts(config);
  const key = config.source.kind === "parts" ? parts[parts.length - 1] : parts[0];
  return { root: key.root, minor: key.minor };
}

export function initSequence(config: SequenceConfig): SequenceState {
  const notes = sequenceTargets(config).map((target) => ({ target, done: false, missed: false, ms: 0 }));
  return {
    grading: config.grading,
    notes,
    index: 0,
    startedAt: null,
    lastRightAt: 0,
    last: null,
    // Nothing in the window to play: over before it starts.
    endedAt: notes.length ? null : 0,
  };
}

export function sequenceReducer(s: SequenceState, a: SequenceAction): SequenceState {
  if (s.endedAt !== null) return s;
  switch (a.type) {
    case "heard":
      return heard(s, a.note);
  }
}

function heard(s0: SequenceState, note: Heard): SequenceState {
  const feedback = gradeNote(s0, note);
  const last = { heard: note, feedback };
  // Until the first note is right the run hasn't begun: say what was heard, but count nothing.
  if (s0.startedAt === null && feedback.kind !== "right") return { ...s0, last };
  const s = s0.startedAt === null ? { ...s0, startedAt: note.at, lastRightAt: note.at } : s0;
  switch (feedback.kind) {
    case "repeat":
      return { ...s, last };
    case "wrong-note":
    case "wrong-octave":
      return { ...s, last, notes: markMissed(s.notes, s.index) };
    case "right": {
      const ms = Math.max(0, Math.round(note.at - s.lastRightAt));
      const notes = s.notes.map((n, i) => (i === s.index ? { ...n, done: true, ms } : n));
      const index = s.index + 1;
      return {
        ...s,
        notes,
        index,
        last,
        lastRightAt: note.at,
        endedAt: index >= notes.length ? note.at : null,
      };
    }
  }
}

function markMissed(notes: SeqNote[], i: number): SeqNote[] {
  return notes.map((n, j) => (j === i && !n.missed ? { ...n, missed: true } : n));
}

/** How a heard note fares against the note asked for. */
export function gradeNote(s: SequenceState, note: Heard): SeqFeedback {
  const { midi } = note;
  const want = s.notes[s.index]?.target;
  if (!want) return { kind: "wrong-note", midi, expected: midi };
  if (midi === want.midi || (s.grading === "pitch-class" && pitchClass(midi) === pitchClass(want.midi))) {
    const elsewhere = !!note.position && (note.position.string !== want.string || note.position.fret !== want.fret);
    return { kind: "right", midi, elsewhere };
  }
  const prev = s.notes[s.index - 1]?.target;
  if (prev && midi === prev.midi) return { kind: "repeat", midi };
  if (pitchClass(midi) === pitchClass(want.midi)) return { kind: "wrong-octave", midi, expected: want.midi };
  return { kind: "wrong-note", midi, expected: want.midi };
}

export interface SequenceStats {
  played: number;
  clean: number;
  /** Share of notes played so far that were right first time, 0–1; null before the first. */
  accuracy: number | null;
}

export function sequenceStats(s: SequenceState): SequenceStats {
  const played = s.notes.filter((n) => n.done).length;
  const clean = s.notes.filter((n) => n.done && !n.missed).length;
  return { played, clean, accuracy: played ? clean / played : null };
}

export function sequenceNotes(s: SequenceState): NoteResult[] {
  return s.notes.map((n) => ({
    midi: n.target.midi,
    ok: n.done && !n.missed,
    ms: Math.min(n.ms, 600_000),
    string: n.target.string,
    fret: n.target.fret,
  }));
}

/** The run to POST once the sequence has been played through. */
export function sequenceRun(s: SequenceState, exerciseId: string, startedAtIso: string, tempo: number): RunInput {
  const notes = sequenceNotes(s);
  const notesClean = notes.filter((n) => n.ok).length;
  return {
    exerciseId,
    startedAt: startedAtIso,
    durationMs: Math.max(0, Math.round((s.endedAt ?? 0) - (s.startedAt ?? 0))),
    tempo: clampTempo(tempo),
    notesTotal: notes.length,
    notesClean,
    clean: notes.length > 0 && notesClean === notes.length,
    notes,
  };
}

// ---------- the tempo ladder ----------

export interface Ladder {
  tempo: number;
  /** Clean runs in a row at this tempo. */
  streak: number;
}

export type LadderRule = Pick<SequenceConfig["tempo"], "step" | "cleanRunsToAdvance">;

export function clampTempo(bpm: number): number {
  return Math.round(Math.min(TEMPO_RANGE.max, Math.max(TEMPO_RANGE.min, bpm)));
}

/**
 * One run's effect on the ladder: a clean run adds to the streak, and
 * `cleanRunsToAdvance` of them raise the tempo by `step` and start a new
 * streak. An unclean run resets the streak. A step of 0 turns the ladder off
 * (the streak still counts).
 */
export function advanceLadder(l: Ladder, clean: boolean, rule: LadderRule): Ladder & { bumped: boolean } {
  if (!clean) return { tempo: l.tempo, streak: 0, bumped: false };
  const streak = l.streak + 1;
  if (rule.step > 0 && streak >= rule.cleanRunsToAdvance && l.tempo < TEMPO_RANGE.max) {
    return { tempo: clampTempo(l.tempo + rule.step), streak: 0, bumped: true };
  }
  return { tempo: l.tempo, streak, bumped: false };
}

/**
 * The ladder as a player's past runs left it, newest run first (as GET /runs
 * lists them). A run at a different tempo than the ladder expected (the
 * player changed it by hand) restarts the streak at that tempo. With no
 * runs, the exercise's start tempo.
 */
export function ladderFromRuns(
  runs: readonly { tempo: number | null; clean: boolean }[],
  tempo: SequenceConfig["tempo"],
): Ladder {
  let l: Ladder = { tempo: clampTempo(tempo.start), streak: 0 };
  for (const r of [...runs].reverse()) {
    if (r.tempo === null) continue;
    if (r.tempo !== l.tempo) l = { tempo: r.tempo, streak: 0 };
    const { bumped: _, ...next } = advanceLadder(l, r.clean, tempo);
    l = next;
  }
  return l;
}
