import type { Category, ExerciseConfig } from "./api";
import type { SequenceConfig } from "../../src/domain/types.js";
import { DEFAULT_DEGREES } from "../../src/practice/respond.js";
import { sequenceKey, sequenceParts, sequenceTargets } from "../../src/practice/sequence.js";
import type { Dot } from "./components/Fretboard";
import {
  PATTERN_LABELS,
  SHAPE_LABELS,
  type Spelling,
  degreeLabel,
  degreeNumber,
  findFormula,
  intervalName,
  noteName,
  pitchClass,
  positionsOfPitchClass,
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

export function stringsLabel(strings: number[]): string {
  if (strings.length === 6) return "all strings";
  if (strings.length === 1) return `${stringName(strings[0])} string`;
  return `strings ${[...strings].sort((a, b) => b - a).join("-")}`;
}

export function fretsLabel(w: { lo: number; hi: number }): string {
  return w.lo === w.hi ? `fret ${w.lo}` : `frets ${w.lo}–${w.hi}`;
}

export const PROMPT_LABELS: Record<Extract<ExerciseConfig, { engine: "respond" }>["prompt"], string> = {
  "note-on-string": "Note on a string",
  "play-heard-note": "Play the note you hear",
  interval: "Play an interval",
  octave: "Note, then its octave",
  "target-degree": "Land on a degree over a drone",
};

/** The spelling a sequence's notes are named in. */
export function sequenceSpelling(c: SequenceConfig): Spelling {
  if (c.source.kind === "notes") {
    // A note order has no key; a run of 4ths reads in flats, anything else in sharps.
    const pcs = c.source.pitchClasses;
    const fourths = pcs.slice(1).filter((pc, i) => pitchClass(pc - pcs[i]) === 5).length;
    return fourths * 2 > pcs.length - 1 ? "flat" : "sharp";
  }
  const key = sequenceKey(c);
  return spellingForKey(key.root, key.minor);
}

/** A chord symbol for an arpeggio ("Dm7"), a name for a scale ("A minor pentatonic"). */
function formulaLabel(kind: "scale" | "arpeggio", root: number, formula: string, spelling: Spelling): string {
  const f = findFormula(kind, formula);
  if (kind === "arpeggio" && f?.symbol !== undefined) return noteName(root, spelling) + f.symbol;
  return `${noteName(root, spelling)} ${f?.name.toLowerCase() ?? formula}`;
}

/** Each part's label for a multi-part source ("Dm7", "G7", "Cmaj7", or "frets 3–5" for one chord in several places); empty otherwise. */
export function partLabels(c: SequenceConfig): string[] {
  if (c.source.kind !== "parts") return [];
  const spelling = sequenceSpelling(c);
  const labels = c.source.parts.map((p) => formulaLabel(p.kind, p.root, p.formula, spelling));
  // One chord in several places (CAGED): name the places instead.
  if (labels.every((l) => l === labels[0])) return c.source.parts.map((p) => fretsLabel(p.frets ?? c.frets));
  return labels;
}

/** What a sequence plays: "A minor pentatonic", "Dm7 → G7 → Cmaj7 · 3rds and 7ths", "C F B♭ E♭ …". */
export function sourceLabel(c: SequenceConfig): string {
  const spelling = sequenceSpelling(c);
  const src = c.source;
  switch (src.kind) {
    case "scale":
    case "arpeggio":
      return formulaLabel(src.kind, src.root, src.formula, spelling) + (src.kind === "arpeggio" ? " arpeggio" : "");
    case "notes": {
      const names = src.pitchClasses.map((pc) => noteName(pc, spelling));
      return names.length > 6 ? `${names.slice(0, 5).join(" ")} … ${names[names.length - 1]}` : names.join(" ");
    }
    case "parts": {
      const labels = src.parts.map((p) => formulaLabel(p.kind, p.root, p.formula, spelling));
      const same = labels.every((l) => l === labels[0]);
      const what = same && labels.length > 1 ? `${labels[0]} in ${labels.length} positions` : labels.join(" → ");
      const degrees = src.degrees ? ` · ${src.degrees.map(ordinal).join(" and ")}` : "";
      return what + degrees;
    }
  }
}

/** "3rd", "7th"; the 1st is the root. */
export function nth(n: number): string {
  return n === 1 ? "root" : `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}

function ordinal(n: number): string {
  return `${nth(n)}s`;
}

export function summary(e: { config: ExerciseConfig }): string {
  const c = e.config;
  switch (c.engine) {
    case "find": {
      const what = c.target.kind === "random" ? "a random note" : noteName(c.target.pc);
      const how = c.order === "string-by-string" ? "one per string" : "every position";
      return `Find ${what}, ${how} · ${fretsLabel(c.frets)}`;
    }
    case "sequence": {
      const shape = c.shape && c.shape !== "lower-fret" ? ` · ${SHAPE_LABELS[c.shape].toLowerCase()}` : "";
      return `${PATTERN_LABELS[c.pattern]}${shape} · ${fretsLabel(c.frets)} · ${stringsLabel(c.strings)} · ${c.tempo.start} bpm`;
    }
    case "respond": {
      const over =
        c.prompt === "target-degree"
          ? ` (${(c.intervals ?? DEFAULT_DEGREES).map((i) => intervalName(i)).join(", ")})`
          : "";
      return `${PROMPT_LABELS[c.prompt]}${over} · ${c.cards} cards · ${fretsLabel(c.frets)}`;
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

export function preview(e: { config: ExerciseConfig }): Preview {
  const c = e.config;
  const view = { lo: Math.max(0, c.frets.lo - 1), hi: Math.min(24, c.frets.hi + 1) };
  switch (c.engine) {
    case "sequence": {
      const spelling = sequenceSpelling(c);
      // One part: its own degrees. Several: every note against the key, so a
      // position shared by two chords reads the same either way.
      const parts = sequenceParts(c);
      const key = sequenceKey(c).root;
      const multi = parts.length > 1;
      const dots = new Map<string, Dot>();
      for (const p of parts) {
        for (const n of p.notes) {
          const interval = multi ? pitchClass(n.midi - key) : n.interval;
          const at = `${n.string}:${n.fret}`;
          if (!dots.has(at)) {
            dots.set(at, {
              string: n.string,
              fret: n.fret,
              name: noteName(n.midi, spelling),
              degree: degreeLabel(interval),
              tone: interval === 0 ? "root" : "note",
            });
          }
        }
      }
      return {
        view,
        window: c.frets,
        dots: [...dots.values()],
        sequence: sequenceTargets(c).map((n) => ({
          name: noteName(n.midi, spelling),
          degree: n.degree,
          root: n.interval === 0,
        })),
        caption: sourceLabel(c),
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
        caption:
          c.prompt === "target-degree"
            ? `Drone on ${c.pitchClasses.map((pc) => noteName(pc)).join(" ")} · land on the ${[...new Set((c.intervals ?? DEFAULT_DEGREES).map(degreeNumber))].map(nth).join(" or ")}`
            : `Notes: ${c.pitchClasses.map((pc) => noteName(pc)).join(" ")} · ${stringsLabel(c.strings)}`,
      };
  }
}
