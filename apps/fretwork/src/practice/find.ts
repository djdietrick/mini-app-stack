import type { FindConfig, NoteResult, RunInput } from "../domain/types.js";
import { type Position, midiAt, positionsOfPitchClass } from "../theory/fretboard.js";
import { type PitchClass, pitchClass } from "../theory/notes.js";

/**
 * The `find` engine's grading, as a pure reducer: the SPA feeds it heard
 * notes (from the mic or a tap on the neck) and draws whatever state comes
 * back. No clocks here; every action carries its own timestamp.
 *
 * The run is a list of slots, each graded once:
 *
 *   string-by-string  one slot per string, low E first. A slot holds every
 *                     position of the note on that string in the window
 *                     (two when the window spans an octave, e.g. 0 and 12).
 *   any               one slot per position. A heard pitch lights every
 *                     unfound position with that pitch, since the mic cannot
 *                     say which of them was played.
 *
 * A mic hears pitch, not position (see "Pitch ≠ position" in PLAN.md). So the
 * right pitch always counts, wherever it was played. A tap does carry a
 * position, which is how the "right pitch, other string" case shows up.
 */

export interface Heard {
  midi: number;
  at: number;
  /** Where the note was tapped. Absent for the mic, which can't know. */
  position?: { string: number; fret: number };
}

export interface Slot {
  /** Every position that satisfies this slot. */
  positions: Position[];
  /** The position played, once found. Null until then, and if time ran out. */
  found: Position | null;
  /** Found with no miss and no hint since the previous find. */
  ok: boolean;
  /** Time from the previous find (or the start) to this one. */
  ms: number;
}

export type Feedback =
  /** `elsewhere`: the right pitch, tapped on another string. It counts. */
  | { kind: "correct"; midi: number; slots: number[]; elsewhere: boolean }
  /** The right note name in the wrong octave; `expected` is the nearest wanted pitch. */
  | { kind: "wrong-octave"; midi: number; expected: number }
  | { kind: "wrong-note"; midi: number }
  /** `any` order: a pitch already lit. Not a miss. */
  | { kind: "already-found"; midi: number }
  /** `pitch-class` grading, `any` order: the right note, but no position in the window has that pitch. Not a miss. */
  | { kind: "outside"; midi: number };

export interface FindState {
  pc: PitchClass;
  order: FindConfig["order"];
  grading: FindConfig["grading"];
  slots: Slot[];
  /** The clock: null until the run starts. */
  startedAt: number | null;
  /** When the previous slot was found, or the start. */
  lastFindAt: number;
  missesSince: number;
  hintedSince: boolean;
  /** Hints are on: every position still to find is shown. */
  hint: boolean;
  /** The latest graded note, with the tapped position if there was one. */
  last: { heard: Heard; feedback: Feedback } | null;
  endedAt: number | null;
  timedOut: boolean;
}

export type FindAction =
  | { type: "start"; at: number }
  | { type: "heard"; note: Heard }
  | { type: "hint"; on: boolean }
  | { type: "timeout"; at: number };

/** Slots for a note, in the order they are asked for. */
export function findSlots(config: Pick<FindConfig, "order" | "frets" | "strings">, pc: PitchClass): Position[][] {
  const all = positionsOfPitchClass(pc, config.frets, config.strings);
  if (config.order === "any") return all.map((p) => [p]);
  const byString = new Map<number, Position[]>();
  for (const p of all) byString.set(p.string, [...(byString.get(p.string) ?? []), p]);
  // positionsOfPitchClass is already low string first.
  return [...byString.values()];
}

export function initFind(config: FindConfig, pc: PitchClass): FindState {
  const slots = findSlots(config, pc).map((positions) => ({ positions, found: null, ok: false, ms: 0 }));
  return {
    pc: pitchClass(pc),
    order: config.order,
    grading: config.grading,
    slots,
    startedAt: null,
    lastFindAt: 0,
    missesSince: 0,
    hintedSince: false,
    hint: false,
    last: null,
    // A window with none of this note in it is over before it starts.
    endedAt: slots.length === 0 ? 0 : null,
    timedOut: false,
  };
}

/** The slot being asked for: the first unfound one in string-by-string order; null in `any` order or when done. */
export function currentSlot(s: FindState): number | null {
  if (s.order !== "string-by-string" || s.endedAt !== null) return null;
  const i = s.slots.findIndex((slot) => !slot.found);
  return i < 0 ? null : i;
}

/** The string being asked for, in string-by-string order. */
export function currentString(s: FindState): number | null {
  const i = currentSlot(s);
  return i === null ? null : s.slots[i].positions[0].string;
}

/** Nothing played yet, so the clock can still be moved (e.g. once the mic comes on). */
export function untouched(s: FindState): boolean {
  return s.last === null && !s.slots.some((slot) => slot.found);
}

export function findReducer(s: FindState, a: FindAction): FindState {
  switch (a.type) {
    case "start":
      if (s.endedAt !== null || (s.startedAt !== null && !untouched(s))) return s;
      return { ...s, startedAt: a.at, lastFindAt: a.at };
    case "hint":
      if (s.endedAt !== null) return s;
      return { ...s, hint: a.on, hintedSince: s.hintedSince || a.on };
    case "timeout":
      if (s.endedAt !== null) return s;
      return {
        ...s,
        slots: s.slots.map((slot) =>
          slot.found ? slot : { ...slot, ok: false, ms: Math.max(0, Math.round(a.at - s.lastFindAt)) },
        ),
        endedAt: a.at,
        timedOut: true,
      };
    case "heard":
      return heard(s, a.note);
  }
}

function heard(s0: FindState, note: Heard): FindState {
  if (s0.endedAt !== null) return s0;
  // A note before the run was started starts it.
  const s = s0.startedAt === null ? { ...s0, startedAt: note.at, lastFindAt: note.at } : s0;
  const feedback = grade(s, note);
  const last = { heard: note, feedback };

  if (feedback.kind !== "correct") {
    const miss = feedback.kind === "wrong-note" || feedback.kind === "wrong-octave";
    return { ...s, last, missesSince: s.missesSince + (miss ? 1 : 0) };
  }

  const ms = Math.max(0, Math.round(note.at - s.lastFindAt));
  const ok = s.missesSince === 0 && !s.hintedSince && !s.hint;
  const slots = s.slots.map((slot, i) => {
    if (!feedback.slots.includes(i)) return slot;
    const found = slot.positions.find((p) => p.midi === note.midi) ?? slot.positions[0];
    return { ...slot, found, ok, ms };
  });
  const done = slots.every((slot) => slot.found);
  return {
    ...s,
    slots,
    last,
    lastFindAt: note.at,
    missesSince: 0,
    hintedSince: s.hint,
    endedAt: done ? note.at : null,
  };
}

/** How a heard note fares against the run as it stands. Pure; the reducer applies it. */
export function grade(s: FindState, note: Heard): Feedback {
  const { midi } = note;
  const rightName = pitchClass(midi) === s.pc;

  if (s.order === "string-by-string") {
    const i = currentSlot(s);
    if (i === null) return { kind: "wrong-note", midi };
    const slot = s.slots[i];
    const exact = slot.positions.some((p) => p.midi === midi);
    if (exact || (rightName && s.grading === "pitch-class")) {
      const elsewhere = !!note.position && note.position.string !== slot.positions[0].string;
      return { kind: "correct", midi, slots: [i], elsewhere };
    }
    if (rightName) return { kind: "wrong-octave", midi, expected: nearest(slot.positions, midi) };
    return { kind: "wrong-note", midi };
  }

  const matches = s.slots.flatMap((slot, i) => (!slot.found && slot.positions[0].midi === midi ? [i] : []));
  if (matches.length) return { kind: "correct", midi, slots: matches, elsewhere: false };
  if (s.slots.some((slot) => slot.found && slot.positions[0].midi === midi)) return { kind: "already-found", midi };
  if (!rightName) return { kind: "wrong-note", midi };
  if (s.grading === "pitch-class") return { kind: "outside", midi };
  const unfound = s.slots.filter((slot) => !slot.found).flatMap((slot) => slot.positions);
  return { kind: "wrong-octave", midi, expected: nearest(unfound, midi) };
}

function nearest(positions: Position[], midi: number): number {
  return positions.reduce((best, p) => (Math.abs(p.midi - midi) < Math.abs(best - midi) ? p.midi : best), positions[0].midi);
}

/** Up a fourth: "Next note" walks the cycle of fourths, as guitarists drill it. */
export function nextPitchClass(pc: PitchClass): PitchClass {
  return pitchClass(pc + 5);
}

/** Found slots count once each; unfound ones report their first position, so the heatmap still learns where they were. */
export function findNotes(s: FindState): NoteResult[] {
  return s.slots.map((slot) => {
    const p = slot.found ?? slot.positions[0];
    return { midi: p.midi, ok: !!slot.found && slot.ok, ms: Math.min(slot.ms, 600_000), string: p.string, fret: p.fret };
  });
}

/** The run to POST once the state has ended. */
export function findRun(s: FindState, exerciseId: string, startedAtIso: string): RunInput {
  const notes = findNotes(s);
  const notesClean = notes.filter((n) => n.ok).length;
  return {
    exerciseId,
    startedAt: startedAtIso,
    durationMs: Math.max(0, Math.round((s.endedAt ?? 0) - (s.startedAt ?? 0))),
    tempo: null,
    notesTotal: notes.length,
    notesClean,
    clean: notes.length > 0 && notesClean === notes.length && !s.timedOut,
    notes,
  };
}

/** The pitch at a tapped position, for turning a tap into a Heard. */
export function heardAt(string: number, fret: number, at: number): Heard {
  return { midi: midiAt(string, fret), at, position: { string, fret } };
}
