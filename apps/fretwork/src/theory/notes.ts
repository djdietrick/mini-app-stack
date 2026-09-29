/**
 * Pitch arithmetic. Everything is MIDI note numbers (A4 = 69, middle C = 60)
 * and pitch classes (C = 0 … B = 11); names are only for display.
 *
 * Pure and dependency-free: the SPA imports this directly, and the pitch
 * detector turns frequencies into MIDI numbers with it.
 */

export type PitchClass = number;
export type Spelling = "sharp" | "flat";

export const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;
export const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"] as const;

export const A4_HZ = 440;

export function pitchClass(midi: number): PitchClass {
  return ((midi % 12) + 12) % 12;
}

/** Scientific pitch notation octave: MIDI 60 is C4. */
export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function noteName(pc: PitchClass, spelling: Spelling = "sharp"): string {
  return (spelling === "flat" ? FLAT_NAMES : SHARP_NAMES)[pitchClass(pc)];
}

/** "A3", "F♯4". */
export function midiName(midi: number, spelling: Spelling = "sharp"): string {
  return noteName(pitchClass(midi), spelling) + octaveOf(midi);
}

/**
 * Conventional spelling for a key: flats for F, B♭, E♭, A♭, D♭, G♭ major and
 * their relative minors, sharps otherwise. Good enough for labelling a scale;
 * it does not try to get every accidental of every mode right.
 */
export function spellingForKey(rootPc: PitchClass, minor = false): Spelling {
  const majorPc = minor ? pitchClass(rootPc + 3) : pitchClass(rootPc);
  return [5, 10, 3, 8, 1, 6].includes(majorPc) ? "flat" : "sharp";
}

export function midiToFreq(midi: number, a4 = A4_HZ): number {
  return a4 * 2 ** ((midi - 69) / 12);
}

/** Fractional MIDI number, so 69.2 is 20 cents sharp of A4. */
export function freqToMidi(freq: number, a4 = A4_HZ): number {
  return 69 + 12 * Math.log2(freq / a4);
}

/** The nearest equal-tempered note and how far off it the frequency is. */
export function nearestNote(freq: number, a4 = A4_HZ): { midi: number; cents: number } {
  const exact = freqToMidi(freq, a4);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100 };
}
