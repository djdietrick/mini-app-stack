import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ladderFromRuns } from "../practice/sequence.js";
import { BUILTIN_EXERCISES } from "./catalog.js";
import {
  EMPTY_PROGRESS,
  type LadderSpec,
  type ProgressState,
  foldPositions,
  foldProgress,
  practiceByDay,
  runEffects,
  weekQuery,
  weekSince,
} from "./progress.js";
import type { RunInput } from "./types.js";

const ladder: LadderSpec = { start: 60, step: 4, cleanRunsToAdvance: 2 };

let t = Date.UTC(2026, 8, 1, 10);
const run = (clean: boolean, tempo: number | null, extra: Partial<RunInput> = {}): RunInput => ({
  exerciseId: "8d3f7f5e-0c7b-4d59-9d6c-6f2f1c7c1a11",
  startedAt: new Date((t += 60_000)).toISOString(),
  durationMs: 30_000,
  tempo,
  notesTotal: 1,
  notesClean: clean ? 1 : 0,
  clean,
  notes: [],
  ...extra,
});

const fold = (runs: RunInput[], spec: LadderSpec | null = ladder): ProgressState =>
  runs.reduce((p, r) => foldProgress(p, r, spec), EMPTY_PROGRESS);

describe("foldProgress", () => {
  it("climbs the ladder after cleanRunsToAdvance clean runs, and resets the streak on a miss", () => {
    assert.deepEqual(fold([run(true, 60)]), {
      tempo: 60,
      cleanStreak: 1,
      bestTempo: 60,
      runs: 1,
      lastPracticedAt: new Date(t).toISOString(),
    });
    const bumped = fold([run(true, 60), run(true, 60)]);
    assert.equal(bumped.tempo, 64);
    assert.equal(bumped.cleanStreak, 0);
    assert.equal(bumped.bestTempo, 60, "best is the fastest clean run, not the new target");

    const reset = fold([run(true, 60), run(true, 60), run(true, 64), run(false, 64)]);
    assert.equal(reset.tempo, 64);
    assert.equal(reset.cleanStreak, 0);
    assert.equal(reset.bestTempo, 64);
    assert.equal(reset.runs, 4);
  });

  it("restarts the streak at a tempo set by hand, like ladderFromRuns", () => {
    const runs = [run(true, 60), run(true, 80), run(true, 80), run(true, 84), run(false, 70), run(true, 70)];
    const p = fold(runs);
    const client = ladderFromRuns([...runs].reverse(), { ...ladder });
    assert.deepEqual({ tempo: p.tempo, streak: p.cleanStreak }, client);
    assert.equal(p.bestTempo, 84);
  });

  it("only counts the streak without a ladder, or for a run without a tempo", () => {
    const p = fold([run(true, null), run(true, null), run(false, null), run(true, null)], null);
    assert.deepEqual({ tempo: p.tempo, streak: p.cleanStreak, best: p.bestTempo }, { tempo: null, streak: 1, best: null });
  });

  it("keeps the latest startedAt when a run arrives late", () => {
    const p = fold([run(true, 60), run(true, 60, { startedAt: "2026-01-01T00:00:00.000+01:00" })]);
    assert.equal(p.lastPracticedAt, new Date(t - 60_000).toISOString());
    assert.equal(fold([run(true, 60, { startedAt: "2026-09-01T12:00:00+02:00" })]).lastPracticedAt, "2026-09-01T10:00:00.000Z");
  });
});

describe("runEffects", () => {
  it("ladders sequence exercises and maps the note-finding ones", () => {
    for (const e of BUILTIN_EXERCISES) {
      const fx = runEffects(e.config);
      assert.equal(fx.ladder !== null, e.engine === "sequence", e.name);
      assert.equal(fx.positions, e.engine !== "sequence", e.name);
    }
  });
});

describe("foldPositions", () => {
  it("groups by position, times only the hits, and skips notes without a position", () => {
    const cells = foldPositions([
      { midi: 45, ok: true, ms: 800, string: 5, fret: 0 },
      { midi: 45, ok: false, ms: 5000, string: 5, fret: 0 },
      { midi: 45, ok: true, ms: 1200, string: 5, fret: 0 },
      { midi: 50, ok: false, ms: 3000, string: 4, fret: 0 },
      { midi: 52, ok: false, ms: 9000, string: null, fret: null },
    ]);
    assert.deepEqual([...cells.entries()], [
      ["5:0", { string: 5, fret: 0, attempts: 3, hits: 2, totalMs: 2000 }],
      ["4:0", { string: 4, fret: 0, attempts: 1, hits: 0, totalMs: 0 }],
    ]);
  });
});

describe("practiceByDay", () => {
  it("counts each run on its local start date, oldest day first, empty days included", () => {
    const now = new Date("2026-09-29T02:30:00Z"); // 22:30 on the 28th in New York
    const days = practiceByDay(
      [
        { started_at: "2026-09-29T01:00:00Z", duration_ms: 60_000 }, // the 28th in NY
        { started_at: "2026-09-28T13:00:00Z", duration_ms: 120_000 }, // the 28th
        { started_at: "2026-09-22T12:00:00Z", duration_ms: 30_000 }, // the 22nd, first day
        { started_at: "2026-09-21T12:00:00Z", duration_ms: 99_000 }, // before the window
      ],
      { days: 7, tz: "America/New_York", now },
    );
    assert.deepEqual(
      days.map((d) => d.date),
      ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"],
    );
    assert.deepEqual(days[0], { date: "2026-09-22", runs: 1, duration_ms: 30_000 });
    assert.deepEqual(days[6], { date: "2026-09-28", runs: 2, duration_ms: 180_000 });
    assert.equal(days.slice(1, 6).reduce((n, d) => n + d.runs, 0), 0);
  });

  it("steps over a DST change without skipping or doubling a day", () => {
    const days = practiceByDay([], { days: 4, tz: "Europe/London", now: new Date("2026-03-30T12:00:00Z") });
    assert.deepEqual(days.map((d) => d.date), ["2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30"]);
  });

  it("fetches far enough back for any time zone", () => {
    const now = new Date("2026-09-29T11:59:00Z"); // 23:59 on the 29th in Kiritimati (UTC+14)
    const days = practiceByDay([], { days: 7, tz: "Pacific/Kiritimati", now });
    const earliestLocalMidnight = new Date(`${days[0].date}T00:00:00+14:00`);
    assert.ok(new Date(weekSince(7, now)) <= earliestLocalMidnight);
  });
});

describe("weekQuery", () => {
  it("defaults to 7 days in UTC and rejects unknown zones", () => {
    assert.deepEqual(weekQuery.parse({}), { days: 7, tz: "UTC" });
    assert.deepEqual(weekQuery.parse({ days: "14", tz: "Asia/Tokyo" }), { days: 14, tz: "Asia/Tokyo" });
    assert.equal(weekQuery.safeParse({ tz: "Mars/Olympus" }).success, false);
    assert.equal(weekQuery.safeParse({ days: "0" }).success, false);
  });
});
