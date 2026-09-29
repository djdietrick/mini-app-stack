import type { Category, ExerciseConfig, ExerciseRow } from "./types.js";

/**
 * The starter library. These live in code rather than in either database so
 * every user gets them, they version with the app, and neither backend needs
 * seeding. Each has a fixed UUID so runs can reference a built-in exactly as
 * they reference a user's own exercise, and `z.string().uuid()` holds for both.
 *
 * Never change an id: runs and progress point at it. To retire a built-in,
 * drop it from this list; its old runs stay in the user's history.
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
