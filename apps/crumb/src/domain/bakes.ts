import { foldsDue, planBake, scaleFormula } from "../fermentation/index.js";
import type { BakeInput, BakeRow, NewBake, RecipeRow, ReminderInput, StarterRow } from "./types.js";

/**
 * Planning a bake from a recipe, and the reminders a bake's plan implies.
 * Pure: the routes load the rows and store the results.
 */

export const bakeGroup = (id: string) => `bake:${id}`;

export function planNewBake(recipe: RecipeRow, input: BakeInput, starter: StarterRow | null): NewBake {
  const pieces = input.pieces ?? recipe.config.pieces;
  const pieceGrams = input.pieceGrams ?? recipe.config.pieceGrams;
  const scaled = scaleFormula(recipe.config.formula, pieces, pieceGrams);
  const steps = planBake({
    steps: recipe.config.steps,
    readyAt: new Date(input.readyAt),
    tempF: input.tempF,
    flex: input.flex,
    levainGrams: scaled.levain.grams,
    levainRatio: input.levainRatio,
    starter: starter ? { name: starter.name, location: starter.location, speed: starter.speed.factor } : null,
  });
  return {
    recipe_id: recipe.id,
    recipe_name: recipe.name,
    kind: recipe.kind,
    starter_id: starter?.id ?? null,
    status: "active",
    ready_at: steps.at(-1)!.end_at,
    pieces,
    piece_grams: pieceGrams,
    temp_f: input.tempF,
    levain: scaled.levain,
    mix: scaled.mix,
    steps,
    notes: "",
    rating: null,
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * One reminder as each open step starts, one for each set of folds still to
 * do, and one when the bread is out. Only future ones: whatever is already
 * due was either sent or is on screen.
 */
export function bakeReminders(bake: BakeRow, now: Date): ReminderInput[] {
  if (bake.status !== "active") return [];
  const group = bakeGroup(bake.id);
  const url = `#/bakes/${bake.id}`;
  const out: ReminderInput[] = [];

  for (const step of bake.steps) {
    if (step.done_at !== null) continue;
    out.push({
      key: `${group}:${step.id}`,
      title: step.label,
      body: clip(step.detail ? `${bake.recipe_name} · ${step.detail}` : bake.recipe_name, 240),
      url,
      due_at: step.start_at,
    });
    const folds = foldsDue(step);
    const done = step.fold_times.length;
    folds.forEach((at, i) => {
      out.push({
        key: `${group}:${step.id}:fold${done + i + 1}`,
        title: `Stretch and fold (${done + i + 1} of ${step.folds!.count})`,
        body: bake.recipe_name,
        url,
        due_at: at.toISOString(),
      });
    });
  }

  if (bake.steps.some((s) => s.done_at === null)) {
    out.push({
      key: `${group}:ready`,
      title: "Out of the oven",
      body: `${bake.recipe_name}: let it cool before you slice it.`,
      url,
      due_at: bake.ready_at,
    });
  }

  return out.filter((r) => Date.parse(r.due_at) > now.getTime());
}
