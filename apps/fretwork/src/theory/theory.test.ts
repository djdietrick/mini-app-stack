import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARPEGGIOS,
  SCALES,
  applyPattern,
  degreeLabel,
  findFormula,
  fretDistance,
  freqToMidi,
  midiAt,
  midiName,
  midiToFreq,
  nearestNote,
  noteName,
  pitchClass,
  positionsOfMidi,
  positionsOfPitchClass,
  shapeInWindow,
  spellingForKey,
} from "./index.js";

describe("notes", () => {
  it("names MIDI numbers in scientific pitch notation", () => {
    assert.equal(midiName(60), "C4");
    assert.equal(midiName(69), "A4");
    assert.equal(midiName(40), "E2");
    assert.equal(midiName(66), "F♯4");
    assert.equal(midiName(70, "flat"), "B♭4");
  });

  it("wraps pitch classes, including negatives", () => {
    assert.equal(pitchClass(-3), 9);
    assert.equal(pitchClass(71), 11);
    assert.equal(noteName(13), "C♯");
  });

  it("round-trips frequency and MIDI", () => {
    assert.equal(midiToFreq(69), 440);
    assert.equal(freqToMidi(440), 69);
    assert.ok(Math.abs(midiToFreq(40) - 82.4069) < 1e-3, "low E");
    const n = nearestNote(445);
    assert.equal(n.midi, 69);
    assert.ok(Math.abs(n.cents - 19.56) < 0.01);
    assert.equal(nearestNote(430).midi, 69, "under a quarter-tone flat is still A");
  });

  it("spells flat keys with flats", () => {
    assert.equal(spellingForKey(5), "flat", "F major");
    assert.equal(spellingForKey(7), "sharp", "G major");
    assert.equal(spellingForKey(2, true), "flat", "D minor, relative of F");
    assert.equal(spellingForKey(9, true), "sharp", "A minor, relative of C");
  });
});

describe("fretboard", () => {
  it("counts strings 1 (high E) to 6 (low E)", () => {
    assert.equal(midiAt(1, 0), 64);
    assert.equal(midiAt(6, 0), 40);
    assert.equal(midiAt(6, 5), 45, "5th fret low E is A2, same as the open A");
    assert.equal(midiAt(3, 2), 57);
  });

  it("finds one A per string in frets 1–12, low string first", () => {
    const as = positionsOfPitchClass(9, { lo: 1, hi: 12 });
    assert.deepEqual(
      as.map((p) => [p.string, p.fret]),
      [
        [6, 5],
        [5, 12],
        [4, 7],
        [3, 2],
        [2, 10],
        [1, 5],
      ],
    );
  });

  it("shows why the mic cannot tell strings apart", () => {
    const e4 = positionsOfMidi(64, { lo: 0, hi: 12 });
    assert.deepEqual(
      e4.map((p) => [p.string, p.fret]),
      [
        [3, 9],
        [2, 5],
        [1, 0],
      ],
    );
  });

  it("puts the 12th fret halfway along the string", () => {
    assert.equal(fretDistance(0), 0);
    assert.equal(fretDistance(12), 0.5);
    assert.ok(fretDistance(1) > fretDistance(12) - fretDistance(11), "frets narrow up the neck");
  });
});

describe("scales and sequences", () => {
  it("has unique, stable formula ids", () => {
    for (const list of [SCALES, ARPEGGIOS]) {
      assert.equal(new Set(list.map((f) => f.id)).size, list.length);
      for (const f of list) assert.equal(f.intervals[0], 0, `${f.id} starts on the root`);
    }
    assert.equal(findFormula("scale", "minor-pentatonic")?.name, "Minor pentatonic");
    assert.equal(findFormula("arpeggio", "nope"), undefined);
  });

  it("labels degrees", () => {
    assert.deepEqual([0, 3, 5, 7, 10].map(degreeLabel), ["R", "♭3", "4", "5", "♭7"]);
  });

  it("reproduces A minor pentatonic box 1 in frets 5–8", () => {
    const box = shapeInWindow(9, findFormula("scale", "minor-pentatonic")!.intervals, { lo: 5, hi: 8 });
    assert.deepEqual(
      box.map((n) => [n.string, n.fret, n.degree]),
      [
        [6, 5, "R"],
        [6, 8, "♭3"],
        [5, 5, "4"],
        [5, 7, "5"],
        [4, 5, "♭7"],
        [4, 7, "R"],
        [3, 5, "♭3"],
        [3, 7, "4"],
        [2, 5, "5"],
        [2, 8, "♭7"],
        [1, 5, "R"],
        [1, 8, "♭3"],
      ],
    );
    assert.deepEqual(
      box.map((n) => n.midi),
      [45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72],
    );
  });

  it("keeps the lower fret when a pitch appears twice in the window", () => {
    // E4 is on the G string at 9 and the B string at 5; the box wants the 5.
    const shape = shapeInWindow(9, [0, 3, 5, 7, 10], { lo: 5, hi: 9 });
    const e4 = shape.filter((n) => n.midi === 64);
    assert.deepEqual(
      e4.map((n) => [n.string, n.fret]),
      [[2, 5]],
    );
  });

  it("respects the string selection", () => {
    const shape = shapeInWindow(0, [0, 4, 7], { lo: 0, hi: 12 }, [1, 2, 3]);
    assert.ok(shape.every((n) => n.string <= 3));
    assert.ok(shape.length > 0);
  });

  it("orders notes by pattern", () => {
    const asc = [1, 2, 3, 4, 5];
    assert.deepEqual(applyPattern(asc, "up"), [1, 2, 3, 4, 5]);
    assert.deepEqual(applyPattern(asc, "down"), [5, 4, 3, 2, 1]);
    assert.deepEqual(applyPattern(asc, "updown"), [1, 2, 3, 4, 5, 4, 3, 2, 1]);
    assert.deepEqual(applyPattern(asc, "groups3"), [1, 2, 3, 2, 3, 4, 3, 4, 5]);
    assert.deepEqual(applyPattern(asc, "thirds"), [1, 3, 2, 4, 3, 5]);
    assert.deepEqual(applyPattern([], "updown"), []);
    assert.deepEqual(asc, [1, 2, 3, 4, 5], "input untouched");
  });
});
