import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RespondConfig } from "../domain/types.js";
import { respondConfig } from "../domain/types.js";
import {
  type Card,
  type CardResult,
  type RespondState,
  cardKey,
  cardPool,
  drawCard,
  initRespond,
  respondReducer,
  respondRun,
  respondStats,
} from "./respond.js";

const flashcards: RespondConfig = {
  engine: "respond",
  prompt: "note-on-string",
  pitchClasses: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  frets: { lo: 0, hi: 12 },
  strings: [1, 2, 3, 4, 5, 6],
  cards: 3,
  timeLimitSec: null,
};

/** A deck whose first card is pinned, so a test knows what it is answering. */
function dealt(config: RespondConfig, card: Card, at = 1000): RespondState {
  const s = respondReducer(initRespond(config), { type: "start", at, rand: 0 });
  return { ...s, card };
}

const onG = (pc: number): Card => cardPool({ ...flashcards, pitchClasses: [pc], strings: [3] })[0];

function hear(s: RespondState, midi: number, at: number, position?: { string: number; fret: number }) {
  return respondReducer(s, { type: "heard", note: { midi, at, position } });
}

describe("respond: note on a string", () => {
  it("has a card per note and string, with both ends of the octave as answers", () => {
    assert.equal(cardPool(flashcards).length, 72);
    const g = onG(7);
    assert.equal(g.kind, "note-on-string");
    assert.deepEqual(g.kind === "note-on-string" && g.targets.map((p) => p.fret), [0, 12]);
  });

  it("grades the exact pitch; open or 12th fret both count", () => {
    const s = hear(dealt(flashcards, onG(7)), 67, 2500);
    assert.equal(s.phase, "answered");
    assert.deepEqual(s.results[0].position, { string: 3, fret: 12, midi: 67 });
    assert.equal(s.results[0].ok, true);
    assert.equal(s.results[0].ms, 1500);
    assert.equal(hear(dealt(flashcards, onG(7)), 55, 2000).results[0].position?.fret, 0);
  });

  it("the same pitch tapped on another string counts, and says so", () => {
    // A3 is fret 2 on the G string and fret 7 on the D string.
    const s = hear(dealt(flashcards, onG(9)), 57, 2000, { string: 4, fret: 7 });
    assert.deepEqual(s.last?.feedback, { kind: "right", midi: 57, elsewhere: true });
    assert.equal(s.results[0].ok, true);
  });

  it("wrong octave and wrong note are misses; the card stays up", () => {
    let s = hear(dealt(flashcards, onG(9)), 69, 2000);
    assert.deepEqual(s.last?.feedback, { kind: "wrong-octave", midi: 69, expected: 57 });
    s = hear(s, 58, 2500);
    assert.equal(s.last?.feedback.kind, "wrong-note");
    assert.equal(s.phase, "asking");
    s = hear(s, 57, 3000);
    assert.equal(s.results[0].ok, false);
    assert.equal(s.results[0].misses, 2);
  });

  it("skip and timeout reveal the answer as a miss", () => {
    const skipped = respondReducer(dealt(flashcards, onG(9)), { type: "skip", at: 4000 });
    assert.equal(skipped.phase, "answered");
    assert.equal(skipped.results[0].ok, false);
    assert.equal(skipped.results[0].midi, 57);
    const late = respondReducer(dealt(flashcards, onG(9)), { type: "timeout", at: 11_000 });
    assert.equal(late.last?.feedback.kind, "timeout");
    assert.equal(late.results[0].ms, 10_000);
  });

  it("ignores notes once answered, and ends after the last card", () => {
    let s = hear(dealt(flashcards, onG(9)), 57, 2000);
    assert.equal(hear(s, 40, 2100), s);
    for (let i = 0; i < 2; i++) {
      s = respondReducer(s, { type: "next", at: 3000 + i * 1000, rand: 0.5 });
      s = respondReducer(s, { type: "skip", at: 3500 + i * 1000 });
    }
    assert.equal(s.index, 2);
    s = respondReducer(s, { type: "next", at: 6000, rand: 0.5 });
    assert.equal(s.endedAt, 6000);
    const run = respondRun(s, "1242f23a-3f8e-4ac1-be80-c43cde3130c7", "2026-09-29T12:00:00Z");
    assert.equal(run.notesTotal, 3);
    assert.equal(run.notesClean, 1);
    assert.equal(run.durationMs, 5000);
    assert.deepEqual(run.notes[0], { midi: 57, ok: true, ms: 1000, string: 3, fret: 2 });
  });

  it("the clock can be moved until something is played", () => {
    let s = respondReducer(dealt(flashcards, onG(9)), { type: "reclock", at: 5000 });
    assert.equal(s.shownAt, 5000);
    s = hear(s, 40, 6000);
    assert.equal(respondReducer(s, { type: "reclock", at: 9000 }).shownAt, 5000);
  });
});

describe("respond: interval", () => {
  const intervals: RespondConfig = { ...flashcards, prompt: "interval", pitchClasses: [9], intervals: [7] };
  const fifth: Card = { kind: "interval", root: 9, semitones: 7 };

  it("needs the root, then the note that far above it", () => {
    let s = hear(dealt(intervals, fifth), 45, 1500);
    assert.deepEqual(s.last?.feedback, { kind: "root", midi: 45 });
    assert.equal(s.misses, 0);
    s = hear(s, 51, 2000);
    assert.deepEqual(s.last?.feedback, { kind: "wrong-interval", midi: 51, semitones: 6 });
    // Playing the root again restarts the interval from there.
    s = hear(s, 57, 2500);
    assert.equal(s.rootMidi, 57);
    s = hear(s, 64, 3000);
    assert.equal(s.phase, "answered");
    assert.equal(s.results[0].midi, 64);
    assert.equal(s.results[0].ok, false);
  });

  it("anything but the root first is a miss", () => {
    const s = hear(dealt(intervals, fifth), 52, 1500);
    assert.equal(s.last?.feedback.kind, "wrong-note");
    assert.equal(s.rootMidi, null);
  });

  it("defaults to 3rds, 4th, 5th and octave, and drops intervals the window can't hold", () => {
    assert.deepEqual(
      cardPool({ ...intervals, intervals: undefined }).map((c) => c.kind === "interval" && c.semitones),
      [3, 4, 5, 7, 12],
    );
    // One string, frets 0-3: nothing is a 5th above an A there.
    assert.equal(cardPool({ ...intervals, strings: [5], frets: { lo: 0, hi: 3 } }).length, 0);
  });

  it("is optional in the stored config, so old rows still parse", () => {
    const { intervals: _, ...old } = intervals;
    assert.equal(respondConfig.safeParse(old).success, true);
    assert.equal(respondConfig.safeParse({ ...old, intervals: [7, 7] }).success, false);
  });
});

describe("respond: play what you hear", () => {
  it("asks each pitch in the window once, and grades it exactly", () => {
    const config: RespondConfig = { ...flashcards, prompt: "play-heard-note", pitchClasses: [4], frets: { lo: 0, hi: 5 } };
    assert.deepEqual(cardPool(config).map((c) => c.kind === "play-heard-note" && c.midi), [40, 52, 64]);
    const s = hear(dealt(config, { kind: "play-heard-note", midi: 52 }), 64, 1500);
    assert.deepEqual(s.last?.feedback, { kind: "wrong-octave", midi: 64, expected: 52 });
  });
});

describe("respond: adaptive deck", () => {
  const pool: Card[] = [0, 1, 2, 3].map((pc) => onG(pc));
  const result = (card: Card, ok: boolean, ms: number): CardResult => ({ card, ok, ms, misses: ok ? 0 : 1, midi: 0, position: null });

  it("never repeats the card just shown", () => {
    for (const r of [0, 0.3, 0.6, 0.99]) assert.notEqual(cardKey(drawCard(pool, [], pool[0], r)!), cardKey(pool[0]));
  });

  it("leans toward misses and slow cards", () => {
    const results = [result(pool[0], true, 1000), result(pool[1], false, 5000), result(pool[2], true, 4000), result(pool[3], true, 1100)];
    // Weights with pool[3] just shown: 0.5, 4, 2 → the miss gets 4/6.5 of the draws.
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const c = drawCard(pool, results, pool[3], i / 1000)!;
      counts.set(cardKey(c), (counts.get(cardKey(c)) ?? 0) + 1);
    }
    assert.equal(counts.get(cardKey(pool[3])), undefined);
    assert.ok(Math.abs(counts.get(cardKey(pool[1]))! - 615) < 5);
    assert.ok(Math.abs(counts.get(cardKey(pool[2]))! - 308) < 5);
  });

  it("counts a streak, a score and the average time", () => {
    let s = hear(dealt(flashcards, onG(9)), 57, 2000);
    s = respondReducer(s, { type: "next", at: 3000, rand: 0 });
    s = respondReducer(s, { type: "skip", at: 4000 });
    s = respondReducer(s, { type: "next", at: 5000, rand: 0 });
    const answer = s.card!.kind === "note-on-string" ? s.card!.targets[0].midi : 0;
    s = hear(s, answer, 8000);
    assert.deepEqual(respondStats(s), { answered: 3, right: 2, streak: 1, averageMs: 2000 });
  });
});
