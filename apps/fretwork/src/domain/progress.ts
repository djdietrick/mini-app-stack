import { z } from "zod";
import { type LadderRule, advanceLadder, clampTempo } from "../practice/sequence.js";
import type { DayRow, ExerciseConfig, NoteResult, RunInput } from "./types.js";

/**
 * Aggregates kept alongside the runs, so the progress screen, the tempo
 * ladder and suggestions never re-read a user's whole history. Both repos
 * fold each new run through the pure functions here inside the transaction
 * that inserts it, so the two backends cannot disagree on a rule.
 *
 *   progress   one row per (user, exercise): the tempo ladder, a clean streak,
 *              the run count and when it was last practiced
 *   positions  one cell per (user, string, fret): attempts, hits, and the
 *              time spent on the hits, for the fretboard map
 *   week       practice time per local day, computed from runs on read
 *
 * Aggregates start at the first run recorded after they shipped; older runs
 * are not backfilled. The sequence screen still rebuilds the ladder from past
 * runs (`ladderFromRuns`) for an exercise that has no progress row yet.
 */

// ---------- per-exercise progress ----------

/** What one exercise's progress holds, backend-neutral. */
export interface ProgressState {
  /** The ladder's current bpm. Null until a run with a tempo. */
  tempo: number | null;
  /** Clean runs in a row (at this tempo, for a laddered exercise). */
  cleanStreak: number;
  /** The fastest bpm with a clean run. */
  bestTempo: number | null;
  runs: number;
  /** ISO 8601; the latest `startedAt` recorded. Null only before the first run. */
  lastPracticedAt: string | null;
}

export const EMPTY_PROGRESS: ProgressState = {
  tempo: null,
  cleanStreak: 0,
  bestTempo: null,
  runs: 0,
  lastPracticedAt: null,
};

/** A sequence exercise's ladder: where it starts and how it climbs. */
export type LadderSpec = LadderRule & { start: number };

/** What recording a run against this exercise should fold, from its config. */
export interface RunEffects {
  /** Null for engines without a click. */
  ladder: LadderSpec | null;
  /**
   * Whether the run's notes feed the fretboard map. Only the note-finding
   * engines do: a sequence note's time is set by the click, not by how fast
   * the player found the note, so it would drag every shape's cells to the
   * tempo.
   */
  positions: boolean;
}

export function runEffects(config: ExerciseConfig): RunEffects {
  if (config.engine === "sequence") return { ladder: config.tempo, positions: false };
  return { ladder: null, positions: true };
}

/**
 * One run's effect on an exercise's progress. The ladder follows
 * `advanceLadder`, and a run at another tempo than the ladder's (set by hand
 * on the screen) restarts the streak there, exactly as `ladderFromRuns` does
 * on the client. Without a ladder, the streak just counts clean runs.
 */
export function foldProgress(prev: ProgressState, run: RunInput, ladder: LadderSpec | null): ProgressState {
  const lastPracticedAt = latest(prev.lastPracticedAt, new Date(run.startedAt).toISOString());
  const base = { runs: prev.runs + 1, lastPracticedAt };
  if (!ladder || run.tempo === null) {
    return { ...prev, ...base, cleanStreak: run.clean ? prev.cleanStreak + 1 : 0 };
  }
  let from = { tempo: prev.tempo ?? clampTempo(ladder.start), streak: prev.cleanStreak };
  if (run.tempo !== from.tempo) from = { tempo: run.tempo, streak: 0 };
  const next = advanceLadder(from, run.clean, ladder);
  return {
    ...base,
    tempo: next.tempo,
    cleanStreak: next.streak,
    bestTempo: run.clean ? Math.max(prev.bestTempo ?? 0, run.tempo) : prev.bestTempo,
  };
}

function latest(a: string | null, b: string): string {
  return a === null || b > a ? b : a;
}

// ---------- per-position stats ----------

export interface PositionCell {
  attempts: number;
  hits: number;
  /** Summed over hits only, so `totalMs / hits` is the average time to find it. */
  totalMs: number;
}

/** `"string:fret"`, the key both repos use for a cell. */
export const cellKey = (string: number, fret: number) => `${string}:${fret}`;

/**
 * A run's notes, grouped by the position they asked for. A note without a
 * position (a respond card that timed out before any answer) is skipped.
 */
export function foldPositions(notes: readonly NoteResult[]): Map<string, PositionCell & { string: number; fret: number }> {
  const out = new Map<string, PositionCell & { string: number; fret: number }>();
  for (const n of notes) {
    if (n.string === null || n.fret === null) continue;
    const key = cellKey(n.string, n.fret);
    const c = out.get(key) ?? { string: n.string, fret: n.fret, attempts: 0, hits: 0, totalMs: 0 };
    c.attempts += 1;
    if (n.ok) {
      c.hits += 1;
      c.totalMs += n.ms;
    }
    out.set(key, c);
  }
  return out;
}

// ---------- practice per day ----------

export const weekQuery = z.object({
  days: z.coerce.number().int().min(1).max(92).default(7),
  /** IANA time zone the days are counted in; the SPA sends the device's. */
  tz: z
    .string()
    .default("UTC")
    .refine(isTimeZone, { message: "unknown time zone" }),
});

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A cut-off early enough to cover `days` local days in any time zone (UTC−12 … UTC+14). */
export function weekSince(days: number, now: Date): string {
  return new Date(now.getTime() - (days + 2) * 86_400_000).toISOString();
}

/**
 * Practice per local day for the `days` days ending today, oldest first, with
 * the empty days in. A run counts on the day it started.
 */
export function practiceByDay(
  runs: readonly { started_at: string; duration_ms: number }[],
  opts: { days: number; tz: string; now: Date },
): DayRow[] {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: opts.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDate = (d: Date) => {
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };

  // Step back through the calendar from today's local date: pure date
  // arithmetic, so a DST change never skips or doubles a day.
  const [y, m, d] = localDate(opts.now).split("-").map(Number);
  const out: DayRow[] = [];
  for (let i = opts.days - 1; i >= 0; i--) {
    out.push({ date: new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10), runs: 0, duration_ms: 0 });
  }
  const byDate = new Map(out.map((day) => [day.date, day]));
  for (const r of runs) {
    const day = byDate.get(localDate(new Date(r.started_at)));
    if (!day) continue;
    day.runs += 1;
    day.duration_ms += r.duration_ms;
  }
  return out;
}
