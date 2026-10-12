import { useMemo, useState } from "react";
import { nightSteps, planBake, scaleFormula } from "../../../src/fermentation/index.js";
import { type RecipeRow, type StarterRow, api } from "../api";
import { Formula } from "../components/Formula";
import { Timeline } from "../components/Timeline";
import { ErrorNote, Field, Loading, PageTitle, Section, Segmented, useAction } from "../components/ui";
import { deviceTimeZone, duration, fromLocalInput, toLocalInput, when } from "../format";
import { go } from "../router";
import { fromUnit, toUnit, updatePrefs, usePrefs } from "../settings";
import { useApi } from "../useApi";

const HOUR = 3_600_000;

export function PlanBake({ recipeId }: { recipeId?: string }) {
  const data = useApi("plan", () => Promise.all([api.listRecipes(), api.listStarters()]));
  if (data.error) return <ErrorNote error={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const [recipes, starters] = data.data;
  return <PlanBody recipes={recipes} starters={starters} initialRecipe={recipeId} />;
}

/** Saturday or Sunday at noon, whichever is next and at least a day and a half away. */
function defaultReadyAt(): Date {
  const d = new Date(Date.now() + 36 * HOUR);
  d.setHours(12, 0, 0, 0);
  while (d.getDay() !== 6 && d.getDay() !== 0) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Plan a bake. The preview is the same planner the server runs (shared
 * src/fermentation), so what you see is exactly what gets saved. Steps that
 * land between 11pm and 6am are flagged; the cold retard's length is the
 * usual way to move them.
 */
function PlanBody({
  recipes,
  starters,
  initialRecipe,
}: {
  recipes: RecipeRow[];
  starters: StarterRow[];
  initialRecipe?: string;
}) {
  const prefs = usePrefs();
  const [recipeId, setRecipeId] = useState(
    recipes.some((r) => r.id === initialRecipe) ? initialRecipe! : recipes[0]?.id,
  );
  const recipe = recipes.find((r) => r.id === recipeId)!;
  const [readyAt, setReadyAt] = useState(() => toLocalInput(defaultReadyAt()));
  const [pieces, setPieces] = useState(String(recipe.config.pieces));
  const [pieceGrams, setPieceGrams] = useState(String(recipe.config.pieceGrams));
  const [temp, setTemp] = useState(() => String(toUnit(prefs.kitchenF, prefs.tempUnit)));
  const [starterId, setStarterId] = useState<string>(starters[0]?.id ?? "");
  const [levainRatio, setLevainRatio] = useState(2);
  const [flex, setFlex] = useState<Record<string, number>>({});
  const action = useAction();

  const pickRecipe = (id: string) => {
    const r = recipes.find((x) => x.id === id)!;
    setRecipeId(id);
    setPieces(String(r.config.pieces));
    setPieceGrams(String(r.config.pieceGrams));
    setFlex({});
  };

  const starter = starters.find((s) => s.id === starterId) ?? null;
  const tempF = temp === "" || !Number.isFinite(Number(temp)) ? prefs.kitchenF : fromUnit(Number(temp), prefs.tempUnit);
  const ready = fromLocalInput(readyAt);
  const n = Math.max(1, Math.round(Number(pieces) || recipe.config.pieces));
  const g = Math.max(20, Math.round(Number(pieceGrams) || recipe.config.pieceGrams));

  const preview = useMemo(() => {
    if (!ready) return null;
    const scaled = scaleFormula(recipe.config.formula, n, g);
    const steps = planBake({
      steps: recipe.config.steps,
      readyAt: ready,
      tempF,
      flex,
      levainGrams: scaled.levain.grams,
      levainRatio,
      starter: starter ? { name: starter.name, location: starter.location, speed: starter.speed.factor } : null,
    });
    return { scaled, steps, night: nightSteps(steps, deviceTimeZone()) };
  }, [recipe, n, g, ready?.getTime(), tempF, flex, levainRatio, starter]);

  const startsInPast = preview && Date.parse(preview.steps[0].start_at) < Date.now() - 5 * 60_000;
  const flexSteps = recipe.config.steps.filter((s) => s.flex);

  const start = () =>
    action.run(async () => {
      if (!ready) throw new Error("Pick when you want it out of the oven.");
      updatePrefs({ kitchenF: tempF });
      const bake = await api.planBake({
        recipeId,
        readyAt: ready.toISOString(),
        pieces: n,
        pieceGrams: g,
        tempF,
        starterId: starter?.id ?? null,
        levainRatio,
        flex,
      });
      go({ name: "bake", id: bake.id });
    });

  return (
    <div className="flex flex-col gap-5">
      <PageTitle>Plan a bake</PageTitle>

      <div className="card flex flex-col gap-4 p-4">
        <Field label="Recipe">
          <select id="plan-recipe" className="input" value={recipeId} onChange={(e) => pickRecipe(e.target.value)}>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.builtin ? "" : " (yours)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Out of the oven" help="outOfOven">
          <input id="plan-ready" type="datetime-local" className="input" value={readyAt} onChange={(e) => setReadyAt(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Pieces" help="pieces">
            <input id="plan-pieces" type="number" inputMode="numeric" className="input" value={pieces} onChange={(e) => setPieces(e.target.value)} />
          </Field>
          <Field label="Each, g">
            <input id="plan-grams" type="number" inputMode="numeric" className="input" value={pieceGrams} onChange={(e) => setPieceGrams(e.target.value)} />
          </Field>
          <Field label={`Kitchen, °${prefs.tempUnit}`} help="kitchenTemp">
            <input id="plan-temp" type="number" inputMode="decimal" className="input" value={temp} onChange={(e) => setTemp(e.target.value)} />
          </Field>
        </div>
        <Field label="Starter" help="planStarter" hint={starter?.location === "fridge" ? `${starter.name} is in the fridge, so the plan starts by taking it out.` : undefined}>
          <select id="plan-starter" className="input" value={starterId} onChange={(e) => setStarterId(e.target.value)}>
            {starters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.location === "fridge" ? "in the fridge" : "on the counter"})
              </option>
            ))}
            <option value="">No starter tracked</option>
          </select>
        </Field>
        <Field label="Levain" help="levainSpeed" group>
          <Segmented
            label="Levain"
            value={levainRatio}
            options={[
              { value: 2, label: "Quick 1:2:2" },
              { value: 5, label: "Overnight 1:5:5" },
            ]}
            onChange={setLevainRatio}
          />
        </Field>
        {flexSteps.map((s) => {
          const value = flex[s.id] ?? s.minutes;
          return (
            <Field key={s.id} help="retard" label={`${s.label}: ${duration(value)}`} hint={`Anywhere from ${duration(s.flex!.min)} to ${duration(s.flex!.max)}.`}>
              <input
                id={`plan-flex-${s.id}`}
                type="range"
                min={s.flex!.min}
                max={s.flex!.max}
                step={30}
                value={value}
                onChange={(e) => setFlex({ ...flex, [s.id]: Number(e.target.value) })}
                className="w-full accent-[rgb(var(--crust))]"
              />
            </Field>
          );
        })}
      </div>

      {preview && (
        <>
          <Section title="Schedule" help="night">
            {startsInPast && (
              <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
                This plan would have started {when(preview.steps[0].start_at)}. Pick a later time, or shorten the cold steps.
              </p>
            )}
            {preview.night.length > 0 && (
              <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
                {preview.night.length === 1 ? "One step lands" : `${preview.night.length} steps land`} in the middle of the night.
                {flexSteps.length > 0 ? " Try a longer or shorter cold step, or a different finish time." : " Try a different finish time."}
              </p>
            )}
            <div className="card p-4 pb-1">
              <Timeline steps={preview.steps} night={preview.night} />
            </div>
          </Section>

          <Section title="Formula" help="formula">
            <Formula scaled={preview.scaled} />
          </Section>
        </>
      )}

      {action.error && <ErrorNote error={action.error} />}
      <button type="button" className="btn-primary" disabled={action.busy || !preview} onClick={() => void start()}>
        Start this plan
      </button>
    </div>
  );
}
