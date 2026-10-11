import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BakeStep,
  type Formula,
  type RecipeStep,
  completeStep,
  cToF,
  currentStep,
  durationFactor,
  feedAmounts,
  foldsDue,
  fToC,
  logFold,
  nightSteps,
  peakHours,
  planBake,
  planFeed,
  predictPeak,
  ratioLabel,
  scaleFormula,
  shiftRemaining,
  speedFactor,
  stepMinutes,
} from "./index.js";

const H = 3_600_000;
const near = (actual: number, expected: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ""} expected ${expected}±${tol}, got ${actual}`);

describe("temperature", () => {
  it("doubles every 15°F cooler and clamps outside the model's range", () => {
    assert.equal(durationFactor(75, 75), 1);
    near(durationFactor(60, 75), 2, 1e-9);
    near(durationFactor(90, 75), 0.5, 1e-9);
    assert.equal(durationFactor(38, 75), durationFactor(60, 75), "a fridge is not 5x slower, it's off the model");
  });

  it("converts units", () => {
    near(fToC(212), 100, 1e-9);
    near(cToF(24), 75.2, 1e-9);
  });
});

describe("starter", () => {
  it("matches the side-by-side timings at 75°F", () => {
    near(peakHours(1, 75), 5, 0.5, "1:1:1");
    near(peakHours(5, 75), 10, 0.75, "1:5:5");
    near(peakHours(10, 75), 17, 0.5, "1:10:10");
  });

  it("predicts later peaks in a cool kitchen and for a slow starter", () => {
    const fed = new Date("2026-10-10T09:00:00Z");
    assert.ok(predictPeak(fed, 2, 68).getTime() > predictPeak(fed, 2, 75).getTime());
    assert.equal(predictPeak(fed, 2, 75, 2).getTime() - fed.getTime(), 2 * (predictPeak(fed, 2, 75).getTime() - fed.getTime()));
  });

  it("learns a starter's speed from logged peaks, ignoring nonsense", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 1) + h * H).toISOString();
    const slow = (i: number) => ({
      fedAt: at(i * 24),
      starterG: 20,
      flourG: 20,
      tempF: 75,
      peakAt: at(i * 24 + peakHours(1, 75) * 1.5),
    });
    assert.deepEqual(speedFactor([]), { factor: 1, samples: 0 });
    const speed = speedFactor([
      slow(0),
      slow(1),
      slow(2),
      { fedAt: at(80), starterG: 20, flourG: 20, tempF: 75, peakAt: at(79) }, // peak before feed
      { fedAt: at(90), starterG: 0, flourG: 20, tempF: 75, peakAt: at(95) }, // no starter
      { fedAt: at(100), starterG: 20, flourG: 20, tempF: null, peakAt: null }, // never logged
    ]);
    assert.equal(speed.samples, 3);
    near(speed.factor, 1.5, 1e-9);
  });

  it("feeds enough to cover what's needed plus the reserve", () => {
    const a = feedAmounts(100, 20, 5);
    assert.deepEqual(a, { starter: 11, flour: 55, water: 55, total: 121 });
    assert.ok(a.total >= 120);
    const stiff = feedAmounts(100, 0, 2, 50);
    assert.equal(stiff.water, Math.round(stiff.flour / 2));
    assert.equal(ratioLabel(2.5), "1:2.5:2.5");
    assert.equal(ratioLabel(2, 50), "1:2:1");
  });

  it("picks the ratio that peaks just before it's needed", () => {
    const now = new Date("2026-10-10T21:00:00Z");
    const plan = planFeed({ now, readyAt: new Date(now.getTime() + 11 * H), tempF: 75, need: 100, reserve: 20 });
    assert.equal(plan.status, "ok");
    assert.equal(plan.ratio, 5);
    assert.ok(plan.peakAt.getTime() <= now.getTime() + 11.5 * H);
  });

  it("says when there isn't enough time, or too much", () => {
    const now = new Date("2026-10-10T21:00:00Z");
    const soon = planFeed({ now, readyAt: new Date(now.getTime() + 2 * H), tempF: 70, need: 50, reserve: 20 });
    assert.equal(soon.status, "too-soon");
    assert.equal(soon.ratio, 1);

    const far = planFeed({ now, readyAt: new Date(now.getTime() + 60 * H), tempF: 75, need: 50, reserve: 20 });
    assert.equal(far.status, "feed-later");
    assert.ok(far.feedAt.getTime() > now.getTime());
    near(far.peakAt.getTime(), now.getTime() + 59.5 * H, 60_000);
  });
});

const country: Formula = {
  flours: [
    { name: "Bread flour", pct: 90 },
    { name: "Whole wheat flour", pct: 10 },
  ],
  hydrationPct: 75,
  levainPct: 20,
  levainHydrationPct: 100,
  saltPct: 2,
  extras: [],
};

describe("formula", () => {
  it("scales to the dough weight, with the levain's flour and water counted", () => {
    const s = scaleFormula(country, 2, 900);
    assert.equal(s.totalDough, 1800);
    assert.equal(s.totalFlour, 1017);
    assert.deepEqual(s.levain, { grams: 203, flour: 102, water: 102 });
    const weighed = s.mix.reduce((n, l) => n + l.grams, 0) + s.levain.grams;
    near(weighed, 1800, 3, "everything adds back up to the dough");
    const water = s.mix.find((l) => l.name === "Water")!;
    near(water.grams + s.levain.water, 0.75 * 1017, 2);
  });

  it("counts extras in the dough weight but not as water", () => {
    const s = scaleFormula({ ...country, extras: [{ name: "Olive oil", pct: 4 }] }, 1, 1000);
    assert.equal(s.totalFlour, Math.round(1000 / 1.81));
    assert.equal(s.mix.find((l) => l.name === "Olive oil")!.grams, Math.round((1000 / 1.81) * 0.04));
  });
});

const steps: RecipeStep[] = [
  { id: "levain", kind: "levain", label: "Build the levain", minutes: 300, temp: true, flex: null, folds: null, note: null },
  { id: "mix", kind: "mix", label: "Mix", minutes: 30, temp: false, flex: null, folds: null, note: "Add the levain and salt" },
  { id: "bulk", kind: "bulk", label: "Bulk", minutes: 300, temp: true, flex: null, folds: { count: 4, every: 30 }, note: null },
  { id: "shape", kind: "shape", label: "Shape", minutes: 30, temp: false, flex: null, folds: null, note: null },
  { id: "retard", kind: "retard", label: "Cold retard", minutes: 840, temp: false, flex: { min: 600, max: 1080 }, folds: null, note: null },
  { id: "bake", kind: "bake", label: "Bake", minutes: 45, temp: false, flex: null, folds: null, note: null },
];

describe("planner", () => {
  const readyAt = new Date("2026-10-11T15:00:00Z");

  it("schedules backward from the bake, end to end", () => {
    const plan = planBake({ steps, readyAt, tempF: 76, levainGrams: 200 });
    assert.equal(plan.at(-1)!.end_at, readyAt.toISOString());
    for (let i = 1; i < plan.length; i++) assert.equal(plan[i].start_at, plan[i - 1].end_at, plan[i].id);
    assert.equal(plan.find((s) => s.id === "retard")!.minutes, 840);
    assert.equal(plan.find((s) => s.id === "bulk")!.minutes, 300);
    assert.match(plan[0].detail!, /^Mix \d+ g starter \+ \d+ g flour \+ \d+ g water \(1:2:2\)/);
  });

  it("stretches temperature-sensitive steps in a cool kitchen and clamps flex steps", () => {
    const plan = planBake({ steps, readyAt, tempF: 68, levainGrams: 200, flex: { retard: 5000 } });
    assert.ok(plan.find((s) => s.id === "bulk")!.minutes > 300);
    assert.equal(plan.find((s) => s.id === "mix")!.minutes, 30);
    assert.equal(plan.find((s) => s.id === "retard")!.minutes, 1080);
    assert.equal(stepMinutes(steps[4], 76, 10), 600);
  });

  it("adds a revival feed for a starter in the fridge, and gives a slow starter longer", () => {
    const cold = planBake({ steps, readyAt, tempF: 72, levainGrams: 200, starter: { name: "Bertha", location: "fridge", speed: 1 } });
    assert.equal(cold[0].id, "starter-out");
    assert.equal(cold[0].label, "Take Bertha out and feed it");
    const counter = planBake({ steps, readyAt, tempF: 72, levainGrams: 200, starter: { name: "Bertha", location: "counter", speed: 1 } });
    assert.equal(counter[0].id, "levain");
    const slow = planBake({ steps, readyAt, tempF: 72, levainGrams: 200, starter: { name: "Bertha", location: "counter", speed: 2 } });
    assert.equal(slow[0].minutes, Math.round((counter[0].minutes * 2) / 5) * 5);
  });

  it("re-flows the rest of the plan when a step finishes early or late", () => {
    const plan = planBake({ steps, readyAt, tempF: 76, levainGrams: 200 });
    const late = new Date(Date.parse(plan[1].end_at) + 20 * 60_000);
    const after = completeStep(plan, "mix", late);
    assert.equal(after[0].done_at, late.toISOString(), "earlier open steps are closed too");
    assert.equal(after[1].done_at, late.toISOString());
    assert.equal(after[2].start_at, late.toISOString());
    assert.equal(Date.parse(after.at(-1)!.end_at) - readyAt.getTime(), 20 * 60_000);
    assert.equal(currentStep(after)!.id, "bulk");
    assert.equal(currentStep(after.map((s) => ({ ...s, done_at: s.done_at ?? late.toISOString() }))), null);
  });

  it("shifts what's left, extending the step under way", () => {
    const plan = planBake({ steps, readyAt, tempF: 76, levainGrams: 200 });
    const now = new Date(Date.parse(plan[2].start_at) + 60 * 60_000);
    const started = completeStep(plan, "mix", new Date(plan[1].end_at));
    const shifted = shiftRemaining(started, 30, now);
    assert.equal(shifted[2].start_at, started[2].start_at);
    assert.equal(shifted[2].minutes, started[2].minutes + 30);
    assert.equal(Date.parse(shifted[3].start_at) - Date.parse(started[3].start_at), 30 * 60_000);

    const pulled = shiftRemaining(started, -10_000, now);
    assert.equal(pulled[2].minutes, 5);
    assert.equal(pulled[3].start_at, pulled[2].end_at, "nothing overlaps the step under way");
  });

  it("schedules folds from the last one logged", () => {
    const plan = planBake({ steps, readyAt, tempF: 76, levainGrams: 200 });
    const bulk = plan[2];
    assert.deepEqual(
      foldsDue(bulk).map((d) => (d.getTime() - Date.parse(bulk.start_at)) / 60_000),
      [30, 60, 90, 120],
    );
    const at = new Date(Date.parse(bulk.start_at) + 40 * 60_000);
    let next = logFold(plan, "bulk", at);
    assert.deepEqual(
      foldsDue(next[2]).map((d) => (d.getTime() - at.getTime()) / 60_000),
      [30, 60, 90],
    );
    for (let i = 0; i < 5; i++) next = logFold(next, "bulk", at);
    assert.equal(next[2].fold_times.length, 4, "capped at the fold count");
    assert.deepEqual(foldsDue(next[2]), []);
  });

  it("flags steps that land in the night, in the baker's time zone", () => {
    const plan: BakeStep[] = planBake({ steps, readyAt: new Date("2026-10-11T16:00:00Z"), tempF: 76, levainGrams: 200 });
    // 16:00Z is noon in New York; the 14 h retard starts at 21:15 local, so
    // shaping is at 20:45, and nothing lands between 23:00 and 06:00…
    assert.deepEqual(nightSteps(plan, "America/New_York"), []);
    // …while in Tokyo the same instants are 13 hours later.
    assert.ok(nightSteps(plan, "Asia/Tokyo").length > 0);
  });
});
