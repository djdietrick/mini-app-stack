import { feedAmounts, peakHours, ratioLabel } from "./starter.js";
import { DOUGH_REFERENCE_F, durationFactor } from "./temperature.js";

/**
 * The bake planner: a recipe's steps, scheduled backward from when the bread
 * should come out of the oven.
 *
 * Step durations are written for dough at 76°F. Steps marked `temp` (bulk,
 * proof) stretch or shrink with the kitchen temperature; `flex` steps (a cold
 * retard) can be set anywhere in their range, which is how a plan is moved
 * out of the middle of the night without changing the bake time. The levain,
 * and the revival feed for a starter coming out of the fridge, are timed from
 * the starter model rather than the recipe, so a slow starter gets more time.
 *
 * A planned step is stored and sent exactly as BakeStep (snake_case, ISO
 * strings), so the SPA's preview and the server's saved plan are one shape.
 */

export const STEP_KINDS = [
  "starter",
  "levain",
  "autolyse",
  "mix",
  "bulk",
  "preshape",
  "shape",
  "proof",
  "retard",
  "temper",
  "preheat",
  "boil",
  "bake",
  "other",
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface StepFlex {
  min: number;
  max: number;
}

export interface StepFolds {
  /** Sets of stretch and folds during the step. */
  count: number;
  /** Minutes between sets, the first one `every` after the step starts. */
  every: number;
}

export interface RecipeStep {
  /** Unique within the recipe; becomes the bake step's id. */
  id: string;
  kind: StepKind;
  label: string;
  /** At 76°F for `temp` steps; the default for `flex` steps. */
  minutes: number;
  temp: boolean;
  flex: StepFlex | null;
  folds: StepFolds | null;
  note: string | null;
}

export interface BakeStep {
  id: string;
  kind: StepKind;
  label: string;
  detail: string | null;
  start_at: string;
  end_at: string;
  minutes: number;
  flex: StepFlex | null;
  folds: StepFolds | null;
  /** When each set of folds was logged, oldest first. */
  fold_times: string[];
  done_at: string | null;
}

export interface PlanStarter {
  name: string;
  location: "fridge" | "counter";
  speed: number;
}

export interface PlanInput {
  steps: readonly RecipeStep[];
  /** When the last step ends: out of the oven. */
  readyAt: Date;
  tempF: number;
  /** Minutes for `flex` steps, by step id. Clamped to each step's range. */
  flex?: Record<string, number>;
  /** Grams of ripe levain the dough needs. */
  levainGrams: number;
  /** Levain build ratio, `1:r:r`. 2 builds in an afternoon, 5 overnight. */
  levainRatio?: number;
  starter?: PlanStarter | null;
}

export const DEFAULT_LEVAIN_RATIO = 2;
/** The revival feed for a starter straight out of the fridge. */
export const REVIVAL_RATIO = 2;

const MINUTE = 60_000;

const round5 = (min: number) => Math.max(5, Math.round(min / 5) * 5);

export function stepMinutes(step: RecipeStep, tempF: number, flex?: number): number {
  if (step.flex) return Math.min(step.flex.max, Math.max(step.flex.min, Math.round(flex ?? step.minutes)));
  if (step.temp) return round5(step.minutes * durationFactor(tempF, DOUGH_REFERENCE_F));
  return step.minutes;
}

export function planBake(input: PlanInput): BakeStep[] {
  const speed = input.starter?.speed ?? 1;
  const levainRatio = input.levainRatio ?? DEFAULT_LEVAIN_RATIO;

  const drafts: Omit<BakeStep, "start_at" | "end_at">[] = [];

  if (input.starter?.location === "fridge") {
    drafts.push({
      id: "starter-out",
      kind: "starter",
      label: `Take ${input.starter.name} out and feed it`,
      detail: `Feed it ${ratioLabel(REVIVAL_RATIO)} and leave it on the counter. It's ready for the levain once it has risen and domed.`,
      minutes: round5(peakHours(REVIVAL_RATIO, input.tempF, speed) * 60),
      flex: null,
      folds: null,
      fold_times: [],
      done_at: null,
    });
  }

  for (const step of input.steps) {
    if (step.kind === "levain") {
      const grams = Math.max(1, Math.round(input.levainGrams));
      const a = feedAmounts(grams, Math.max(5, Math.round(grams * 0.05)), levainRatio);
      drafts.push({
        id: step.id,
        kind: step.kind,
        label: step.label,
        detail:
          `Mix ${a.starter} g starter + ${a.flour} g flour + ${a.water} g water (${ratioLabel(levainRatio)}). ` +
          `You need ${grams} g once it has peaked.`,
        minutes: round5(peakHours(levainRatio, input.tempF, speed) * 60),
        flex: null,
        folds: null,
        fold_times: [],
        done_at: null,
      });
      continue;
    }
    drafts.push({
      id: step.id,
      kind: step.kind,
      label: step.label,
      detail: step.note,
      minutes: stepMinutes(step, input.tempF, input.flex?.[step.id]),
      flex: step.flex,
      folds: step.folds,
      fold_times: [],
      done_at: null,
    });
  }

  let cursor = input.readyAt.getTime();
  const out: BakeStep[] = new Array(drafts.length);
  for (let i = drafts.length - 1; i >= 0; i--) {
    const start = cursor - drafts[i].minutes * MINUTE;
    out[i] = { ...drafts[i], start_at: iso(start), end_at: iso(cursor) };
    cursor = start;
  }
  return out;
}

/** The first step not yet done, or null once every step is. */
export function currentStep(steps: readonly BakeStep[]): BakeStep | null {
  return steps.find((s) => s.done_at === null) ?? null;
}

/**
 * Marks `id` done at `at`, along with any earlier step still open, and moves
 * every later open step by however early or late this one finished.
 */
export function completeStep(steps: readonly BakeStep[], id: string, at: Date): BakeStep[] {
  const index = steps.findIndex((s) => s.id === id);
  if (index < 0) return [...steps];
  const delta = at.getTime() - Date.parse(steps[index].end_at);
  return steps.map((s, i) => {
    if (s.done_at !== null) return s;
    if (i <= index) return { ...s, done_at: iso(at.getTime()) };
    return move(s, delta, delta);
  });
}

/**
 * Pushes the rest of the plan back (or forward, for a negative `minutes`). A
 * step already under way keeps its start and runs longer; the ones after it
 * move whole.
 */
export function shiftRemaining(steps: readonly BakeStep[], minutes: number, now: Date): BakeStep[] {
  // A step under way can't shrink below five minutes; whatever it couldn't
  // absorb is not passed on, so the steps after it never overlap it.
  let delta = minutes * MINUTE;
  return steps.map((s) => {
    if (s.done_at !== null) return s;
    if (Date.parse(s.start_at) <= now.getTime()) {
      const start = Date.parse(s.start_at);
      const end = Math.max(start + 5 * MINUTE, Date.parse(s.end_at) + delta);
      delta = end - Date.parse(s.end_at);
      return { ...s, end_at: iso(end), minutes: Math.round((end - start) / MINUTE) };
    }
    return move(s, delta, delta);
  });
}

/** Records a set of folds on step `id`. Ignored past the step's fold count. */
export function logFold(steps: readonly BakeStep[], id: string, at: Date): BakeStep[] {
  return steps.map((s) =>
    s.id === id && s.folds && s.fold_times.length < s.folds.count
      ? { ...s, fold_times: [...s.fold_times, iso(at.getTime())] }
      : s,
  );
}

/**
 * When each remaining set of folds is due: `every` minutes apart, counted
 * from the last one logged (or the start of the step).
 */
export function foldsDue(step: BakeStep): Date[] {
  if (!step.folds) return [];
  const done = step.fold_times.length;
  const base = Date.parse(done ? step.fold_times[done - 1] : step.start_at);
  const out: Date[] = [];
  for (let k = 1; k <= step.folds.count - done; k++) out.push(new Date(base + step.folds.every * k * MINUTE));
  return out;
}

export interface QuietHours {
  /** Hour of the day, 0–23, local. */
  from: number;
  to: number;
}

export const DEFAULT_QUIET: QuietHours = { from: 23, to: 6 };

/** Open steps that start inside quiet hours in `timeZone`: you'd be up at night for them. */
export function nightSteps(steps: readonly BakeStep[], timeZone: string, quiet: QuietHours = DEFAULT_QUIET): string[] {
  const hourOf = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" });
  return steps
    .filter((s) => s.done_at === null)
    .filter((s) => {
      const h = Number(hourOf.format(new Date(s.start_at)));
      return quiet.from > quiet.to ? h >= quiet.from || h < quiet.to : h >= quiet.from && h < quiet.to;
    })
    .map((s) => s.id);
}

function move(s: BakeStep, startDelta: number, endDelta: number): BakeStep {
  return {
    ...s,
    start_at: iso(Date.parse(s.start_at) + startDelta),
    end_at: iso(Date.parse(s.end_at) + endDelta),
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
