import {
  ALL_STRINGS,
  type FretWindow,
  type Position,
  STANDARD_TUNING,
  positionsWhere,
} from "./fretboard.js";
import { type PitchClass, pitchClass } from "./notes.js";
import { degreeLabel } from "./scales.js";

export const PATTERNS = ["up", "down", "updown", "groups3", "thirds"] as const;
export type Pattern = (typeof PATTERNS)[number];

export const PATTERN_LABELS: Record<Pattern, string> = {
  up: "Ascending",
  down: "Descending",
  updown: "Up & down",
  groups3: "Groups of 3",
  thirds: "In thirds",
};

/**
 * How a scale or arpeggio is laid out in its fret window:
 *
 *   lower-fret        each pitch once, the lower fret where it fits twice: the
 *                     standard box shapes for a 4- or 5-fret window
 *   higher-fret       the same, the higher fret winning: for a window spanning
 *                     two boxes, a climb that ends up in the upper one
 *   three-per-string  three notes on each string, low string first: the
 *                     shifting 3nps fingerings
 */
export const SHAPES = ["lower-fret", "higher-fret", "three-per-string"] as const;
export type ShapeStrategy = (typeof SHAPES)[number];

export const SHAPE_LABELS: Record<ShapeStrategy, string> = {
  "lower-fret": "Box",
  "higher-fret": "Box, higher fret",
  "three-per-string": "3 per string",
};

export interface ShapeNote extends Position {
  /** Semitones above the root, 0–11. */
  interval: number;
  degree: string;
}

/**
 * The notes of a scale or arpeggio inside a fret window, lowest pitch first,
 * each pitch once. Where a pitch is playable in two places in the window, the
 * lower fret wins — which, for a 4- or 5-fret window, reproduces the standard
 * box shapes (A minor pentatonic in frets 5–8 comes out as the familiar box 1).
 * `prefer: "higher"` keeps the higher fret instead, which in a window spanning
 * two boxes starts in the lower box and climbs into the upper one.
 */
export function shapeInWindow(
  rootPc: PitchClass,
  intervals: readonly number[],
  window: FretWindow,
  strings: readonly number[] = ALL_STRINGS,
  tuning: readonly number[] = STANDARD_TUNING,
  prefer: "lower" | "higher" = "lower",
): ShapeNote[] {
  const wanted = new Set(intervals.map((i) => pitchClass(rootPc + i)));
  const byMidi = new Map<number, Position>();
  for (const p of positionsWhere((m) => wanted.has(pitchClass(m)), window, strings, tuning)) {
    const seen = byMidi.get(p.midi);
    if (!seen || (prefer === "lower" ? p.fret < seen.fret : p.fret > seen.fret)) byMidi.set(p.midi, p);
  }
  return [...byMidi.values()].sort((a, b) => a.midi - b.midi).map((p) => shapeNote(p, rootPc));
}

function shapeNote(p: Position, rootPc: PitchClass): ShapeNote {
  const interval = pitchClass(p.midi - rootPc);
  return { ...p, interval, degree: degreeLabel(interval) };
}

/**
 * Three notes per string, lowest string first, lowest pitch first. It starts
 * on the lowest note of the scale on the lowest string at or above the
 * window's first fret, then takes each next note of the scale in turn, three
 * to a string. It stops at the first note that would fall outside the
 * window, so the window's top fret bounds the shape.
 */
export function threePerString(
  rootPc: PitchClass,
  intervals: readonly number[],
  window: FretWindow,
  strings: readonly number[] = ALL_STRINGS,
  tuning: readonly number[] = STANDARD_TUNING,
): ShapeNote[] {
  const wanted = new Set(intervals.map((i) => pitchClass(rootPc + i)));
  const ordered = [...strings].sort((a, b) => b - a);
  const out: ShapeNote[] = [];
  const nextAbove = (midi: number) => {
    let m = midi + 1;
    while (!wanted.has(pitchClass(m))) m++;
    return m;
  };
  let last: number | null = null;
  for (const string of ordered) {
    const open = tuning[string - 1];
    for (let k = 0; k < 3; k++) {
      let midi: number;
      if (last === null) {
        let fret = window.lo;
        while (fret <= window.hi && !wanted.has(pitchClass(open + fret))) fret++;
        midi = open + fret;
      } else {
        midi = nextAbove(last);
      }
      const fret = midi - open;
      if (fret < window.lo || fret > window.hi) return out;
      out.push(shapeNote({ string, fret, midi }, rootPc));
      last = midi;
    }
  }
  return out;
}

/** A scale or arpeggio in its window, laid out by the chosen strategy. */
export function shapeFor(
  strategy: ShapeStrategy,
  rootPc: PitchClass,
  intervals: readonly number[],
  window: FretWindow,
  strings: readonly number[] = ALL_STRINGS,
  tuning: readonly number[] = STANDARD_TUNING,
): ShapeNote[] {
  switch (strategy) {
    case "lower-fret":
      return shapeInWindow(rootPc, intervals, window, strings, tuning, "lower");
    case "higher-fret":
      return shapeInWindow(rootPc, intervals, window, strings, tuning, "higher");
    case "three-per-string":
      return threePerString(rootPc, intervals, window, strings, tuning);
  }
}

/**
 * Pitch classes in the order given (a cycle of 4ths, say), each placed once in
 * the window: the first at its lowest pitch, then each next one at the
 * position nearest the one before it (fewest frets away, then the closest
 * pitch, then the lower-pitched string). Degrees are counted from the first note. A
 * pitch class with no position in the window is left out.
 */
export function notesInOrder(
  pcs: readonly PitchClass[],
  window: FretWindow,
  strings: readonly number[] = ALL_STRINGS,
  tuning: readonly number[] = STANDARD_TUNING,
): ShapeNote[] {
  if (!pcs.length) return [];
  const rootPc = pitchClass(pcs[0]);
  const out: ShapeNote[] = [];
  let prev: Position | null = null;
  for (const pc of pcs) {
    const options = positionsWhere((m) => pitchClass(m) === pitchClass(pc), window, strings, tuning);
    if (!options.length) continue;
    const from: Position | null = prev;
    const pick: Position = options.reduce((best, p) => {
      if (!from) return p.midi < best.midi ? p : best;
      const d = (q: Position) => [Math.abs(q.fret - from.fret), Math.abs(q.midi - from.midi), 7 - q.string];
      const [a, b] = [d(p), d(best)];
      return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2]))) ? p : best;
    });
    out.push(shapeNote(pick, rootPc));
    prev = pick;
  }
  return out;
}

/**
 * Orders an ascending shape into the sequence the player is asked to play.
 * (A note-order source is not ascending; the patterns still apply to it as
 * given.)
 */
export function applyPattern<T>(ascending: readonly T[], pattern: Pattern): T[] {
  const asc = [...ascending];
  switch (pattern) {
    case "up":
      return asc;
    case "down":
      return asc.reverse();
    case "updown":
      // The top note is played once, not twice.
      return asc.length ? asc.concat(asc.slice(0, -1).reverse()) : [];
    case "groups3": {
      const out: T[] = [];
      for (let i = 0; i + 2 < asc.length; i++) out.push(asc[i], asc[i + 1], asc[i + 2]);
      return out;
    }
    case "thirds": {
      const out: T[] = [];
      for (let i = 0; i + 2 < asc.length; i++) out.push(asc[i], asc[i + 2]);
      return out;
    }
  }
}
