import type { Category, ExerciseConfig, ExerciseRow } from "./types.js";

/**
 * The starter library. These live in code rather than in either database so
 * every user gets them, they version with the app, and neither backend needs
 * seeding. Each has a fixed UUID so runs can reference a built-in exactly as
 * they reference a user's own exercise, and `z.string().uuid()` holds for both.
 *
 * Never change an id: runs and progress point at it. To retire a built-in,
 * drop it from this list; its old runs stay in the user's history. The order
 * here is the library's order; ids are what stay fixed.
 */
interface Builtin {
  id: string;
  name: string;
  category: Category;
  config: ExerciseConfig;
}

const ALL_STRINGS = [1, 2, 3, 4, 5, 6];

const BUILTINS: Builtin[] = [
  {
    id: "e80fdaad-a6d2-46be-b29d-ab3288186651",
    name: "Note hunt",
    category: "notes",
    config: {
      engine: "find",
      target: { kind: "random" },
      order: "string-by-string",
      frets: { lo: 1, hi: 12 },
      strings: ALL_STRINGS,
      grading: "exact",
      timeLimitSec: null,
    },
  },
  {
    id: "1242f23a-3f8e-4ac1-be80-c43cde3130c7",
    name: "String flashcards",
    category: "notes",
    config: {
      engine: "respond",
      prompt: "note-on-string",
      pitchClasses: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      frets: { lo: 0, hi: 12 },
      strings: ALL_STRINGS,
      cards: 20,
      timeLimitSec: null,
    },
  },
  {
    id: "9ab4a1ec-5677-4fe8-8676-cc0a5bcf5507",
    name: "Octave jumps",
    category: "notes",
    config: {
      engine: "respond",
      prompt: "octave",
      pitchClasses: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      frets: { lo: 0, hi: 12 },
      strings: ALL_STRINGS,
      cards: 20,
      timeLimitSec: null,
    },
  },
  {
    id: "bff37f45-e224-4dc0-80c1-4891ddcef0a3",
    name: "Natural notes on the A string",
    category: "notes",
    config: {
      engine: "sequence",
      source: { kind: "scale", root: 0, formula: "major" },
      frets: { lo: 0, hi: 12 },
      strings: [5],
      pattern: "updown",
      grading: "exact",
      tempo: { start: 60, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "36cf821c-2d96-413a-8336-6f0d9d7a1b1f",
    name: "G major on the low E string",
    category: "notes",
    config: {
      engine: "sequence",
      source: { kind: "scale", root: 7, formula: "major" },
      frets: { lo: 3, hi: 15 },
      strings: [6],
      pattern: "updown",
      grading: "exact",
      tempo: { start: 60, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "2ee9f1bc-7136-4d17-a876-e7b8c27f16c4",
    name: "D major on the D string",
    category: "notes",
    config: {
      engine: "sequence",
      source: { kind: "scale", root: 2, formula: "major" },
      frets: { lo: 0, hi: 12 },
      strings: [4],
      pattern: "updown",
      grading: "exact",
      tempo: { start: 60, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "1b4a053d-ae0e-48ab-ae1c-b78bb3f9bf5c",
    name: "Cycle of 4ths on the low strings",
    category: "notes",
    config: {
      engine: "sequence",
      source: { kind: "notes", pitchClasses: [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7] },
      frets: { lo: 0, hi: 6 },
      strings: [6, 5],
      pattern: "up",
      grading: "exact",
      tempo: { start: 60, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "a1d0bec2-dfb5-42f7-8148-3331b2abff66",
    name: "A minor pentatonic · box 1",
    category: "scales",
    config: {
      engine: "sequence",
      source: { kind: "scale", root: 9, formula: "minor-pentatonic" },
      frets: { lo: 5, hi: 8 },
      strings: ALL_STRINGS,
      pattern: "updown",
      grading: "exact",
      tempo: { start: 80, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "5afaccfc-d3db-4d0b-aed0-7ffeb8da1e94",
    name: "A minor pentatonic · box 2",
    category: "scales",
    config: {
      engine: "sequence",
      source: { kind: "scale", root: 9, formula: "minor-pentatonic" },
      frets: { lo: 7, hi: 10 },
      strings: ALL_STRINGS,
      pattern: "updown",
      grading: "exact",
      tempo: { start: 80, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "15a2baf9-a3b9-4579-b653-f43d190a3118",
    name: "A minor pentatonic · box 3",
    category: "scales",
    config: {
      engine: "sequence",
      source: { kind: "scale", root: 9, formula: "minor-pentatonic" },
      frets: { lo: 9, hi: 13 },
      strings: ALL_STRINGS,
      pattern: "updown",
      grading: "exact",
      tempo: { start: 80, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "17426e88-db9b-4919-92fa-e4eed1732272",
    name: "A minor pentatonic · box 4",
    category: "scales",
    config: {
      engine: "sequence",
      source: { kind: "scale", root: 9, formula: "minor-pentatonic" },
      frets: { lo: 12, hi: 15 },
      strings: ALL_STRINGS,
      pattern: "updown",
      grading: "exact",
      tempo: { start: 80, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "377417c9-cfeb-4b95-baa6-219a454cfbee",
    name: "A minor pentatonic · box 5",
    category: "scales",
    config: {
      engine: "sequence",
      source: { kind: "scale", root: 9, formula: "minor-pentatonic" },
      frets: { lo: 14, hi: 17 },
      strings: ALL_STRINGS,
      pattern: "updown",
      grading: "exact",
      tempo: { start: 80, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "20609db3-1526-4281-8ff0-ede904f4b4d1",
    name: "A minor pentatonic · box 1 into box 2",
    category: "scales",
    config: {
      engine: "sequence",
      source: { kind: "scale", root: 9, formula: "minor-pentatonic" },
      frets: { lo: 5, hi: 10 },
      strings: ALL_STRINGS,
      pattern: "updown",
      shape: "higher-fret",
      grading: "exact",
      tempo: { start: 70, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "616eaa2a-1e8d-4044-ba65-c247ff864ca8",
    name: "G major in groups of 3",
    category: "scales",
    config: {
      engine: "sequence",
      source: { kind: "scale", root: 7, formula: "major" },
      frets: { lo: 2, hi: 5 },
      strings: ALL_STRINGS,
      pattern: "groups3",
      grading: "exact",
      tempo: { start: 60, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "7748cb30-5287-465c-95d5-bf9607c2c5ec",
    name: "G major · three notes per string",
    category: "scales",
    config: {
      engine: "sequence",
      source: { kind: "scale", root: 7, formula: "major" },
      frets: { lo: 3, hi: 8 },
      strings: ALL_STRINGS,
      pattern: "updown",
      shape: "three-per-string",
      grading: "exact",
      tempo: { start: 60, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "27c18fe7-6d7c-42ed-8ed2-e3a4d4d3d283",
    name: "C major triad on strings 3-2-1",
    category: "arpeggios",
    config: {
      engine: "sequence",
      source: { kind: "arpeggio", root: 0, formula: "major-triad" },
      frets: { lo: 0, hi: 12 },
      strings: [1, 2, 3],
      pattern: "updown",
      grading: "exact",
      tempo: { start: 70, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "5d96d915-3b9a-4585-86d1-df6fff078daf",
    name: "A minor arpeggio · frets 5–8",
    category: "arpeggios",
    config: {
      engine: "sequence",
      source: { kind: "arpeggio", root: 9, formula: "minor-triad" },
      frets: { lo: 5, hi: 8 },
      strings: ALL_STRINGS,
      pattern: "updown",
      grading: "exact",
      tempo: { start: 70, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "03c9f915-d225-4903-af26-fc3e282c9505",
    name: "C major arpeggio · five CAGED shapes",
    category: "arpeggios",
    config: {
      engine: "sequence",
      source: {
        kind: "parts",
        parts: [
          { kind: "arpeggio", root: 0, formula: "major-triad", frets: { lo: 0, hi: 3 } },
          { kind: "arpeggio", root: 0, formula: "major-triad", frets: { lo: 3, hi: 5 } },
          { kind: "arpeggio", root: 0, formula: "major-triad", frets: { lo: 5, hi: 8 } },
          { kind: "arpeggio", root: 0, formula: "major-triad", frets: { lo: 8, hi: 10 } },
          { kind: "arpeggio", root: 0, formula: "major-triad", frets: { lo: 10, hi: 13 } },
        ],
      },
      frets: { lo: 0, hi: 13 },
      strings: ALL_STRINGS,
      pattern: "updown",
      grading: "exact",
      tempo: { start: 70, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "9ceb13e5-bdb3-42e4-b3c5-b44928bdd9fc",
    name: "ii–V–I sevenths in C · frets 7–10",
    category: "arpeggios",
    config: {
      engine: "sequence",
      source: {
        kind: "parts",
        parts: [
          { kind: "arpeggio", root: 2, formula: "min7" },
          { kind: "arpeggio", root: 7, formula: "dom7" },
          { kind: "arpeggio", root: 0, formula: "maj7" },
        ],
      },
      frets: { lo: 7, hi: 10 },
      strings: ALL_STRINGS,
      pattern: "up",
      grading: "exact",
      tempo: { start: 60, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "c6f6821d-08cf-47bb-9615-6a8f72692815",
    name: "Guide tones through ii–V–I in C",
    category: "arpeggios",
    config: {
      engine: "sequence",
      source: {
        kind: "parts",
        parts: [
          { kind: "arpeggio", root: 2, formula: "min7" },
          { kind: "arpeggio", root: 7, formula: "dom7" },
          { kind: "arpeggio", root: 0, formula: "maj7" },
        ],
        degrees: [3, 7],
      },
      frets: { lo: 7, hi: 10 },
      strings: ALL_STRINGS,
      pattern: "up",
      grading: "exact",
      tempo: { start: 60, step: 4, cleanRunsToAdvance: 3 },
    },
  },
  {
    id: "bd4577fd-afeb-46fe-af45-252fa20d0cff",
    name: "Play what you hear",
    category: "ear",
    config: {
      engine: "respond",
      prompt: "play-heard-note",
      pitchClasses: [0, 2, 4, 5, 7, 9, 11],
      frets: { lo: 0, hi: 5 },
      strings: ALL_STRINGS,
      cards: 10,
      timeLimitSec: null,
    },
  },
  {
    id: "ec348194-514c-484e-9390-af5d779d630f",
    name: "Interval finder",
    category: "ear",
    config: {
      engine: "respond",
      prompt: "interval",
      pitchClasses: [0, 2, 4, 5, 7, 9, 11],
      frets: { lo: 0, hi: 7 },
      strings: ALL_STRINGS,
      cards: 10,
      timeLimitSec: null,
    },
  },
  {
    id: "27e8069a-985f-43ec-81bd-324462b66fbe",
    name: "Land on the 3rd over a drone",
    category: "ear",
    config: {
      engine: "respond",
      prompt: "target-degree",
      pitchClasses: [0, 2, 4, 5, 7, 9],
      frets: { lo: 0, hi: 12 },
      strings: ALL_STRINGS,
      cards: 10,
      timeLimitSec: null,
      intervals: [3, 4],
    },
  },
];

export const BUILTIN_EXERCISES: readonly ExerciseRow[] = BUILTINS.map((b) => ({
  id: b.id,
  name: b.name,
  category: b.category,
  engine: b.config.engine,
  config: b.config,
  builtin: true,
  created_at: null,
  updated_at: null,
}));

const byId = new Map(BUILTIN_EXERCISES.map((e) => [e.id, e]));

export function builtinExercise(id: string): ExerciseRow | undefined {
  return byId.get(id);
}
