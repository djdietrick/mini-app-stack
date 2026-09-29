import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILTIN_EXERCISES } from "./catalog.js";
import { STALE_DAYS, suggestSession } from "./suggest.js";
import type { ExerciseRow, PositionStatRow, ProgressRow, SequenceConfig } from "./types.js";

const now = new Date("2026-09-29T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const named = (name: string) => BUILTIN_EXERCISES.find((e) => e.name === name)!;
const nameOf = (id: string) => [...BUILTIN_EXERCISES, gbDrill].find((e) => e.id === id)!.name;

/** A player's own find exercise on the G and B strings, frets 7–10. */
const gbDrill: ExerciseRow = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "G and B, frets 7–10",
  category: "notes",
  engine: "find",
  config: {
    engine: "find",
    target: { kind: "random" },
    order: "any",
    frets: { lo: 7, hi: 10 },
    strings: [3, 2],
    grading: "exact",
    timeLimitSec: null,
  },
  builtin: false,
  created_at: daysAgo(10),
  updated_at: daysAgo(10),
};

const progress = (e: ExerciseRow, days: number, extra: Partial<ProgressRow> = {}): ProgressRow => ({
  exercise_id: e.id,
  tempo: e.config.engine === "sequence" ? e.config.tempo.start : null,
  clean_streak: 0,
  best_tempo: null,
  runs: 3,
  last_practiced_at: daysAgo(days),
  ...extra,
});

/** Fast everywhere on frets 0–12, and slow (4.5 s a hit) on the G and B strings at frets 7–10. */
function mapWithSlowGB(): PositionStatRow[] {
  const out: PositionStatRow[] = [];
  for (let string = 1; string <= 6; string++) {
    for (let fret = 0; fret <= 12; fret++) {
      const slow = (string === 3 || string === 2) && fret >= 7 && fret <= 10;
      out.push({ string, fret, attempts: 2, hits: 2, total_ms: slow ? 9000 : 1600 });
    }
  }
  return out;
}

const suggest = (over: { exercises?: ExerciseRow[]; progress?: ProgressRow[]; positions?: PositionStatRow[] } = {}) =>
  suggestSession({
    exercises: over.exercises ?? BUILTIN_EXERCISES,
    progress: over.progress ?? [],
    positions: over.positions ?? [],
    now,
  });

describe("suggested session", () => {
  it("gives a new player three items, one per slot, about fifteen minutes", () => {
    const s = suggest();
    assert.deepEqual(
      s.items.map((i) => [i.slot, nameOf(i.exercise_id), i.minutes]),
      [
        ["weak-spot", "Note hunt", 5],
        ["tempo", "Natural notes on the A string", 6],
        ["revisit", "String flashcards", 4],
      ],
    );
    assert.equal(s.minutes, 15);
    assert.equal(s.items[0].reason, "Find notes to fill in your fretboard map");
    assert.equal(s.items[1].reason, "New: the ladder starts at 60 bpm");
    assert.equal(s.items[2].reason, "Not tried yet");
  });

  it("never suggests one exercise twice", () => {
    const only = [named("Note hunt"), named("A minor pentatonic · box 1")];
    const s = suggest({ exercises: only });
    assert.deepEqual(
      s.items.map((i) => i.slot),
      ["weak-spot", "tempo"],
    );
    assert.equal(s.minutes, 11);
  });

  it("aims the note finding at the slowest patch of the map", () => {
    const map = mapWithSlowGB();
    const built = suggest({ positions: map });
    assert.equal(built.items[0].reason, "Your slowest patch: frets 7–10 on the G and B strings");
    // Of the built-ins, Note hunt covers that patch and is the most focused on it.
    assert.equal(nameOf(built.items[0].exercise_id), "Note hunt");
    // A drill on just that patch beats one over the whole neck.
    const mine = suggest({ exercises: [...BUILTIN_EXERCISES, gbDrill], positions: map });
    assert.equal(mine.items[0].exercise_id, gbDrill.id);
  });

  it("follows the map as it changes", () => {
    const map = mapWithSlowGB().map((c) =>
      // The G and B strings got fast; now the low strings at the nut are the slow part.
      c.string >= 5 && c.fret <= 3 ? { ...c, total_ms: 14_000 } : (c.string === 3 || c.string === 2) ? { ...c, total_ms: 1600 } : c,
    );
    const s = suggest({ exercises: [...BUILTIN_EXERCISES, gbDrill], positions: map });
    assert.equal(s.items[0].reason, "Your slowest patch: frets 0–3 on the low E and A strings");
    assert.notEqual(s.items[0].exercise_id, gbDrill.id, "the G–B drill no longer fits");
    assert.equal(nameOf(s.items[0].exercise_id), "String flashcards", "Note hunt starts at fret 1; the flashcards cover the open strings");
  });

  it("picks the scale one clean run from a tempo bump", () => {
    const box1 = named("A minor pentatonic · box 1");
    const rule = (box1.config as SequenceConfig).tempo;
    const due = progress(box1, 0, { tempo: 84, clean_streak: rule.cleanRunsToAdvance - 1 });
    const s = suggest({ progress: [due] });
    assert.equal(s.items[1].exercise_id, box1.id);
    assert.equal(s.items[1].reason, `One clean run from ${84 + rule.step} bpm`);

    // Once the streak breaks, it is no longer due, and a new scale is up next.
    const broken = suggest({ progress: [{ ...due, clean_streak: 0 }] });
    assert.equal(nameOf(broken.items[1].exercise_id), "Natural notes on the A string");
  });

  it("brings back a scale not played for a while", () => {
    const box1 = named("A minor pentatonic · box 1");
    const s = suggest({ progress: [progress(box1, STALE_DAYS + 2)] });
    assert.equal(s.items[1].exercise_id, box1.id);
    assert.equal(s.items[1].reason, `Last played ${STALE_DAYS + 2} days ago`);
    // Played yesterday, it waits its turn.
    assert.notEqual(suggest({ progress: [progress(box1, 1)] }).items[1].exercise_id, box1.id);
  });

  it("revisits what has gone longest untouched once everything has been tried", () => {
    // Everything played in the last day or two, bar one ear exercise (neither a note-finder nor a sequence).
    const heard = named("Play what you hear");
    const all = BUILTIN_EXERCISES.map((e, i) => progress(e, e === heard ? 20 : 1 + (i % 2)));
    const s = suggest({ progress: all });
    assert.equal(s.items[2].exercise_id, heard.id);
    assert.equal(s.items[2].reason, "Last played 20 days ago");
    // Before that, never-tried exercises come round in library order.
    const some = suggest({ progress: [progress(named("String flashcards"), 1)] });
    assert.equal(nameOf(some.items[2].exercise_id), "Octave jumps");
  });
});
