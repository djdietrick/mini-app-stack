import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARPEGGIOS,
  SCALES,
  applyPattern,
  degreeLabel,
  degreeNumber,
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
  notesInOrder,
  shapeFor,
  shapeInWindow,
  spellingForKey,
  threePerString,
} from "./index.js";

/** A shape as "string:fret,fret" per string, low E first. */
const byString = (notes: readonly { string: number; fret: number }[]) =>
  [6, 5, 4, 3, 2, 1]
    .map((s) => `${s}:${notes.filter((n) => n.string === s).map((n) => n.fret).join(",")}`)
    .join(" ");

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

  it("keeps the higher fret on request, for a window spanning two boxes", () => {
    const pent = [0, 3, 5, 7, 10];
    // Frets 5–10: the lower fret gives box 1 plus a note; the higher climbs from the root into box 2.
    assert.equal(byString(shapeInWindow(9, pent, { lo: 5, hi: 10 })), "6:5,8 5:5,7 4:5,7 3:5,7 2:5,8 1:5,8,10");
    assert.equal(
      byString(shapeInWindow(9, pent, { lo: 5, hi: 10 }, undefined, undefined, "higher")),
      "6:5,8,10 5:7,10 4:7,10 3:7,9 2:8,10 1:8,10",
    );
    assert.deepEqual(shapeFor("lower-fret", 9, pent, { lo: 5, hi: 8 }), shapeInWindow(9, pent, { lo: 5, hi: 8 }));
  });

  it("reproduces the pentatonic boxes 2–5 in their windows", () => {
    const pent = [0, 3, 5, 7, 10];
    assert.equal(byString(shapeInWindow(9, pent, { lo: 7, hi: 10 })), "6:8,10 5:7,10 4:7,10 3:7,9 2:8,10 1:8,10");
    assert.equal(byString(shapeInWindow(9, pent, { lo: 9, hi: 13 })), "6:10,12 5:10,12 4:10,12 3:9,12 2:10,13 1:10,12");
    assert.equal(byString(shapeInWindow(9, pent, { lo: 12, hi: 15 })), "6:12,15 5:12,15 4:12,14 3:12,14 2:13,15 1:12,15");
    assert.equal(byString(shapeInWindow(9, pent, { lo: 14, hi: 17 })), "6:15,17 5:15,17 4:14,17 3:14,17 2:15,17 1:15,17");
  });

  it("lays a scale out three notes per string", () => {
    const major = findFormula("scale", "major")!.intervals;
    const g = threePerString(7, major, { lo: 3, hi: 8 });
    // The standard G major 3nps fingering from the 3rd fret.
    assert.equal(byString(g), "6:3,5,7 5:3,5,7 4:4,5,7 3:4,5,7 2:5,7,8 1:5,7,8");
    assert.equal(g.length, 18);
    assert.ok(g.every((n, i) => i === 0 || n.midi > g[i - 1].midi), "ascending");
    assert.deepEqual(g.slice(0, 3).map((n) => n.degree), ["R", "2", "3"]);
    assert.deepEqual(shapeFor("three-per-string", 7, major, { lo: 3, hi: 8 }), g);
  });

  it("stops three-per-string at the window's top fret, and follows the strings chosen", () => {
    const major = findFormula("scale", "major")!.intervals;
    assert.equal(byString(threePerString(7, major, { lo: 3, hi: 7 })), "6:3,5,7 5:3,5,7 4:4,5,7 3:4,5,7 2:5,7 1:");
    assert.equal(byString(threePerString(7, major, { lo: 3, hi: 8 }, [4, 3])), "6: 5: 4:4,5,7 3:4,5,7 2: 1:");
  });

  it("places a note order nearest the note before", () => {
    const fourths = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7];
    const cycle = notesInOrder(fourths, { lo: 0, hi: 6 }, [6, 5]);
    assert.deepEqual(
      cycle.map((n) => [n.string, n.fret]),
      [[5, 3], [6, 1], [5, 1], [5, 6], [6, 4], [5, 4], [6, 2], [5, 2], [6, 0], [5, 0], [5, 5], [6, 3]],
    );
    assert.deepEqual(cycle.map((n) => pitchClass(n.midi)), fourths, "in the order given");
    assert.deepEqual(cycle.slice(0, 2).map((n) => n.degree), ["R", "4"], "degrees from the first note");
    assert.deepEqual(notesInOrder([0, 1], { lo: 0, hi: 0 }, [6]).length, 0, "no C or C♯ at the open low E");
  });

  it("numbers degrees whatever their quality", () => {
    assert.deepEqual([0, 3, 4, 7, 10, 11].map(degreeNumber), [1, 3, 3, 5, 7, 7]);
    assert.equal(degreeNumber(6), 5, "a tritone is a ♭5");
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
