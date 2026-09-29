import type { Category, ExerciseConfig, ExerciseRow } from "./api";
import type { Dot } from "./components/Fretboard";
import {
  PATTERN_LABELS,
  type ShapeNote,
  applyPattern,
  findFormula,
  isMinorFormula,
  noteName,
  positionsOfPitchClass,
  shapeInWindow,
  spellingForKey,
  stringName,
} from "../../src/theory/index.js";

/** Human-readable summaries and preview data for an exercise config. */

export const CATEGORY_LABELS: Record<Category, string> = {
  notes: "Notes",
  scales: "Scales",
  arpeggios: "Arps",
  ear: "Ear",
};

export const ENGINE_LABELS: Record<ExerciseConfig["engine"], string> = {
  find: "Find",
  sequence: "Sequence",
  respond: "Respond",
};

function stringsLabel(strings: number[]): string {
  if (strings.length === 6) return "all strings";
  if (strings.length === 1) return `${stringName(strings[0])} string`;
  return `strings ${[...strings].sort((a, b) => b - a).join("-")}`;
}

function fretsLabel(w: { lo: number; hi: number }): string {
  return w.lo === w.hi ? `fret ${w.lo}` : `frets ${w.lo}–${w.hi}`;
}

export function summary(e: ExerciseRow): string {
  const c = e.config;
  switch (c.engine) {
    case "find": {
      const what = c.target.kind === "random" ? "a random note" : noteName(c.target.pc);
      const how = c.order === "string-by-string" ? "one per string" : "every position";
      return `Find ${what}, ${how} · ${fretsLabel(c.frets)}`;
    }
    case "sequence":
      return `${PATTERN_LABELS[c.pattern]} · ${fretsLabel(c.frets)} · ${stringsLabel(c.strings)} · ${c.tempo.start} bpm`;
    case "respond": {
      const prompt =
        c.prompt === "note-on-string"
          ? "Note on a string"
          : c.prompt === "play-heard-note"
            ? "Play the note you hear"
            : "Play an interval";
      return `${prompt} · ${c.cards} cards · ${fretsLabel(c.frets)}`;
    }
  }
}

export interface Preview {
  /** Frets to draw: the exercise's window with a fret of context either side. */
  view: { lo: number; hi: number };
  window: { lo: number; hi: number };
  dots: Dot[];
  /** Ordered notes to play, for sequence exercises. */
  sequence: { name: string; degree: string; root: boolean }[];
  caption: string;
}

export function preview(e: ExerciseRow): Preview {
  const c = e.config;
  const view = { lo: Math.max(0, c.frets.lo - 1), hi: Math.min(24, c.frets.hi + 1) };
  switch (c.engine) {
    case "sequence": {
      const formula = findFormula(c.source.kind, c.source.formula);
      const shape: ShapeNote[] = formula
        ? shapeInWindow(c.source.root, formula.intervals, c.frets, c.strings)
        : [];
      const spelling = formula ? spellingForKey(c.source.root, isMinorFormula(formula)) : "sharp";
      return {
        view,
        window: c.frets,
        dots: shape.map((n) => ({
          string: n.string,
          fret: n.fret,
          name: noteName(n.midi, spelling),
          degree: n.degree,
          tone: n.interval === 0 ? "root" : "note",
        })),
        sequence: applyPattern(shape, c.pattern).map((n) => ({
          name: noteName(n.midi, spelling),
          degree: n.degree,
          root: n.interval === 0,
        })),
        caption: `${noteName(c.source.root, spelling)} ${formula?.name.toLowerCase() ?? c.source.formula}`,
      };
    }
    case "find": {
      const pc = c.target.kind === "pitch-class" ? c.target.pc : null;
      return {
        view,
        window: c.frets,
        dots:
          pc === null
            ? []
            : positionsOfPitchClass(pc, c.frets, c.strings).map((p) => ({
                string: p.string,
                fret: p.fret,
                name: noteName(pc),
                tone: "hint" as const,
              })),
        sequence: [],
        caption: pc === null ? "A new note every run" : `Every ${noteName(pc)} in the window`,
      };
    }
    case "respond":
      return {
        view,
        window: c.frets,
        dots: [],
        sequence: [],
        caption: `Notes: ${c.pitchClasses.map((pc) => noteName(pc)).join(" ")} · ${stringsLabel(c.strings)}`,
      };
  }
}
