import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Click, type ClickClock, dueClicks, startClock } from "./metronome.js";

/** Runs the look-ahead loop from `from` to `to` with a timer that fires late by up to `jitter` s. */
function run(clock: ClickClock, bpm: (t: number) => number, from: number, to: number, jitter: number) {
  const clicks: Click[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let now = from; now < to; now += 0.025 + rand() * jitter) {
    const r = dueClicks(clock, bpm(now), now, now + 0.1);
    clicks.push(...r.clicks);
    clock = r.clock;
  }
  return { clicks, clock };
}

describe("metronome", () => {
  it("stays on the grid for 5 minutes at 200 bpm, however the timer jitters", () => {
    const start = startClock(10);
    const clicks = run(start, () => 200, 10, 10 + 300, 0.04).clicks.filter((c) => c.time < start.next + 300);
    assert.equal(clicks.length, 1000);
    clicks.forEach((c, i) => {
      assert.equal(c.beat, i);
      assert.ok(Math.abs(c.time - (start.next + i * 0.3)) < 1e-9, `beat ${i} drifted`);
    });
  });

  it("accents the downbeat of each bar", () => {
    const { clicks } = dueClicks(startClock(0, 0), 120, 0, 4, 4);
    assert.deepEqual(clicks.map((c) => c.accent), [true, false, false, false, true, false, false, false]);
    assert.ok(dueClicks(startClock(0, 0), 120, 0, 2, 0).clicks.every((c) => !c.accent));
  });

  it("changes tempo from the next unscheduled beat, without a jump", () => {
    const { clicks } = run(startClock(0, 0), (t) => (t < 2 ? 60 : 120), 0, 4, 0);
    const gaps = clicks.slice(1).map((c, i) => +(c.time - clicks[i].time).toFixed(6));
    // One-second beats, then half-second beats from the first one scheduled after the change.
    assert.deepEqual(gaps.slice(0, 2), [1, 1]);
    assert.ok(gaps.slice(3).every((g) => g === 0.5));
  });

  it("skips beats the scheduler missed instead of bursting them, keeping the phase", () => {
    const { clicks, clock } = dueClicks({ next: 1, beat: 0 }, 60, 4.2, 4.3);
    assert.deepEqual(clicks, []);
    assert.deepEqual(clock, { next: 5, beat: 4 });
    assert.deepEqual(dueClicks(clock, 60, 4.95, 5.05).clicks, [{ time: 5, beat: 4, accent: true }]);
  });
});
