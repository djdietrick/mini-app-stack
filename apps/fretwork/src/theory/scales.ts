/**
 * Scale and arpeggio formulas as semitone intervals above the root. Ids are
 * stored in exercise configs, so treat them as stable: rename `name`, never
 * `id`.
 */

export interface Formula {
  id: string;
  name: string;
  intervals: readonly number[];
}

export const SCALES: readonly Formula[] = [
  { id: "major", name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "natural-minor", name: "Natural minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "major-pentatonic", name: "Major pentatonic", intervals: [0, 2, 4, 7, 9] },
  { id: "minor-pentatonic", name: "Minor pentatonic", intervals: [0, 3, 5, 7, 10] },
  { id: "blues", name: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
  { id: "dorian", name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "mixolydian", name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "harmonic-minor", name: "Harmonic minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
];

export const ARPEGGIOS: readonly Formula[] = [
  { id: "major-triad", name: "Major triad", intervals: [0, 4, 7] },
  { id: "minor-triad", name: "Minor triad", intervals: [0, 3, 7] },
  { id: "maj7", name: "Major 7", intervals: [0, 4, 7, 11] },
  { id: "min7", name: "Minor 7", intervals: [0, 3, 7, 10] },
  { id: "dom7", name: "Dominant 7", intervals: [0, 4, 7, 10] },
  { id: "min7b5", name: "Half-diminished", intervals: [0, 3, 6, 10] },
];

export type FormulaKind = "scale" | "arpeggio";

export const FORMULA_IDS = {
  scale: SCALES.map((f) => f.id),
  arpeggio: ARPEGGIOS.map((f) => f.id),
} as const;

export function findFormula(kind: FormulaKind, id: string): Formula | undefined {
  return (kind === "scale" ? SCALES : ARPEGGIOS).find((f) => f.id === id);
}

/** Minor-flavoured formulas, for picking flat or sharp spelling. */
export function isMinorFormula(f: Formula): boolean {
  return f.intervals.includes(3) && !f.intervals.includes(4);
}

const DEGREE_LABELS = ["R", "♭2", "2", "♭3", "3", "4", "♭5", "5", "♭6", "6", "♭7", "7"] as const;

/** "R", "♭3", "5" … for an interval in semitones above the root. */
export function degreeLabel(interval: number): string {
  return DEGREE_LABELS[((interval % 12) + 12) % 12];
}
