import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { builtinExercise } from "../domain/catalog.js";
import { type SequenceConfig, exerciseConfig, runInput } from "../domain/types.js";
import { midiName } from "../theory/index.js";
import {
  type SequenceState,
  advanceLadder,
  initSequence,
  ladderFromRuns,
  sequenceReducer,
  sequenceRun,
  sequenceKey,
  sequenceParts,
  sequenceStats,
  sequenceTargets,
} from "./sequence.js";

/** A minor pentatonic box 1, from the catalog. */
const box1 = builtinExercise("a1d0bec2-dfb5-42f7-8148-3331b2abff66")!.config as SequenceConfig;

function hear(s: SequenceState, midi: number, at: number, position?: { string: number; fret: number }) {
  return sequenceReducer(s, { type: "heard", note: { midi, at, position } });
}

/** Plays every remaining note right, 500 ms apart from `at`. */
function playRest(s: SequenceState, at: number): SequenceState {
  while (s.endedAt === null) {
    s = hear(s, s.notes[s.index].target.midi, at);
    at += 500;
  }
  return s;
}

describe("sequence: targets", () => {
  it("plays box 1 up and down, the top note once", () => {
    const names = sequenceTargets(box1).map((n) => midiName(n.midi));
    const up = ["A2", "C3", "D3", "E3", "G3", "A3", "C4", "D4", "E4", "G4", "A4", "C5"];
    assert.deepEqual(names, [...up, ...up.slice(0, -1).reverse()]);
  });

  it("is empty when the window holds none of the notes", () => {
    const s = initSequence({ ...box1, frets: { lo: 0, hi: 0 }, strings: [6], source: { kind: "arpeggio", root: 1, formula: "major-triad" } });
    assert.equal(s.notes.length, 0);
    assert.equal(s.endedAt, 0);
  });
});

describe("sequence: sources", () => {
  const iiVI: SequenceConfig = {
    ...box1,
    frets: { lo: 7, hi: 10 },
    pattern: "up",
    source: {
      kind: "parts",
      parts: [
        { kind: "arpeggio", root: 2, formula: "min7" },
        { kind: "arpeggio", root: 7, formula: "dom7" },
        { kind: "arpeggio", root: 0, formula: "maj7" },
      ],
    },
  };

  it("keeps configs from before the new sources valid, and accepts the new ones", () => {
    assert.ok(exerciseConfig.safeParse(box1).success);
    assert.equal(box1.shape, undefined, "defaults to the box shape");
    assert.ok(exerciseConfig.safeParse(iiVI).success);
    assert.ok(exerciseConfig.safeParse({ ...box1, source: { kind: "notes", pitchClasses: [0, 5, 10] }, shape: "three-per-string" }).success);
    for (const bad of [
      { ...box1, source: { kind: "notes", pitchClasses: [0] } },
      { ...box1, shape: "diagonal" },
      { ...iiVI, source: { kind: "parts", parts: [{ kind: "scale", root: 0, formula: "maj7" }] } },
      { ...iiVI, source: { ...iiVI.source, degrees: [3, 3] } },
    ]) {
      assert.equal(exerciseConfig.safeParse(bad).success, false, JSON.stringify(bad.source));
    }
  });

  it("plays each part of a multi-part source in turn, with its own degrees", () => {
    const t = sequenceTargets(iiVI);
    const parts = sequenceParts(iiVI);
    assert.equal(parts.length, 3);
    assert.equal(t.length, parts.reduce((n, p) => n + p.notes.length, 0), "no part boundary repeats a pitch here");
    assert.deepEqual([...new Set(t.map((n) => n.part))], [0, 1, 2]);
    const first = t.findIndex((n) => n.part === 1);
    assert.equal(t[first - 1].part, 0);
    // G7's notes carry G7's degrees; D, its 5th, is a root in Dm7.
    assert.deepEqual([...new Set(t.filter((n) => n.part === 1).map((n) => n.degree))].sort(), ["3", "5", "R", "♭7"]);
    assert.deepEqual(sequenceKey(iiVI), { root: 0, minor: false }, "a progression's key is its last chord");
  });

  it("filters a multi-part source to the chosen degrees: guide tones", () => {
    const guide = { ...iiVI, source: { ...iiVI.source, degrees: [3, 7] } } as SequenceConfig;
    const t = sequenceTargets(guide);
    assert.deepEqual(
      [...new Set(t.map((n) => `${n.part}:${n.degree}`))].sort(),
      ["0:♭3", "0:♭7", "1:3", "1:♭7", "2:3", "2:7"],
    );
  });

  it("gives each part its own window, and plays a pitch shared at a boundary once", () => {
    const twice: SequenceConfig = {
      ...box1,
      frets: { lo: 0, hi: 5 },
      pattern: "down",
      source: {
        kind: "parts",
        parts: [
          { kind: "arpeggio", root: 0, formula: "major-triad", frets: { lo: 3, hi: 5 } },
          { kind: "arpeggio", root: 0, formula: "major-triad", frets: { lo: 0, hi: 3 } },
        ],
      },
    };
    const [a, b] = sequenceParts(twice);
    assert.ok(a.notes.every((n) => n.fret >= 3 && n.fret <= 5));
    assert.ok(b.notes.every((n) => n.fret <= 3));
    const t = sequenceTargets(twice);
    assert.ok(t.every((n, i) => i === 0 || n.midi !== t[i - 1].midi), "never the same pitch twice running");
  });

  it("drops the repeated pitch where one part ends on the note the next starts on", () => {
    const echo: SequenceConfig = {
      ...box1,
      frets: { lo: 0, hi: 12 },
      strings: [5],
      pattern: "updown",
      source: {
        kind: "parts",
        parts: [
          { kind: "arpeggio", root: 9, formula: "minor-triad", frets: { lo: 0, hi: 3 } },
          { kind: "arpeggio", root: 9, formula: "minor-triad", frets: { lo: 0, hi: 7 } },
        ],
      },
    };
    // Part 1 (A2 C3) up and down ends on A2, where part 2 (A2 C3 E3) starts: played once.
    const t = sequenceTargets(echo);
    assert.deepEqual(t.map((n) => midiName(n.midi)), ["A2", "C3", "A2", "C3", "E3", "C3", "A2"]);
    assert.deepEqual(t.map((n) => n.part), [0, 0, 0, 1, 1, 1, 1]);
  });

  it("plays a note order as given, the pattern still applying", () => {
    const cycle: SequenceConfig = { ...box1, frets: { lo: 0, hi: 6 }, strings: [6, 5], pattern: "up", source: { kind: "notes", pitchClasses: [0, 5, 10, 3] } };
    assert.deepEqual(sequenceTargets(cycle).map((n) => midiName(n.midi)), ["C3", "F2", "A♯2", "D♯3"]);
    assert.deepEqual(sequenceTargets({ ...cycle, pattern: "down" }).map((n) => midiName(n.midi)), ["D♯3", "A♯2", "F2", "C3"]);
    assert.deepEqual(sequenceKey(cycle), { root: 0, minor: false });
  });

  it("lays a formula out by the shape strategy", () => {
    const g3nps: SequenceConfig = { ...box1, source: { kind: "scale", root: 7, formula: "major" }, frets: { lo: 3, hi: 8 }, pattern: "up", shape: "three-per-string" };
    const t = sequenceTargets(g3nps);
    assert.equal(t.length, 18);
    for (const s of [6, 5, 4, 3, 2, 1]) assert.equal(t.filter((n) => n.string === s).length, 3);
  });
});

describe("sequence: grading", () => {
  it("counts a clean run end to end, timing each note from the one before", () => {
    const s = playRest(initSequence(box1), 1000);
    assert.equal(s.endedAt, 1000 + 500 * (s.notes.length - 1));
    assert.equal(s.notes[0].ms, 0);
    assert.ok(s.notes.slice(1).every((n) => n.ms === 500));
    const run = sequenceRun(s, "a1d0bec2-dfb5-42f7-8148-3331b2abff66", new Date(0).toISOString(), 80);
    assert.equal(run.clean, true);
    assert.equal(run.notesClean, 23);
    assert.equal(run.tempo, 80);
    assert.deepEqual(run.notes[0], { midi: 45, ok: true, ms: 0, string: 6, fret: 5 });
    assert.ok(runInput.safeParse(run).success);
  });

  it("marks a wrong note missed and stays on it until it is played right", () => {
    let s = hear(initSequence(box1), 45, 0);
    s = hear(s, 49, 300);
    assert.equal(s.last?.feedback.kind, "wrong-note");
    assert.equal(s.index, 1);
    assert.equal(s.notes[1].missed, true);
    s = hear(s, 50, 400);
    assert.equal(s.index, 1, "a second wrong note doesn't move on");
    s = hear(s, 48, 900);
    assert.equal(s.index, 2);
    assert.equal(s.notes[1].ms, 900);
    s = playRest(s, 1000);
    const run = sequenceRun(s, "a1d0bec2-dfb5-42f7-8148-3331b2abff66", new Date(0).toISOString(), 80);
    assert.equal(run.clean, false);
    assert.equal(run.notesClean, run.notesTotal - 1);
    assert.equal(run.notes[1].ok, false);
  });

  it("under exact grading, names the octave wanted", () => {
    const s = hear(hear(initSequence(box1), 45, 0), 60, 100);
    assert.deepEqual(s.last?.feedback, { kind: "wrong-octave", midi: 60, expected: 48 });
    assert.equal(s.notes[1].missed, true);
  });

  it("under pitch-class grading, takes the note in any octave", () => {
    const s = hear(hear(initSequence({ ...box1, grading: "pitch-class" }), 57, 0), 60, 100);
    assert.equal(s.index, 2);
    assert.equal(sequenceStats(s).accuracy, 1);
  });

  it("ignores the note just played, heard again", () => {
    let s = hear(hear(initSequence(box1), 45, 0), 45, 80);
    assert.equal(s.last?.feedback.kind, "repeat");
    assert.equal(s.notes[1].missed, false);
    s = hear(s, 48, 200);
    assert.equal(s.notes[1].missed, false);
  });

  it("doesn't start, or count a miss, until the first note is played right", () => {
    let s = hear(initSequence(box1), 52, 0);
    assert.equal(s.startedAt, null);
    assert.equal(s.notes[0].missed, false);
    assert.equal(s.last?.feedback.kind, "wrong-note");
    s = hear(s, 45, 5000);
    assert.equal(s.startedAt, 5000);
    assert.equal(s.notes[0].ms, 0);
  });

  it("counts the right pitch tapped somewhere else, and says so", () => {
    // Box 1 has C3 at fret 8 on the low E; fret 3 on the A string sounds the same.
    let s = hear(initSequence(box1), 45, 0, { string: 6, fret: 5 });
    assert.deepEqual(s.last?.feedback, { kind: "right", midi: 45, elsewhere: false });
    s = hear(s, 48, 100, { string: 5, fret: 3 });
    assert.deepEqual(s.last?.feedback, { kind: "right", midi: 48, elsewhere: true });
  });

  it("ignores notes once the run is over", () => {
    const s = playRest(initSequence(box1), 0);
    assert.equal(hear(s, 40, 99_999), s);
  });
});

describe("sequence: tempo ladder", () => {
  const rule = { step: 4, cleanRunsToAdvance: 3 };

  it("raises the tempo after enough clean runs in a row", () => {
    let l = { tempo: 80, streak: 0 };
    const seen: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const next = advanceLadder(l, true, rule);
      seen.push(next.bumped);
      l = { tempo: next.tempo, streak: next.streak };
    }
    assert.deepEqual(seen, [false, false, true]);
    assert.deepEqual(l, { tempo: 84, streak: 0 });
  });

  it("resets the streak on an unclean run", () => {
    const l = advanceLadder({ tempo: 80, streak: 2 }, false, rule);
    assert.deepEqual(l, { tempo: 80, streak: 0, bumped: false });
  });

  it("never moves with a step of 0, and stops at the top", () => {
    assert.equal(advanceLadder({ tempo: 80, streak: 2 }, true, { ...rule, step: 0 }).tempo, 80);
    assert.equal(advanceLadder({ tempo: 298, streak: 2 }, true, rule).tempo, 300);
    assert.equal(advanceLadder({ tempo: 300, streak: 2 }, true, rule).bumped, false);
  });

  it("rebuilds from past runs, newest first", () => {
    const tempo = { start: 80, ...rule };
    assert.deepEqual(ladderFromRuns([], tempo), { tempo: 80, streak: 0 });
    const r = (t: number | null, clean: boolean) => ({ tempo: t, clean });
    // Oldest to newest: three clean at 80 (bump to 84), then one clean at 84.
    assert.deepEqual(ladderFromRuns([r(84, true), r(80, true), r(80, true), r(80, true)], tempo), { tempo: 84, streak: 1 });
    // A run at a tempo set by hand restarts the streak there; tempo-less runs are skipped.
    assert.deepEqual(ladderFromRuns([r(null, true), r(70, true), r(80, true), r(80, true)], tempo), { tempo: 70, streak: 1 });
    assert.deepEqual(ladderFromRuns([r(80, false), r(80, true)], tempo), { tempo: 80, streak: 0 });
  });
});
