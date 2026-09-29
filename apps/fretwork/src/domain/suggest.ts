import { describeZone, weakestZone, type Zone } from "../practice/zones.js";
import type {
  ExerciseConfig,
  ExerciseRow,
  PositionStatRow,
  ProgressRow,
  SuggestedItem,
  SuggestedSession,
} from "./types.js";

/**
 * Today's suggested session (GET /sessions/suggested): three items, about
 * fifteen minutes, from the player's progress and fretboard map. Pure, so the
 * rule is unit-tested and both backends serve the same answer.
 *
 * Heuristic v1, one item per slot, never the same exercise twice:
 *
 *   weak-spot  a note-finding exercise (find, or flashcards that pin a string)
 *              aimed at the slowest patch of the map (`weakestZone`): the one
 *              covering most of that patch, then the one most focused on it.
 *              Before the map has a weakest patch, the note-finder practiced
 *              least recently.
 *   tempo      a sequence one clean run from its next tempo bump; else one not
 *              played for STALE_DAYS; else one never played; else the one
 *              played least recently.
 *   revisit    whatever else has gone longest untouched. Never played counts as
 *              longest, in library order, so new exercises come round in turn.
 */

export const SLOT_MINUTES = { "weak-spot": 5, tempo: 6, revisit: 4 } as const;

/** A sequence not played for this long is due, even without a tempo bump in reach. */
export const STALE_DAYS = 3;

export interface SuggestInput {
  /** Built-ins in library order, then the player's own. */
  exercises: readonly ExerciseRow[];
  progress: readonly ProgressRow[];
  positions: readonly PositionStatRow[];
  now: Date;
}

export function suggestSession({ exercises, progress, positions, now }: SuggestInput): SuggestedSession {
  const played = new Map(progress.map((p) => [p.exercise_id, p]));
  const taken = new Set<string>();
  const items: SuggestedItem[] = [];
  const add = (e: ExerciseRow | undefined, slot: SuggestedItem["slot"], reason: string) => {
    if (!e) return;
    taken.add(e.id);
    items.push({ exercise_id: e.id, minutes: SLOT_MINUTES[slot], slot, reason });
  };
  const free = (pred: (e: ExerciseRow) => boolean) => exercises.filter((e) => !taken.has(e.id) && pred(e));
  const ago = (e: ExerciseRow) => daysAgo(played.get(e.id)?.last_practiced_at, now);

  // 1 · weak spot
  const finders = free((e) => mapsPositions(e.config));
  const zone = weakestZone(positions);
  if (zone) {
    const best = maxBy(finders, (e) => [zoneCover(e.config, zone), zoneFocus(e.config, zone), staleness(played.get(e.id))]);
    add(best, "weak-spot", `Your slowest patch: ${describeZone(zone)}`);
  } else {
    const best = maxBy(finders, (e) => [staleness(played.get(e.id))]);
    add(best, "weak-spot", "Find notes to fill in your fretboard map");
  }

  // 2 · tempo
  const sequences = free((e) => e.config.engine === "sequence");
  const due = sequences.filter((e) => bumpDue(e.config, played.get(e.id)));
  const stale = sequences.filter((e) => (ago(e) ?? -1) >= STALE_DAYS);
  const fresh = sequences.filter((e) => !played.has(e.id));
  if (due.length) {
    const e = maxBy(due, (x) => [streakShare(x.config, played.get(x.id)), staleness(played.get(x.id))])!;
    const p = played.get(e.id)!;
    add(e, "tempo", `One clean run from ${p.tempo! + tempoStep(e.config)} bpm`);
  } else if (stale.length) {
    const e = maxBy(stale, (x) => [staleness(played.get(x.id))])!;
    add(e, "tempo", `Last played ${plural(ago(e)!, "day")} ago`);
  } else if (fresh.length) {
    const e = fresh[0];
    add(e, "tempo", e.config.engine === "sequence" ? `New: the ladder starts at ${e.config.tempo.start} bpm` : "New");
  } else {
    const e = maxBy(sequences, (x) => [staleness(played.get(x.id))]);
    if (e) add(e, "tempo", `Played least recently of your scales and arpeggios`);
  }

  // 3 · revisit
  const rest = free(() => true);
  const untried = rest.find((e) => !played.has(e.id));
  if (untried) {
    add(untried, "revisit", "Not tried yet");
  } else {
    const e = maxBy(rest, (x) => [staleness(played.get(x.id))]);
    if (e) {
      const d = ago(e)!;
      add(e, "revisit", d === 0 ? "Played least recently" : `Last played ${plural(d, "day")} ago`);
    }
  }

  return { minutes: items.reduce((n, i) => n + i.minutes, 0), items };
}

/** Whether an exercise's runs feed the fretboard map: every run pins each note to a position. */
function mapsPositions(c: ExerciseConfig): boolean {
  return c.engine === "find" || (c.engine === "respond" && (c.prompt === "note-on-string" || c.prompt === "octave"));
}

function cells(c: ExerciseConfig): Set<string> {
  const out = new Set<string>();
  for (const s of c.strings) for (let f = c.frets.lo; f <= c.frets.hi; f++) out.add(`${s}:${f}`);
  return out;
}

function zoneCells(z: Zone): string[] {
  const out: string[] = [];
  for (const s of z.strings) for (let f = z.frets.lo; f <= z.frets.hi; f++) out.push(`${s}:${f}`);
  return out;
}

/** Share of the zone the exercise asks about, 0–1. */
function zoneCover(c: ExerciseConfig, z: Zone): number {
  const mine = cells(c);
  const zone = zoneCells(z);
  return zone.filter((k) => mine.has(k)).length / zone.length;
}

/** Share of the exercise that is the zone, 0–1: a drill on just that patch beats one over the whole neck. */
function zoneFocus(c: ExerciseConfig, z: Zone): number {
  const mine = cells(c);
  return zoneCells(z).filter((k) => mine.has(k)).length / mine.size;
}

function tempoStep(c: ExerciseConfig): number {
  return c.engine === "sequence" ? c.tempo.step : 0;
}

/** One clean run from the next bump, on a ladder that climbs. */
function bumpDue(c: ExerciseConfig, p: ProgressRow | undefined): boolean {
  if (c.engine !== "sequence" || !p || p.tempo === null || c.tempo.step === 0) return false;
  return p.clean_streak + 1 >= c.tempo.cleanRunsToAdvance;
}

function streakShare(c: ExerciseConfig, p: ProgressRow | undefined): number {
  return c.engine === "sequence" && p ? p.clean_streak / c.tempo.cleanRunsToAdvance : 0;
}

/** Larger is longer ago; never played is the largest of all. */
function staleness(p: ProgressRow | undefined): number {
  return p ? -Date.parse(p.last_practiced_at) : Infinity;
}

/** Whole days since `iso`, or undefined when never. */
function daysAgo(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000));
}

/** The first item with the largest key, compared element by element. Ties keep the earlier item. */
function maxBy<T>(xs: readonly T[], key: (x: T) => number[]): T | undefined {
  let best: T | undefined;
  let bestKey: number[] = [];
  for (const x of xs) {
    const k = key(x);
    if (best === undefined || compare(k, bestKey) > 0) {
      best = x;
      bestKey = k;
    }
  }
  return best;
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
