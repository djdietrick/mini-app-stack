import { pitchClass, type PitchClass } from "./notes.js";

/**
 * The neck. Strings are numbered the way guitarists count them: 1 is the high
 * E, 6 the low E. Fret 0 is the open string.
 *
 * An important limit shapes every exercise built on this: a microphone hears a
 * pitch, not a position. E4 is fret 0 on string 1, fret 5 on string 2 and
 * fret 9 on string 3, and the three sound the same. So a target can only be
 * checked down to its pitch; anything that asks for a specific string either
 * constrains the fret window so the pitch is unique, or trusts the player.
 */

/** Open-string MIDI numbers, indexed by string number minus one. E4 B3 G3 D3 A2 E2. */
export const STANDARD_TUNING: readonly number[] = [64, 59, 55, 50, 45, 40];

export const STRING_NAMES = ["high E", "B", "G", "D", "A", "low E"] as const;
/** One letter per string, high to low, as tab writes them. */
export const STRING_LETTERS = ["e", "B", "G", "D", "A", "E"] as const;

export const ALL_STRINGS: readonly number[] = [1, 2, 3, 4, 5, 6];

/** Frets that carry an inlay dot on most guitars. 12 and 24 are doubled. */
export const INLAY_FRETS: readonly number[] = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];

export interface FretWindow {
  lo: number;
  hi: number;
}

export interface Position {
  string: number;
  fret: number;
  midi: number;
}

export function midiAt(string: number, fret: number, tuning: readonly number[] = STANDARD_TUNING): number {
  return tuning[string - 1] + fret;
}

export function stringName(string: number): string {
  return STRING_NAMES[string - 1];
}

/**
 * Every position in the window whose pitch passes `match`, low string first
 * and then up the neck — the order you would sweep the fretboard in.
 */
export function positionsWhere(
  match: (midi: number) => boolean,
  window: FretWindow,
  strings: readonly number[] = ALL_STRINGS,
  tuning: readonly number[] = STANDARD_TUNING,
): Position[] {
  const out: Position[] = [];
  const ordered = [...strings].sort((a, b) => b - a);
  for (const string of ordered) {
    for (let fret = window.lo; fret <= window.hi; fret++) {
      const midi = midiAt(string, fret, tuning);
      if (match(midi)) out.push({ string, fret, midi });
    }
  }
  return out;
}

export function positionsOfPitchClass(
  pc: PitchClass,
  window: FretWindow,
  strings?: readonly number[],
  tuning?: readonly number[],
): Position[] {
  return positionsWhere((m) => pitchClass(m) === pitchClass(pc), window, strings, tuning);
}

export function positionsOfMidi(
  midi: number,
  window: FretWindow,
  strings?: readonly number[],
  tuning?: readonly number[],
): Position[] {
  return positionsWhere((m) => m === midi, window, strings, tuning);
}

/**
 * Distance of fret wire `n` from the nut, as a fraction of the scale length.
 * Equal temperament puts each fret 2^(-1/12) of the remaining string further
 * along, so fret 12 lands at exactly one half. Renderers scale this to pixels.
 */
export function fretDistance(n: number): number {
  return 1 - 2 ** (-n / 12);
}
