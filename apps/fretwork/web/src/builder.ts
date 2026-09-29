import type { Category, ExerciseConfig } from "./api";
import type { FindConfig, RespondConfig, SequenceConfig } from "../../src/domain/types.js";
import { findSlots } from "../../src/practice/find.js";
import { cardPool } from "../../src/practice/respond.js";
import { sequenceParts, sequenceTargets } from "../../src/practice/sequence.js";
import { SHAPE_LABELS, noteName } from "../../src/theory/index.js";
import { PROMPT_LABELS, fretsLabel, sourceLabel, stringsLabel } from "./describe";

/**
 * The exercise builder's rules, apart from its screen: what each type starts
 * as, the name and category it suggests, and what the live preview warns
 * about. Server-side validation is still the authority (the zod schemas stay
 * out of the bundle); these only keep the form honest as it changes.
 */

/** What the type picker offers. `sequence` is a note order or multi-part source, which the form can't edit. */
export type BuildType = "scale" | "arpeggio" | "find" | "respond" | "sequence";

export const BUILD_TYPES: { type: Exclude<BuildType, "sequence">; label: string; hint: string }[] = [
  { type: "scale", label: "Scale", hint: "Play it in order, to a click" },
  { type: "arpeggio", label: "Arpeggio", hint: "Chord tones in order, to a click" },
  { type: "find", label: "Find a note", hint: "Every place a note lives" },
  { type: "respond", label: "Flashcards", hint: "One prompt at a time" },
];

const ALL = [1, 2, 3, 4, 5, 6];

export function buildTypeOf(c: ExerciseConfig): BuildType {
  if (c.engine === "sequence") return c.source.kind === "scale" || c.source.kind === "arpeggio" ? c.source.kind : "sequence";
  return c.engine;
}

/**
 * A fresh config for a type, carrying over the window and strings from the
 * one being replaced so switching type doesn't lose them.
 */
export function defaultConfig(type: Exclude<BuildType, "sequence">, from?: ExerciseConfig): ExerciseConfig {
  const frets = from?.frets ?? (type === "scale" || type === "arpeggio" ? { lo: 5, hi: 8 } : { lo: 0, hi: 12 });
  const strings = from?.strings ?? ALL;
  switch (type) {
    case "scale":
    case "arpeggio": {
      const tempo = from?.engine === "sequence" ? from.tempo : { start: 80, step: 4, cleanRunsToAdvance: 3 };
      return {
        engine: "sequence",
        source: { kind: type, root: 9, formula: type === "scale" ? "minor-pentatonic" : "minor-triad" },
        frets,
        strings,
        pattern: "updown",
        grading: "exact",
        tempo,
      };
    }
    case "find":
      return {
        engine: "find",
        target: { kind: "random" },
        order: "string-by-string",
        frets,
        strings,
        grading: "exact",
        timeLimitSec: null,
      };
    case "respond":
      return {
        engine: "respond",
        prompt: "note-on-string",
        pitchClasses: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        frets,
        strings,
        cards: 20,
        timeLimitSec: null,
      };
  }
}

export function autoCategory(c: ExerciseConfig, fallback: Category = "notes"): Category {
  switch (c.engine) {
    case "sequence":
      return c.source.kind === "scale" ? "scales" : c.source.kind === "arpeggio" ? "arpeggios" : fallback;
    case "find":
      return "notes";
    case "respond":
      return c.prompt === "note-on-string" || c.prompt === "octave" ? "notes" : "ear";
  }
}

/** "A minor pentatonic · frets 5–8", "Find every G · frets 0–12 · strings 6-5". */
export function autoName(c: ExerciseConfig): string {
  const where = c.strings.length === 6 ? "" : ` · ${stringsLabel(c.strings)}`;
  const what =
    c.engine === "sequence"
      ? sourceLabel(c) + (c.shape && c.shape !== "lower-fret" ? ` · ${SHAPE_LABELS[c.shape].toLowerCase()}` : "")
      : c.engine === "find"
        ? c.target.kind === "random"
          ? "Note hunt"
          : `Find every ${noteName(c.target.pc)}`
        : PROMPT_LABELS[c.prompt];
  return `${what} · ${fretsLabel(c.frets)}${where}`.slice(0, 80);
}

export interface Note {
  tone: "warn" | "info";
  text: string;
}

/** What the preview should say about the config as it stands. */
export function previewNotes(c: ExerciseConfig): Note[] {
  const out: Note[] = [];
  switch (c.engine) {
    case "sequence":
      out.push(...sequenceNotes(c));
      break;
    case "find":
      out.push(...findNotes(c));
      break;
    case "respond":
      out.push(...respondNotes(c));
      break;
  }
  // Pitch is not position: say what a string restriction does and doesn't do.
  if (c.engine !== "respond" && c.strings.length < 6) {
    out.push({
      tone: "info",
      text:
        c.grading === "exact"
          ? "Exact grading checks the pitch and its octave, not the string: a mic hears pitch, not position. The same pitch played on a string you left out still counts."
          : "Any octave counts, anywhere on the neck. The strings you pick set what's shown and asked for; a mic can't tell strings apart.",
    });
  }
  return out;
}

function sequenceNotes(c: SequenceConfig): Note[] {
  const distinct = new Set(sequenceParts(c).flatMap((p) => p.notes.map((n) => n.midi))).size;
  const total = sequenceTargets(c).length;
  if (distinct === 0) return [{ tone: "warn", text: `None of these notes fit in ${fretsLabel(c.frets)} on ${stringsLabel(c.strings)}. Widen the window or add strings.` }];
  if (distinct < 3) return [{ tone: "warn", text: `Only ${distinct} ${distinct === 1 ? "note fits" : "notes fit"} in this window. Widen it or add strings.` }];
  if (total > 120) return [{ tone: "info", text: `${total} notes to a run: a long one. A narrower window keeps runs short enough to repeat.` }];
  return [];
}

function findNotes(c: FindConfig): Note[] {
  if (c.target.kind === "pitch-class") {
    const slots = findSlots(c, c.target.pc);
    if (!slots.length) return [{ tone: "warn", text: `There's no ${noteName(c.target.pc)} in ${fretsLabel(c.frets)} on these strings.` }];
    if (c.order === "string-by-string" && slots.length < c.strings.length) {
      return [{ tone: "info", text: `${noteName(c.target.pc)} isn't on every string in this window; those strings are skipped.` }];
    }
    return [];
  }
  // A random note: every note is on every string only with 12 frets or more.
  if (c.frets.hi - c.frets.lo + 1 < 12) {
    const missing = [...Array(12).keys()].filter((pc) => findSlots(c, pc).length === 0);
    if (missing.length) {
      return [{ tone: "warn", text: `${missing.map((pc) => noteName(pc)).join(" ")} ${missing.length === 1 ? "isn't" : "aren't"} in this window at all. Widen it to 12 frets to cover every note.` }];
    }
    return [{ tone: "info", text: "With fewer than 12 frets, some notes aren't on every string; those strings are skipped for that note." }];
  }
  return [];
}

function respondNotes(c: RespondConfig): Note[] {
  const n = cardPool(c).length;
  if (n === 0) return [{ tone: "warn", text: "Nothing to ask: no card fits this window, these strings and these notes." }];
  if (n < 3) return [{ tone: "warn", text: `Only ${n} ${n === 1 ? "card fits" : "cards fit"}: the deck will keep repeating ${n === 1 ? "it" : "them"}.` }];
  if (c.prompt === "target-degree") {
    return [{ tone: "info", text: "Plays a drone on each card's root. Use headphones if you can; the drone's own notes are ignored either way." }];
  }
  return [];
}
