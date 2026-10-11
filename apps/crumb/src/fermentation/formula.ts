/**
 * Baker's percentages: every ingredient as a percent of the total flour.
 *
 * The levain is counted the way most formulas count it: `levainPct` is the
 * weight of ripe levain as a percent of total flour, and the flour and water
 * inside it are part of the dough's flour and hydration. So the flour and
 * water you weigh at mixing are the totals minus what the levain brings.
 *
 * These types are mirrored by the zod schemas in domain/types.ts, which check
 * they stay assignable to each other.
 */

export interface FlourPart {
  name: string;
  /** Percent of total flour; a formula's flours add up to 100. */
  pct: number;
}

export interface Extra {
  name: string;
  pct: number;
}

export interface Formula {
  flours: FlourPart[];
  /** Total water ÷ total flour, levain included. */
  hydrationPct: number;
  /** Ripe levain ÷ total flour. */
  levainPct: number;
  /** The levain's own water ÷ flour. */
  levainHydrationPct: number;
  saltPct: number;
  /** Oil, butter, honey, malt… Not counted as water. */
  extras: Extra[];
}

export interface Line {
  name: string;
  grams: number;
  /** Baker's percent, for display. */
  pct: number;
}

export interface ScaledFormula {
  totalDough: number;
  totalFlour: number;
  /** Ripe levain to add at mixing. */
  levain: { grams: number; flour: number; water: number };
  /** What to weigh at mixing, besides the levain. */
  mix: Line[];
}

const round = (n: number) => Math.round(n);

/** Grams for `pieces` pieces of `pieceGrams` dough each. */
export function scaleFormula(formula: Formula, pieces: number, pieceGrams: number): ScaledFormula {
  const totalDough = pieces * pieceGrams;
  const extrasPct = formula.extras.reduce((n, e) => n + e.pct, 0);
  const totalFlour = totalDough / (1 + (formula.hydrationPct + formula.saltPct + extrasPct) / 100);

  const levainGrams = (totalFlour * formula.levainPct) / 100;
  const levainFlour = levainGrams / (1 + formula.levainHydrationPct / 100);
  const levainWater = levainGrams - levainFlour;

  // The levain's flour is taken from each flour in proportion, as if it had
  // been built from the same blend. Close enough at levain percentages.
  const mixFlourShare = (totalFlour - levainFlour) / totalFlour;

  const mix: Line[] = [
    ...formula.flours.map((f) => ({ name: f.name, grams: round(((totalFlour * f.pct) / 100) * mixFlourShare), pct: f.pct })),
    { name: "Water", grams: round(Math.max(0, (totalFlour * formula.hydrationPct) / 100 - levainWater)), pct: formula.hydrationPct },
    { name: "Salt", grams: round((totalFlour * formula.saltPct) / 100), pct: formula.saltPct },
    ...formula.extras.map((e) => ({ name: e.name, grams: round((totalFlour * e.pct) / 100), pct: e.pct })),
  ];

  return {
    totalDough: round(totalDough),
    totalFlour: round(totalFlour),
    levain: { grams: round(levainGrams), flour: round(levainFlour), water: round(levainWater) },
    mix,
  };
}
