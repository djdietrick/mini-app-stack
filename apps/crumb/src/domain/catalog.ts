import type { RecipeStep } from "../fermentation/index.js";
import type { RecipeConfig, RecipeRow } from "./types.js";

/**
 * The built-in recipes. Starting points rather than final formulas: they are
 * read-only (403 BUILTIN_READ_ONLY), and a baker who wants changes copies one.
 *
 * Ids are fixed UUIDs and must never change: bakes store the id they were
 * planned from, with no foreign key, because built-ins are not rows.
 *
 * Durations are for dough at 76°F; `temp` steps scale with the kitchen. The
 * levain step's time comes from the starter model, not from `minutes`.
 */

type Step = Omit<RecipeStep, "temp" | "flex" | "folds" | "note"> & Partial<RecipeStep>;

const step = (s: Step): RecipeStep => ({ temp: false, flex: null, folds: null, note: null, ...s });

const levain = step({
  id: "levain",
  kind: "levain",
  label: "Build the levain",
  minutes: 360,
  temp: true,
  note: "Ready when it has doubled and the top is domed.",
});

const BUILTIN_AT = "2026-10-11T00:00:00.000Z";

function builtin(id: string, name: string, kind: RecipeRow["kind"], config: RecipeConfig): RecipeRow {
  return { id, name, kind, config, builtin: true, created_at: BUILTIN_AT, updated_at: BUILTIN_AT };
}

export const BUILTIN_RECIPES: readonly RecipeRow[] = [
  builtin("992c4166-7d96-4e19-9258-77d406df4f02", "Country loaf", "loaf", {
    formula: {
      flours: [
        { name: "Bread flour", pct: 90 },
        { name: "Whole wheat flour", pct: 10 },
      ],
      hydrationPct: 75,
      levainPct: 20,
      levainHydrationPct: 100,
      saltPct: 2,
      extras: [],
    },
    pieces: 2,
    pieceGrams: 900,
    notes:
      "Hold back about 50 g of the water to add with the salt. Bake in a Dutch oven: 20 minutes lid on at 480°F, then 20–25 minutes lid off at 450°F, until deep brown.",
    steps: [
      levain,
      step({ id: "autolyse", kind: "autolyse", label: "Mix flour and water (autolyse)", minutes: 45, note: "Just until no dry flour is left. Cover and rest." }),
      step({ id: "mix", kind: "mix", label: "Add the levain and salt", minutes: 15, note: "Squeeze and fold until the dough comes back together." }),
      step({
        id: "bulk",
        kind: "bulk",
        label: "Bulk ferment",
        minutes: 300,
        temp: true,
        folds: { count: 4, every: 30 },
        note: "Done when it has risen about 50%, the edges are domed and you see bubbles on the sides.",
      }),
      step({ id: "preshape", kind: "preshape", label: "Pre-shape and bench rest", minutes: 30, note: "Divide, round each piece loosely, rest uncovered." }),
      step({ id: "shape", kind: "shape", label: "Shape into bannetons", minutes: 15 }),
      step({
        id: "retard",
        kind: "retard",
        label: "Cold retard in the fridge",
        minutes: 840,
        flex: { min: 600, max: 1080 },
        note: "Covered. Anywhere from 10 to 18 hours.",
      }),
      step({ id: "preheat", kind: "preheat", label: "Preheat oven and Dutch oven to 500°F", minutes: 45, note: "The dough stays in the fridge until it goes in." }),
      step({ id: "bake", kind: "bake", label: "Score and bake", minutes: 45, note: "20 min lid on at 480°F, 20–25 min lid off at 450°F." }),
    ],
  }),

  builtin("04fca060-e743-4d3b-aaf4-7ca0012031d1", "Sandwich loaf", "sandwich", {
    formula: {
      flours: [{ name: "Bread flour", pct: 100 }],
      hydrationPct: 62,
      levainPct: 25,
      levainHydrationPct: 100,
      saltPct: 2,
      extras: [
        { name: "Butter, soft", pct: 8 },
        { name: "Honey", pct: 6 },
      ],
    },
    pieces: 1,
    pieceGrams: 950,
    notes: "For a 9×5 in pan. Swap some or all of the water for milk for a softer crumb. Bake to 190°F inside.",
    steps: [
      levain,
      step({ id: "mix", kind: "mix", label: "Mix, then knead in the butter", minutes: 20, note: "Everything but the butter first; add it once the dough is smooth." }),
      step({ id: "bulk", kind: "bulk", label: "Bulk ferment", minutes: 300, temp: true, folds: { count: 3, every: 45 }, note: "Until about doubled." }),
      step({ id: "shape", kind: "shape", label: "Shape into the greased pan", minutes: 15 }),
      step({ id: "proof", kind: "proof", label: "Proof in the pan", minutes: 180, temp: true, note: "Until it crowns about an inch above the rim." }),
      step({ id: "preheat", kind: "preheat", label: "Preheat oven to 375°F", minutes: 30 }),
      step({ id: "bake", kind: "bake", label: "Bake", minutes: 45, note: "40–45 min at 375°F, until 190°F inside. Cool before slicing." }),
    ],
  }),

  builtin("f0b904ec-048a-4182-a3ab-c4910c49db92", "Focaccia", "focaccia", {
    formula: {
      flours: [{ name: "Bread flour", pct: 100 }],
      hydrationPct: 80,
      levainPct: 15,
      levainHydrationPct: 100,
      saltPct: 2.2,
      extras: [{ name: "Olive oil", pct: 4 }],
    },
    pieces: 1,
    pieceGrams: 1100,
    notes: "For a 9×13 in pan with 3 tbsp olive oil in it. Top with flaky salt, rosemary, or whatever you like before baking.",
    steps: [
      levain,
      step({ id: "mix", kind: "mix", label: "Mix", minutes: 20, note: "Wet and shaggy is right." }),
      step({ id: "bulk", kind: "bulk", label: "Bulk ferment", minutes: 240, temp: true, folds: { count: 4, every: 30 } }),
      step({ id: "pan", kind: "shape", label: "Into the oiled pan", minutes: 10 }),
      step({
        id: "retard",
        kind: "retard",
        label: "Cover and refrigerate",
        minutes: 720,
        flex: { min: 480, max: 1440 },
        note: "Overnight, or up to a day.",
      }),
      step({ id: "proof", kind: "proof", label: "Warm proof in the pan", minutes: 180, temp: true, note: "Until puffy and jiggly. Stretch it to the corners partway through." }),
      step({ id: "preheat", kind: "preheat", label: "Dimple, top, and preheat to 450°F", minutes: 30 }),
      step({ id: "bake", kind: "bake", label: "Bake", minutes: 25, note: "Until golden all over and crisp underneath." }),
    ],
  }),

  builtin("1bf1f093-e31b-405c-9593-ca63de93f5c1", "Pizza dough", "pizza", {
    formula: {
      flours: [{ name: "00 or bread flour", pct: 100 }],
      hydrationPct: 68,
      levainPct: 12,
      levainHydrationPct: 100,
      saltPct: 2.5,
      extras: [{ name: "Olive oil", pct: 2 }],
    },
    pieces: 4,
    pieceGrams: 260,
    notes: "Preheat a steel or stone for a full hour at the oven's highest setting while the dough warms up.",
    steps: [
      levain,
      step({ id: "mix", kind: "mix", label: "Mix", minutes: 20 }),
      step({ id: "bulk", kind: "bulk", label: "Bulk ferment", minutes: 180, temp: true, folds: { count: 2, every: 30 } }),
      step({ id: "ball", kind: "shape", label: "Divide and ball", minutes: 15 }),
      step({
        id: "retard",
        kind: "retard",
        label: "Cold ferment",
        minutes: 1440,
        flex: { min: 720, max: 4320 },
        note: "One to three days. Longer is more flavor.",
      }),
      step({ id: "temper", kind: "temper", label: "Out of the fridge, and preheat", minutes: 120, note: "Covered on the counter. Start the oven and steel now." }),
      step({ id: "bake", kind: "bake", label: "Stretch, top and bake", minutes: 40, note: "6–8 minutes each on the steel." }),
    ],
  }),

  builtin("c3d29e5e-2640-495d-ab17-e1731011be29", "Baguettes", "baguette", {
    formula: {
      flours: [{ name: "Bread or all-purpose flour", pct: 100 }],
      hydrationPct: 70,
      levainPct: 20,
      levainHydrationPct: 100,
      saltPct: 2,
      extras: [],
    },
    pieces: 3,
    pieceGrams: 350,
    notes: "Bake at 475°F with steam for the first 12 minutes (a tray of boiling water on the bottom rack), then dry heat.",
    steps: [
      levain,
      step({ id: "autolyse", kind: "autolyse", label: "Mix flour and water (autolyse)", minutes: 30 }),
      step({ id: "mix", kind: "mix", label: "Add the levain and salt", minutes: 15 }),
      step({ id: "bulk", kind: "bulk", label: "Bulk ferment", minutes: 180, temp: true, folds: { count: 3, every: 30 } }),
      step({
        id: "retard",
        kind: "retard",
        label: "Cold bulk in the fridge",
        minutes: 720,
        flex: { min: 480, max: 1080 },
      }),
      step({ id: "preshape", kind: "preshape", label: "Divide and pre-shape", minutes: 30, note: "Loose logs; rest covered." }),
      step({ id: "shape", kind: "shape", label: "Shape baguettes onto a couche", minutes: 15 }),
      step({ id: "proof", kind: "proof", label: "Proof, and preheat with a steam tray", minutes: 60, temp: true }),
      step({ id: "bake", kind: "bake", label: "Score and bake", minutes: 25 }),
    ],
  }),

  builtin("3be9130a-ef73-420a-b6a7-4d63d606dcab", "Bagels", "bagel", {
    formula: {
      flours: [{ name: "High-protein bread flour", pct: 100 }],
      hydrationPct: 55,
      levainPct: 20,
      levainHydrationPct: 100,
      saltPct: 2,
      extras: [{ name: "Barley malt syrup or honey", pct: 3 }],
    },
    pieces: 8,
    pieceGrams: 115,
    notes: "A stiff dough: knead until smooth. Add a spoon of malt syrup and a little baking soda to the boiling water.",
    steps: [
      levain,
      step({ id: "mix", kind: "mix", label: "Mix and knead", minutes: 20, note: "8–10 minutes until smooth and stiff." }),
      step({ id: "bulk", kind: "bulk", label: "Bulk ferment", minutes: 240, temp: true }),
      step({ id: "shape", kind: "shape", label: "Divide and shape rings", minutes: 30 }),
      step({
        id: "retard",
        kind: "retard",
        label: "Refrigerate overnight on a tray",
        minutes: 720,
        flex: { min: 480, max: 1080 },
      }),
      step({ id: "boil", kind: "boil", label: "Preheat to 450°F and boil", minutes: 40, note: "One minute per side in the malted water, then toppings." }),
      step({ id: "bake", kind: "bake", label: "Bake", minutes: 22 }),
    ],
  }),
];

const byId = new Map(BUILTIN_RECIPES.map((r) => [r.id, r]));

export function builtinRecipe(id: string): RecipeRow | undefined {
  return byId.get(id);
}
