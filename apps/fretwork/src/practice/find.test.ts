import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FindConfig } from "../domain/types.js";
import { midiAt } from "../theory/index.js";
import {
  type FindState,
  currentString,
  findReducer,
  findRun,
  findSlots,
  heardAt,
  initFind,
  nextPitchClass,
} from "./find.js";

const A = 9;

const noteHunt: FindConfig = {
  engine: "find",
  target: { kind: "random" },
  order: "string-by-string",
  frets: { lo: 1, hi: 12 },
  strings: [1, 2, 3, 4, 5, 6],
  grading: "exact",
  timeLimitSec: null,
};

const everyA: FindConfig = { ...noteHunt, order: "any", frets: { lo: 0, hi: 12 } };

function play(s: FindState, ...notes: [midi: number, at: number][]): FindState {
  return notes.reduce((st, [midi, at]) => findReducer(st, { type: "heard", note: { midi, at } }), s);
}

function started(config: FindConfig, pc = A, at = 1000): FindState {
  return findReducer(initFind(config, pc), { type: "start", at });
}

describe("find: slots", () => {
  it("asks string by string from low E, one slot per string", () => {
    const slots = findSlots(noteHunt, A);
    assert.deepEqual(
      slots.map((s) => s.map((p) => `${p.string}:${p.fret}`)),
      [["6:5"], ["5:12"], ["4:7"], ["3:2"], ["2:10"], ["1:5"]],
    );
  });

  it("keeps both octaves on a string when the window spans one", () => {
    const slots = findSlots({ ...noteHunt, frets: { lo: 0, hi: 12 } }, 4);
    assert.deepEqual(slots[0].map((p) => p.fret), [0, 12]);
  });

  it("has one slot per position in any order, and none for a window without the note", () => {
    // Low E 5, A 0 and 12, D 7, G 2, B 10, high E 5.
    assert.equal(findSlots(everyA, A).length, 7);
    const empty = initFind({ ...noteHunt, frets: { lo: 1, hi: 1 }, strings: [6] }, A);
    assert.equal(empty.slots.length, 0);
    assert.notEqual(empty.endedAt, null);
  });
});

describe("find: string-by-string grading", () => {
  it("exact pitch on the current string counts and moves on", () => {
    const s = play(started(noteHunt), [midiAt(6, 5), 2500]);
    assert.equal(s.last?.feedback.kind, "correct");
    assert.deepEqual(s.slots[0].found, { string: 6, fret: 5, midi: 45 });
    assert.equal(s.slots[0].ok, true);
    assert.equal(s.slots[0].ms, 1500);
    assert.equal(currentString(s), 5);
  });

  it("the same pitch tapped on another string counts, and says so", () => {
    // A3 is fret 12 on the A string (the target) and fret 7 on the D string.
    let s = play(started(noteHunt), [45, 2000]);
    s = findReducer(s, { type: "heard", note: heardAt(4, 7, 3000) });
    assert.equal(s.last?.feedback.kind, "correct");
    assert.equal(s.last?.feedback.kind === "correct" && s.last.feedback.elsewhere, true);
    // The result records the target position, not the tapped one.
    assert.deepEqual(s.slots[1].found, { string: 5, fret: 12, midi: 57 });
    assert.equal(s.slots[1].ok, true);
  });

  it("the right note in the wrong octave is a miss that names the expected octave", () => {
    let s = play(started(noteHunt), [57, 2000]);
    assert.deepEqual(s.last?.feedback, { kind: "wrong-octave", midi: 57, expected: 45 });
    assert.equal(s.slots[0].found, null);
    assert.equal(currentString(s), 6);
    s = play(s, [45, 3000]);
    assert.equal(s.slots[0].ok, false, "found after a miss is not clean");
    assert.equal(s.slots[0].ms, 2000);
  });

  it("a wrong note is a miss", () => {
    const s = play(started(noteHunt), [44, 2000]);
    assert.deepEqual(s.last?.feedback, { kind: "wrong-note", midi: 44 });
    assert.equal(s.missesSince, 1);
  });

  it("pitch-class grading accepts any octave", () => {
    const s = play(started({ ...noteHunt, grading: "pitch-class" }), [81, 2000]);
    assert.equal(s.last?.feedback.kind, "correct");
    assert.equal(s.slots[0].found?.fret, 5);
  });

  it("finishes after the last string and builds a run", () => {
    // A2 on the low E, A3 on the A, D and G strings, A4 on the B and high E.
    const all = play(started(noteHunt), [45, 2000], [57, 3000], [57, 4000], [57, 5000], [69, 6000], [69, 7000]);
    assert.equal(all.endedAt, 7000);
    const run = findRun(all, "e80fdaad-a6d2-46be-b29d-ab3288186651", "2026-09-29T12:00:00.000Z");
    assert.equal(run.notesTotal, 6);
    assert.equal(run.notesClean, 6);
    assert.equal(run.clean, true);
    assert.equal(run.durationMs, 6000);
    assert.deepEqual(run.notes[0], { midi: 45, ok: true, ms: 1000, string: 6, fret: 5 });
  });

  it("ignores notes after the end", () => {
    const done = play(started(noteHunt), [45, 2000], [57, 3000], [57, 4000], [57, 5000], [69, 6000], [69, 7000]);
    assert.equal(play(done, [44, 8000]), done);
  });
});

describe("find: any order", () => {
  it("a pitch lights every unfound position with that pitch", () => {
    // A3 is at 5:12, 4:7 and 3:2 in frets 0-12.
    const s = play(started(everyA), [57, 1500]);
    const lit = s.slots.filter((x) => x.found).map((x) => `${x.found!.string}:${x.found!.fret}`);
    assert.deepEqual(lit, ["5:12", "4:7", "3:2"]);
    assert.equal(play(s, [57, 1600]).last?.feedback.kind, "already-found");
    assert.equal(play(s, [57, 1600]).missesSince, 0);
  });

  it("is done once every position is lit", () => {
    const s = play(started(everyA), [45, 1100], [57, 1200], [69, 1300]);
    assert.equal(s.endedAt, 1300);
    assert.equal(findRun(s, "e80fdaad-a6d2-46be-b29d-ab3288186651", "2026-09-29T12:00:00Z").notesTotal, 7);
  });

  it("an octave outside the window is a miss when exact, and neutral by pitch class", () => {
    const window = { ...everyA, frets: { lo: 5, hi: 8 } };
    assert.equal(play(started(window), [81, 1500]).last?.feedback.kind, "wrong-octave");
    const byName = play(started({ ...window, grading: "pitch-class" }), [81, 1500]);
    assert.equal(byName.last?.feedback.kind, "outside");
    assert.equal(byName.missesSince, 0);
  });
});

describe("find: clock, hints and time limit", () => {
  it("the clock can be restarted until something is played", () => {
    let s = started(noteHunt, A, 1000);
    s = findReducer(s, { type: "start", at: 5000 });
    assert.equal(s.startedAt, 5000);
    s = play(s, [44, 6000]);
    assert.equal(findReducer(s, { type: "start", at: 9000 }).startedAt, 5000);
  });

  it("a note found while hints are showing is not clean", () => {
    let s = findReducer(started(noteHunt), { type: "hint", on: true });
    s = findReducer(s, { type: "hint", on: false });
    s = play(s, [45, 2000], [57, 3000]);
    assert.equal(s.slots[0].ok, false);
    assert.equal(s.slots[1].ok, true);
  });

  it("time running out ends the run with the rest unfound", () => {
    let s = play(started(noteHunt), [45, 2000]);
    s = findReducer(s, { type: "timeout", at: 31_000 });
    assert.equal(s.timedOut, true);
    const run = findRun(s, "e80fdaad-a6d2-46be-b29d-ab3288186651", "2026-09-29T12:00:00Z");
    assert.equal(run.notesClean, 1);
    assert.equal(run.clean, false);
    assert.deepEqual(run.notes[1], { midi: 57, ok: false, ms: 29_000, string: 5, fret: 12 });
  });

  it("next note is up a fourth", () => {
    assert.equal(nextPitchClass(A), 2);
    assert.equal(nextPitchClass(7), 0);
  });
});
