/**
 * Temperature and fermentation speed.
 *
 * Every timing in Crumb starts from a duration measured at a reference
 * temperature and is scaled by how much warmer or cooler the kitchen is. The
 * rule of thumb bakers use, and the one here: fermentation roughly doubles in
 * length for every 15°F (about 8°C) cooler, and halves for every 15°F warmer.
 *
 * Outside 60–90°F the rule stops describing a starter (a fridge nearly stops
 * it), so temperatures are clamped to that band before scaling. Temperatures
 * are °F throughout the domain; the SPA converts for display.
 */

/** Feeding ratios in research and this model are timed at 75°F. */
export const STARTER_REFERENCE_F = 75;

/** Recipe step durations are written for dough at 76°F. */
export const DOUGH_REFERENCE_F = 76;

/** Doubling every this many °F cooler. */
const DOUBLING_F = 15;

export const MODEL_RANGE_F = { min: 60, max: 90 } as const;

export function fToC(f: number): number {
  return ((f - 32) * 5) / 9;
}

export function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

/**
 * How many times longer fermentation takes at `tempF` than at `referenceF`.
 * 1 at the reference, 2 at 15°F cooler, 0.5 at 15°F warmer.
 */
export function durationFactor(tempF: number, referenceF: number): number {
  const t = Math.min(MODEL_RANGE_F.max, Math.max(MODEL_RANGE_F.min, tempF));
  return 2 ** ((referenceF - t) / DOUBLING_F);
}
