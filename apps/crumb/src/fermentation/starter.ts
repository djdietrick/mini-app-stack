import { STARTER_REFERENCE_F, durationFactor } from "./temperature.js";

/**
 * When a fed starter peaks, and how to feed it so it peaks when you need it.
 *
 * A feed is written starter : flour : water by weight, and the ratio here is
 * flour per gram of starter (1:5:5 is 5). More food per gram of starter means
 * a slower rise. Measured side by side at 75°F, a healthy starter took about
 * 5 h to peak at 1:1:1, 10 h at 1:5:5 and 17 h at 1:10:10; `4 h + 1.3 h × ratio`
 * fits those within half an hour. Temperature scales that (temperature.ts).
 *
 * Every starter is different, so the model also carries a per-starter speed:
 * the median of observed ÷ predicted over its recent logged peaks.
 */

/** Used when a feed was logged without a temperature. */
export const DEFAULT_TEMP_F = 72;

/** The ratios the feed calculator suggests from, as `1:r:r`. */
export const RATIOS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15] as const;

const HOUR = 3_600_000;

export interface FeedObservation {
  fedAt: string;
  starterG: number;
  flourG: number;
  tempF: number | null;
  peakAt: string | null;
}

/** Flour per gram of starter. */
export function feedRatio(starterG: number, flourG: number): number {
  return starterG > 0 ? flourG / starterG : 0;
}

/** Hours from feeding to peak. `speed` is the starter's own factor, 1 for a typical starter. */
export function peakHours(ratio: number, tempF: number, speed = 1): number {
  return (4 + 1.3 * ratio) * durationFactor(tempF, STARTER_REFERENCE_F) * speed;
}

export function predictPeak(fedAt: Date, ratio: number, tempF: number, speed = 1): Date {
  return new Date(fedAt.getTime() + peakHours(ratio, tempF, speed) * HOUR);
}

export interface Speed {
  /** Observed ÷ predicted time to peak. Above 1 is a slow starter. */
  factor: number;
  /** Logged peaks it is based on; 0 means the default. */
  samples: number;
}

export const SPEED_RANGE = { min: 0.4, max: 3 } as const;

/**
 * The starter's speed from its most recent logged peaks (at most `window`).
 * Feeds with implausible numbers, such as a peak logged before the feed, are
 * ignored rather than trusted.
 */
export function speedFactor(feedings: readonly FeedObservation[], window = 8): Speed {
  const ratios = feedings
    .filter((f) => f.peakAt !== null)
    .sort((a, b) => b.fedAt.localeCompare(a.fedAt))
    .map((f) => {
      const hours = (Date.parse(f.peakAt!) - Date.parse(f.fedAt)) / HOUR;
      const ratio = feedRatio(f.starterG, f.flourG);
      if (!(hours > 0.5 && hours < 72) || !(ratio >= 0.5 && ratio <= 20)) return null;
      return hours / peakHours(ratio, f.tempF ?? DEFAULT_TEMP_F);
    })
    .filter((x): x is number => x !== null)
    .slice(0, window);

  if (ratios.length === 0) return { factor: 1, samples: 0 };
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    factor: Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, median)),
    samples: ratios.length,
  };
}

export interface FeedAmounts {
  starter: number;
  flour: number;
  water: number;
  /** What the jar holds once fed. */
  total: number;
}

/**
 * Grams to keep and add so the jar holds `need + reserve` once fed, at
 * `1:ratio:ratio×hydration`. `reserve` is what stays behind to keep the
 * culture going. Starter is rounded up so there is never less than asked for.
 */
export function feedAmounts(need: number, reserve: number, ratio: number, hydrationPct = 100): FeedAmounts {
  const h = hydrationPct / 100;
  const starter = Math.max(1, Math.ceil((need + reserve) / (1 + ratio * (1 + h))));
  const flour = Math.round(starter * ratio);
  const water = Math.round(flour * h);
  return { starter, flour, water, total: starter + flour + water };
}

export type FeedPlanStatus =
  /** Feed now at `ratio`; it peaks close to when it is needed. */
  | "ok"
  /** Even 1:1:1 peaks after it is needed: feed now anyway, somewhere warm. */
  | "too-soon"
  /** Even the slowest feed peaks too early: feed at `feedAt` instead. */
  | "feed-later";

export interface FeedPlan {
  status: FeedPlanStatus;
  ratio: number;
  feedAt: Date;
  peakAt: Date;
  amounts: FeedAmounts;
}

export interface FeedPlanInput {
  now: Date;
  /** When the ripe starter is needed. */
  readyAt: Date;
  tempF: number;
  speed?: number;
  /** Grams of ripe starter needed. */
  need: number;
  reserve: number;
  hydrationPct?: number;
}

/** A starter is at its best from a little before its peak to a while after. */
const IDEAL_LEAD_H = 0.5;
const LATE_OK_H = 0.5;
const EARLY_OK_H = 3;
/** The ratio suggested when the feed should wait. */
const LATER_RATIO = 5;

/**
 * Picks the feed that peaks closest to half an hour before `readyAt`. When
 * none can (too little time, or too much), says so and gives the nearest
 * thing that works.
 */
export function planFeed(input: FeedPlanInput): FeedPlan {
  const speed = input.speed ?? 1;
  const hydration = input.hydrationPct ?? 100;
  const ideal = input.readyAt.getTime() - IDEAL_LEAD_H * HOUR;
  const latest = input.readyAt.getTime() + LATE_OK_H * HOUR;
  const earliest = input.readyAt.getTime() - EARLY_OK_H * HOUR;
  const amounts = (ratio: number) => feedAmounts(input.need, input.reserve, ratio, hydration);

  const options = RATIOS.map((ratio) => ({ ratio, peakAt: predictPeak(input.now, ratio, input.tempF, speed) }));
  const fits = options.filter((o) => o.peakAt.getTime() <= latest);

  if (fits.length === 0) {
    const fastest = options[0];
    return { status: "too-soon", ratio: fastest.ratio, feedAt: input.now, peakAt: fastest.peakAt, amounts: amounts(fastest.ratio) };
  }

  const best = fits.reduce((a, b) =>
    Math.abs(b.peakAt.getTime() - ideal) < Math.abs(a.peakAt.getTime() - ideal) ? b : a,
  );
  if (best.peakAt.getTime() >= earliest) {
    return { status: "ok", ratio: best.ratio, feedAt: input.now, peakAt: best.peakAt, amounts: amounts(best.ratio) };
  }

  const feedAt = new Date(ideal - peakHours(LATER_RATIO, input.tempF, speed) * HOUR);
  return {
    status: "feed-later",
    ratio: LATER_RATIO,
    feedAt,
    peakAt: predictPeak(feedAt, LATER_RATIO, input.tempF, speed),
    amounts: amounts(LATER_RATIO),
  };
}

/** "1:5:5", or "1:2.5:2.5" for a fractional ratio; water follows hydration. */
export function ratioLabel(ratio: number, hydrationPct = 100): string {
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  return `1:${fmt(ratio)}:${fmt((ratio * hydrationPct) / 100)}`;
}
