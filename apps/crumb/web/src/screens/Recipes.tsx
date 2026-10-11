import { useState } from "react";
import { scaleFormula } from "../../../src/fermentation/index.js";
import { type RecipeKind, type RecipeRow, api } from "../api";
import { Formula } from "../components/Formula";
import { ErrorNote, Field, Loading, PageTitle, Pill, Section, useAction } from "../components/ui";
import { duration } from "../format";
import { go, href } from "../router";
import { useApi } from "../useApi";

export const KIND_LABELS: Record<RecipeKind, string> = {
  loaf: "Loaf",
  sandwich: "Sandwich",
  focaccia: "Focaccia",
  pizza: "Pizza",
  baguette: "Baguette",
  bagel: "Bagels",
  other: "Other",
};

/** Hands-on time to finish, roughly: the whole plan at 76°F with default flex. */
function totalMinutes(r: RecipeRow): number {
  return r.config.steps.reduce((n, s) => n + s.minutes, 0);
}

export function Recipes() {
  const { data, error, reload } = useApi("recipes", api.listRecipes);
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data) return <Loading />;
  const own = data.filter((r) => !r.builtin);
  const builtins = data.filter((r) => r.builtin);
  return (
    <div>
      <PageTitle
        action={
          <a href={href({ name: "recipe-edit", mode: "new" })} className="btn">
            New
          </a>
        }
      >
        Recipes
      </PageTitle>
      {own.length > 0 && (
        <Section title="Yours">
          {own.map((r) => (
            <RecipeLine key={r.id} recipe={r} />
          ))}
        </Section>
      )}
      <Section title="Starting points">
        {builtins.map((r) => (
          <RecipeLine key={r.id} recipe={r} />
        ))}
      </Section>
    </div>
  );
}

function RecipeLine({ recipe: r }: { recipe: RecipeRow }) {
  const f = r.config.formula;
  return (
    <a href={href({ name: "recipe", id: r.id })} className="card focus-ring flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="truncate font-bold">{r.name}</div>
        <div className="text-sm text-muted">
          {f.hydrationPct}% hydration · {r.config.pieces} × {r.config.pieceGrams} g · about {duration(totalMinutes(r))}
        </div>
      </div>
      <Pill tone="crust">{KIND_LABELS[r.kind]}</Pill>
    </a>
  );
}

export function RecipeDetail({ id }: { id: string }) {
  const { data, error, reload } = useApi(`recipe:${id}`, () => api.getRecipe(id));
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data) return <Loading />;
  return <RecipeBody key={data.id + data.updated_at} recipe={data} />;
}

function RecipeBody({ recipe: r }: { recipe: RecipeRow }) {
  const [pieces, setPieces] = useState(String(r.config.pieces));
  const [pieceGrams, setPieceGrams] = useState(String(r.config.pieceGrams));
  const [confirm, setConfirm] = useState(false);
  const action = useAction();
  const n = Math.max(1, Math.round(Number(pieces) || r.config.pieces));
  const g = Math.max(20, Math.round(Number(pieceGrams) || r.config.pieceGrams));
  const scaled = scaleFormula(r.config.formula, n, g);
  const f = r.config.formula;

  return (
    <div>
      <PageTitle sub={`${KIND_LABELS[r.kind]} · ${f.hydrationPct}% hydration · ${f.levainPct}% levain · ${f.saltPct}% salt`}>
        {r.name}
      </PageTitle>

      <div className="mb-7 flex flex-wrap gap-2">
        <a href={href({ name: "plan", recipeId: r.id })} className="btn-primary flex-1">
          Plan a bake
        </a>
        {r.builtin ? (
          <a href={href({ name: "recipe-edit", mode: "copy", id: r.id })} className="btn flex-1">
            Copy and edit
          </a>
        ) : (
          <a href={href({ name: "recipe-edit", mode: "edit", id: r.id })} className="btn flex-1">
            Edit
          </a>
        )}
      </div>

      <Section title="Formula">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pieces">
            <input id="recipe-pieces" type="number" inputMode="numeric" className="input" value={pieces} onChange={(e) => setPieces(e.target.value)} />
          </Field>
          <Field label="Each, g">
            <input id="recipe-grams" type="number" inputMode="numeric" className="input" value={pieceGrams} onChange={(e) => setPieceGrams(e.target.value)} />
          </Field>
        </div>
        <Formula scaled={scaled} />
      </Section>

      <Section title="Steps">
        <ol className="card divide-y divide-line">
          {r.config.steps.map((s, i) => (
            <li key={s.id} className="flex gap-3 px-4 py-3">
              <span className="num w-5 shrink-0 text-muted">{i + 1}</span>
              <div className="min-w-0">
                <div className="font-bold">{s.label}</div>
                <div className="text-sm text-muted">
                  {s.kind === "levain"
                    ? "Timed from your starter"
                    : s.flex
                      ? `${duration(s.flex.min)} to ${duration(s.flex.max)}`
                      : duration(s.minutes)}
                  {s.temp && s.kind !== "levain" && " at 76°F; longer when cooler"}
                  {s.folds && ` · ${s.folds.count} sets of folds, every ${s.folds.every} min`}
                </div>
                {s.note && <p className="mt-1 text-sm">{s.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {r.config.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-line">{r.config.notes}</p>
        </Section>
      )}

      {!r.builtin && (
        <Section title="Remove">
          {action.error && <ErrorNote error={action.error} />}
          {confirm ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-danger"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await api.deleteRecipe(r.id);
                    go({ name: "recipes" });
                  })
                }
              >
                Delete {r.name}
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                Keep it
              </button>
            </div>
          ) : (
            <button type="button" className="btn-danger self-start" onClick={() => setConfirm(true)}>
              Delete recipe
            </button>
          )}
          <p className="text-sm text-muted">Bakes already planned from it keep their plan.</p>
        </Section>
      )}
    </div>
  );
}
