import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PositionStatRow } from "../domain/types.js";
import { SPEED_BINS, averageMs, describeZone, speedBin, weakestZone } from "./zones.js";

const cell = (string: number, fret: number, attempts: number, hits: number, avg: number): PositionStatRow => ({
  string,
  fret,
  attempts,
  hits,
  total_ms: hits * avg,
});

describe("speedBin", () => {
  it("bins the average time to a hit, fastest first, and leaves never-found cells out", () => {
    assert.equal(speedBin(cell(6, 0, 2, 2, 900)), 0);
    assert.equal(speedBin(cell(6, 0, 2, 2, 1500)), 0);
    assert.equal(speedBin(cell(6, 0, 2, 2, 1501)), 1);
    assert.equal(speedBin(cell(6, 0, 2, 1, 5000)), 3);
    assert.equal(speedBin(cell(6, 0, 1, 1, 20_000)), SPEED_BINS.length);
    assert.equal(speedBin(cell(6, 0, 3, 0, 0)), null);
    assert.equal(averageMs(cell(6, 0, 4, 2, 1200)), 1200);
    assert.equal(averageMs(cell(6, 0, 4, 0, 0)), null);
  });
});

describe("weakestZone", () => {
  it("needs a few tried positions before it says anything", () => {
    assert.equal(weakestZone([]), null);
    assert.equal(weakestZone([cell(3, 7, 3, 3, 9000), cell(2, 8, 3, 3, 9000)]), null);
  });

  it("finds the slowest two-string, four-fret patch", () => {
    const fast = [6, 5, 4, 3, 2, 1].flatMap((s) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((f) => cell(s, f, 2, 2, 1200)));
    const slow = [cell(3, 7, 2, 2, 6000), cell(3, 9, 2, 1, 7000), cell(2, 8, 2, 2, 5000), cell(2, 10, 2, 2, 6500)];
    const stats = [
      ...fast.filter((c) => !slow.some((s) => s.string === c.string && s.fret === c.fret)),
      ...slow,
    ];
    const z = weakestZone(stats)!;
    assert.deepEqual({ strings: z.strings, frets: z.frets }, { strings: [3, 2], frets: { lo: 7, hi: 10 } });
    assert.equal(describeZone(z), "frets 7–10 on the G and B strings");
  });

  it("ranks positions never found below slow ones", () => {
    const z = weakestZone([
      cell(6, 0, 1, 1, 6000),
      cell(6, 1, 1, 1, 6000),
      cell(5, 0, 1, 1, 6000),
      cell(2, 5, 1, 0, 0),
      cell(2, 6, 1, 0, 0),
      cell(1, 5, 1, 1, 1000),
    ])!;
    assert.deepEqual(z.strings, [2, 1]);
  });
});
