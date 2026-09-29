import { z } from "zod";
import { FORMULA_IDS } from "../theory/scales.js";
import { PATTERNS, SHAPES } from "../theory/sequence.js";

/**
 * fretwork's wire and config types.
 *
 * An exercise is a template: an engine plus the settings that engine needs.
 * Three engines cover every exercise in the starter catalog:
 *
 *   find      a set of targets on the neck, in any order or one per string
 *   sequence  an ordered list of pitches (a scale or arpeggio shape) to a click
 *   respond   the app names or plays a prompt and the player answers
 *
 * Grading happens in the browser, from the microphone; the server only stores
 * what the player built and how their runs went. Configs are stored as-is
 * (JSONB in Postgres, a map in Firestore), so adding a field is backwards
 * compatible only if it is optional or defaulted here.
 *
 * Wire rows are snake_case, like every other app in the stack, and both repos
 * produce exactly these keys.
 */

export const CATEGORIES = ["notes", "scales", "arpeggios", "ear"] as const;
export const CATEGORY = z.enum(CATEGORIES);
export type Category = z.infer<typeof CATEGORY>;

export const ENGINES = ["find", "sequence", "respond"] as const;
export type Engine = (typeof ENGINES)[number];

const pitchClass = z.number().int().min(0).max(11);

const fretWindow = z
  .object({
    lo: z.number().int().min(0).max(24),
    hi: z.number().int().min(0).max(24),
  })
  .refine((w) => w.lo <= w.hi, { message: "lo must not be above hi" });

/** String numbers, 1 = high E … 6 = low E. */
const strings = z
  .array(z.number().int().min(1).max(6))
  .min(1)
  .max(6)
  .refine((s) => new Set(s).size === s.length, { message: "strings must be unique" });

/**
 * `exact` checks the octave too, which keeps the player inside the fret
 * window; `pitch-class` accepts the note name in any octave. Neither can
 * check the string: a microphone hears pitch, not position.
 */
const grading = z.enum(["exact", "pitch-class"]);

const timeLimitSec = z.number().int().min(5).max(600).nullable();

export const findConfig = z.object({
  engine: z.literal("find"),
  /** One note name to hunt, or a random one each run. */
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("pitch-class"), pc: pitchClass }),
    z.object({ kind: z.literal("random") }),
  ]),
  /** `string-by-string` walks low E to high E, one target per string. */
  order: z.enum(["string-by-string", "any"]),
  frets: fretWindow,
  strings,
  grading,
  timeLimitSec,
});

const formulaKind = z.enum(["scale", "arpeggio"]);

/** A known formula id for its kind; ids are stable (theory/scales.ts). */
const knownFormula = (s: { kind: "scale" | "arpeggio"; formula: string }) =>
  (FORMULA_IDS[s.kind] as readonly string[]).includes(s.formula);

/** One chord or scale of a multi-part source, optionally in its own fret window. */
const sequencePart = z.object({
  kind: formulaKind,
  root: pitchClass,
  formula: z.string(),
  /** This part's window; defaults to the exercise's. */
  frets: fretWindow.optional(),
});

/**
 * What a sequence plays:
 *
 *   scale / arpeggio  one formula from a root: the original source
 *   notes             explicit pitch classes in the order given (a cycle of 4ths)
 *   parts             several formulas played in turn (ii–V–I, the five CAGED
 *                     shapes), each optionally in its own window and filtered
 *                     to chosen degrees (3 and 7 for guide tones)
 */
const sequenceSource = z
  .discriminatedUnion("kind", [
    z.object({ kind: formulaKind, root: pitchClass, formula: z.string() }),
    z.object({ kind: z.literal("notes"), pitchClasses: z.array(pitchClass).min(2).max(24) }),
    z.object({
      kind: z.literal("parts"),
      parts: z.array(sequencePart).min(1).max(12),
      /** Degree numbers to keep (1, 3, 5, 7 …, whatever their quality); all when absent. */
      degrees: z
        .array(z.number().int().min(1).max(7))
        .min(1)
        .max(7)
        .refine((d) => new Set(d).size === d.length, { message: "degrees must be unique" })
        .optional(),
    }),
  ])
  .superRefine((s, ctx) => {
    if ((s.kind === "scale" || s.kind === "arpeggio") && !knownFormula(s)) {
      ctx.addIssue({ code: "custom", message: "unknown formula for this kind", path: ["formula"] });
    }
    if (s.kind === "parts") {
      s.parts.forEach((p, i) => {
        if (!knownFormula(p)) {
          ctx.addIssue({ code: "custom", message: "unknown formula for this kind", path: ["parts", i, "formula"] });
        }
      });
    }
  });

export const sequenceConfig = z.object({
  engine: z.literal("sequence"),
  source: sequenceSource,
  frets: fretWindow,
  strings,
  pattern: z.enum(PATTERNS),
  /** How a formula is laid out in the window (theory/sequence.ts). Defaults to `lower-fret`, the box shapes. */
  shape: z.enum(SHAPES).optional(),
  grading,
  tempo: z.object({
    start: z.number().int().min(30).max(240),
    /** bpm added after `cleanRunsToAdvance` clean runs; 0 turns the ladder off. */
    step: z.number().int().min(0).max(20),
    cleanRunsToAdvance: z.number().int().min(1).max(10),
  }),
});

export const respondConfig = z.object({
  engine: z.literal("respond"),
  /**
   *   note-on-string   "F♯ on the G string" — fully checkable: a pitch occurs once per string
   *   play-heard-note  the app plays a pitch, the player finds it
   *   interval         the app names a root and an interval, the player plays both
   *   octave           "A on the low E string, then its octave": the note on
   *                    that string, then the pitch an octave up, on a higher string
   *   target-degree    a drone on a root; the player lands on a degree above it,
   *                    in any octave
   */
  prompt: z.enum(["note-on-string", "play-heard-note", "interval", "octave", "target-degree"]),
  pitchClasses: z.array(pitchClass).min(1).max(12),
  frets: fretWindow,
  strings,
  cards: z.number().int().min(1).max(100),
  /** Per card, for this engine: a card not answered in time is missed. */
  timeLimitSec,
  /**
   * `interval` and `target-degree`: semitones above the root to ask for.
   * Defaults to 3rds, 4th, 5th and octave for `interval`, and the two 3rds for
   * `target-degree`.
   */
  intervals: z
    .array(z.number().int().min(1).max(12))
    .min(1)
    .max(12)
    .refine((s) => new Set(s).size === s.length, { message: "intervals must be unique" })
    .optional(),
});

export const exerciseConfig = z.discriminatedUnion("engine", [
  findConfig,
  sequenceConfig,
  respondConfig,
]);
export type ExerciseConfig = z.infer<typeof exerciseConfig>;
export type FindConfig = z.infer<typeof findConfig>;
export type SequenceConfig = z.infer<typeof sequenceConfig>;
export type RespondConfig = z.infer<typeof respondConfig>;
export type SequenceSource = SequenceConfig["source"];

export const exerciseInput = z.object({
  name: z.string().trim().min(1).max(80),
  category: CATEGORY,
  config: exerciseConfig,
});
export type ExerciseInput = z.infer<typeof exerciseInput>;

export const exercisePatch = exerciseInput
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: "nothing to update" });
export type ExercisePatch = z.infer<typeof exercisePatch>;

export interface ExerciseRow {
  id: string;
  name: string;
  category: Category;
  engine: Engine;
  config: ExerciseConfig;
  /** Built-ins live in code (domain/catalog.ts), not in the database, and are read-only. */
  builtin: boolean;
  /** Null for built-ins. */
  created_at: string | null;
  updated_at: string | null;
}

// ---------- runs ----------

/** One graded note of a run. `string`/`fret` are the target position, not a detected one. */
export const noteResult = z.object({
  midi: z.number().int().min(0).max(127),
  ok: z.boolean(),
  /** Time from the prompt (or the previous note) to a correct answer. */
  ms: z.number().int().min(0).max(600_000),
  string: z.number().int().min(1).max(6).nullable(),
  fret: z.number().int().min(0).max(24).nullable(),
});
export type NoteResult = z.infer<typeof noteResult>;

export const runInput = z
  .object({
    exerciseId: z.string().uuid(),
    startedAt: z.string().datetime({ offset: true }),
    durationMs: z.number().int().min(0).max(4 * 60 * 60 * 1000),
    /** bpm for sequence runs; null for engines without a click. */
    tempo: z.number().int().min(20).max(300).nullable(),
    notesTotal: z.number().int().min(0).max(1000),
    notesClean: z.number().int().min(0).max(1000),
    /** Every note right first time — what the tempo ladder counts. */
    clean: z.boolean(),
    notes: z.array(noteResult).max(1000),
  })
  .refine((r) => r.notesClean <= r.notesTotal, {
    message: "notesClean cannot exceed notesTotal",
    path: ["notesClean"],
  });
export type RunInput = z.infer<typeof runInput>;

/** The per-note detail is stored but not listed; it feeds the fretboard heatmap. */
export interface RunRow {
  id: string;
  exercise_id: string;
  started_at: string;
  duration_ms: number;
  tempo: number | null;
  notes_total: number;
  notes_clean: number;
  clean: boolean;
  created_at: string;
}

// ---------- progress ----------

/** One exercise's progress, kept up to date as runs are recorded. */
export interface ProgressRow {
  exercise_id: string;
  /** The tempo ladder's current bpm; null for engines without a click. */
  tempo: number | null;
  clean_streak: number;
  /** The fastest bpm with a clean run. */
  best_tempo: number | null;
  runs: number;
  last_practiced_at: string;
}

/** One fretboard position's totals, from find and respond runs. */
export interface PositionStatRow {
  string: number;
  fret: number;
  attempts: number;
  hits: number;
  /** Time spent on the hits only: `total_ms / hits` is the average time to find it. */
  total_ms: number;
}

/** Practice on one local calendar day. */
export interface DayRow {
  /** YYYY-MM-DD in the requested time zone. */
  date: string;
  runs: number;
  duration_ms: number;
}

// ---------- routines and sessions ----------

/** One step of a routine: an exercise, and how long to spend on it. */
export const routineItem = z.object({
  exerciseId: z.string().uuid(),
  minutes: z.number().int().min(1).max(60),
});

export const routineInput = z.object({
  name: z.string().trim().min(1).max(80),
  items: z.array(routineItem).min(1).max(20),
});
export type RoutineInput = z.infer<typeof routineInput>;

export const routinePatch = routineInput
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: "nothing to update" });
export type RoutinePatch = z.infer<typeof routinePatch>;

/**
 * A player's own ordered practice list. Items are kept as given: an item whose
 * exercise was deleted later stays, and the session runner skips it.
 */
export interface RoutineRow {
  id: string;
  name: string;
  items: { exercise_id: string; minutes: number }[];
  created_at: string;
  updated_at: string;
}

/** Why the suggestion picked an item. */
export type SuggestionSlot = "weak-spot" | "tempo" | "revisit";

export interface SuggestedItem {
  exercise_id: string;
  minutes: number;
  slot: SuggestionSlot;
  /** One line for the player: "Your slowest patch: frets 7–10 on the G and B strings". */
  reason: string;
}

export interface SuggestedSession {
  minutes: number;
  items: SuggestedItem[];
}
