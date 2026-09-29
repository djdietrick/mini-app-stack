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
 */
export function shapeInWindow(
  rootPc: PitchClass,
  intervals: readonly number[],
  window: FretWindow,
  strings: readonly number[] = ALL_STRINGS,
  tuning: readonly number[] = STANDARD_TUNING,
): ShapeNote[] {
  const wanted = new Set(intervals.map((i) => pitchClass(rootPc + i)));
  const byMidi = new Map<number, Position>();
  for (const p of positionsWhere((m) => wanted.has(pitchClass(m)), window, strings, tuning)) {
    const seen = byMidi.get(p.midi);
    if (!seen || p.fret < seen.fret) byMidi.set(p.midi, p);
  }
  return [...byMidi.values()]
    .sort((a, b) => a.midi - b.midi)
    .map((p) => {
      const interval = pitchClass(p.midi - rootPc);
      return { ...p, interval, degree: degreeLabel(interval) };
    });
}

/** Orders an ascending shape into the sequence the player is asked to play. */
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
