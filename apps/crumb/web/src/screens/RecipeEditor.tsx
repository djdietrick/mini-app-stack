import { useState } from "react";
import { STEP_KINDS, type RecipeStep, type StepKind } from "../../../src/fermentation/index.js";
import { type RecipeConfig, type RecipeKind, type RecipeRow, api } from "../api";
import { ErrorNote, Field, Loading, PageTitle, Section, useAction } from "../components/ui";
import { go } from "../router";
import { useApi } from "../useApi";
import { TIPS } from "../help";
import { KIND_LABELS } from "./Recipes";

const BLANK: RecipeConfig = {
  formula: {
    flours: [{ name: "Bread flour", pct: 100 }],
    hydrationPct: 72,
    levainPct: 20,
    levainHydrationPct: 100,
    saltPct: 2,
    extras: [],
  },
  pieces: 1,
  pieceGrams: 900,
  notes: "",
  steps: [
    { id: "levain", kind: "levain", label: "Build the levain", minutes: 360, temp: true, flex: null, folds: null, note: null },
    { id: "mix", kind: "mix", label: "Mix", minutes: 20, temp: false, flex: null, folds: null, note: null },
    { id: "bulk", kind: "bulk", label: "Bulk ferment", minutes: 300, temp: true, flex: null, folds: { count: 4, every: 30 }, note: null },
    { id: "shape", kind: "shape", label: "Shape", minutes: 15, temp: false, flex: null, folds: null, note: null },
    { id: "bake", kind: "bake", label: "Bake", minutes: 45, temp: false, flex: null, folds: null, note: null },
  ],
};

const STEP_KIND_LABELS: Record<StepKind, string> = {
  starter: "Starter",
  levain: "Levain",
  autolyse: "Autolyse",
  mix: "Mix",
  bulk: "Bulk",
  preshape: "Pre-shape",
  shape: "Shape",
  proof: "Proof",
  retard: "Cold retard",
  temper: "Warm up",
  preheat: "Preheat",
  boil: "Boil",
  bake: "Bake",
  other: "Other",
};

export function RecipeEditor({ mode, id }: { mode: "new" | "copy" | "edit"; id?: string }) {
  const source = useApi(`recipe-editor:${mode}:${id}`, () => (id ? api.getRecipe(id) : Promise.resolve(null)));
  if (source.error) return <ErrorNote error={source.error} retry={source.reload} />;
  if (id && !source.data) return <Loading />;
  return <EditorBody key={`${mode}:${id}`} mode={mode} source={source.data ?? null} />;
}

/** A number input that lets you clear it while typing; reports only valid numbers. */
function NumInput({ id, value, onChange, step }: { id: string; value: number; onChange: (n: number) => void; step?: number }) {
  const [text, setText] = useState(String(value));
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      step={step ?? "any"}
      className="input"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

/** A step id from its label, unique among `taken`. */
function stepId(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "step";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

function EditorBody({ mode, source }: { mode: "new" | "copy" | "edit"; source: RecipeRow | null }) {
  const [name, setName] = useState(source ? (mode === "copy" ? `${source.name} (mine)` : source.name) : "");
  const [kind, setKind] = useState<RecipeKind>(source?.kind ?? "loaf");
  const [config, setConfig] = useState<RecipeConfig>(() => structuredClone(source?.config ?? BLANK));
  const action = useAction();
  const f = config.formula;

  const setFormula = (patch: Partial<RecipeConfig["formula"]>) => setConfig({ ...config, formula: { ...f, ...patch } });
  const setStep = (i: number, patch: Partial<RecipeStep>) =>
    setConfig({ ...config, steps: config.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveStep = (i: number, by: number) => {
    const steps = [...config.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(Math.max(0, Math.min(steps.length, i + by)), 0, s);
    setConfig({ ...config, steps });
  };
  const flourTotal = f.flours.reduce((n, x) => n + x.pct, 0);

  const save = () =>
    action.run(async () => {
      const body = { name, kind, config };
      const saved = mode === "edit" && source ? await api.updateRecipe(source.id, body) : await api.createRecipe(body);
      go({ name: "recipe", id: saved.id });
    });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <PageTitle>{mode === "edit" ? `Edit ${source?.name}` : "New recipe"}</PageTitle>

      <div className="card flex flex-col gap-4 p-4">
        <Field label="Name">
          <input id="recipe-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Kind">
            <select id="recipe-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as RecipeKind)}>
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pieces" help="pieces">
            <NumInput id="recipe-pieces" value={config.pieces} step={1} onChange={(n) => setConfig({ ...config, pieces: Math.round(n) })} />
          </Field>
          <Field label="Each, g">
            <NumInput id="recipe-grams" value={config.pieceGrams} step={1} onChange={(n) => setConfig({ ...config, pieceGrams: Math.round(n) })} />
          </Field>
        </div>
      </div>

      <Section title="Formula, as % of flour" help="formula">
        <div className="card flex flex-col gap-4 p-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Water %" hint="levain's included" help="hydration">
              <NumInput id="recipe-hydration" value={f.hydrationPct} onChange={(n) => setFormula({ hydrationPct: n })} />
            </Field>
            <Field label="Levain %" help="levainPct">
              <NumInput id="recipe-levain" value={f.levainPct} onChange={(n) => setFormula({ levainPct: n })} />
            </Field>
            <Field label="Salt %" help="salt">
              <NumInput id="recipe-salt" value={f.saltPct} onChange={(n) => setFormula({ saltPct: n })} />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold">Flours</span>
              <span className={"num text-sm " + (Math.abs(flourTotal - 100) < 0.01 ? "text-muted" : "text-warn")}>{flourTotal}% of 100</span>
            </div>
            {f.flours.map((fl, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] gap-2">
                <input
                  id={`flour-name-${i}`}
                  aria-label="Flour"
                  className="input"
                  value={fl.name}
                  onChange={(e) => setFormula({ flours: f.flours.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                />
                <NumInput id={`flour-pct-${i}`} value={fl.pct} onChange={(n) => setFormula({ flours: f.flours.map((x, j) => (j === i ? { ...x, pct: n } : x)) })} />
                <RemoveButton disabled={f.flours.length === 1} onClick={() => setFormula({ flours: f.flours.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <button type="button" className="focus-ring self-start rounded text-sm font-bold text-crust" onClick={() => setFormula({ flours: [...f.flours, { name: "Whole wheat flour", pct: 0 }] })}>
              Add a flour
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold">Extras</span>
            {f.extras.map((x, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] gap-2">
                <input
                  id={`extra-name-${i}`}
                  aria-label="Extra"
                  className="input"
                  value={x.name}
                  onChange={(e) => setFormula({ extras: f.extras.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })}
                />
                <NumInput id={`extra-pct-${i}`} value={x.pct} onChange={(n) => setFormula({ extras: f.extras.map((y, j) => (j === i ? { ...y, pct: n } : y)) })} />
                <RemoveButton onClick={() => setFormula({ extras: f.extras.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <button type="button" className="focus-ring self-start rounded text-sm font-bold text-crust" onClick={() => setFormula({ extras: [...f.extras, { name: "Olive oil", pct: 2 }] })}>
              Add an extra
            </button>
          </div>
        </div>
      </Section>

      <Section title="Steps">
        <p className="-mt-1 text-sm text-muted">
          Times are for dough at 76°F. Steps marked “slower when cool” stretch in a cool kitchen; a flexible step can be set anywhere in its range
          when planning. The levain is timed from your starter.
        </p>
        {config.steps.map((s, i) => (
          <div key={s.id} className="card flex flex-col gap-3 p-4">
            <input id={`step-label-${s.id}`} aria-label="Step" className="input font-bold" value={s.label} onChange={(e) => setStep(i, { label: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Kind">
                <select id={`step-kind-${s.id}`} className="input" value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as StepKind })}>
                  {STEP_KINDS.filter((k) => k !== "starter").map((k) => (
                    <option key={k} value={k}>
                      {STEP_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
              {s.kind === "levain" ? (
                <p className="self-end pb-3 text-sm text-muted">Timed from your starter.</p>
              ) : (
                <Field label="Minutes">
                  <NumInput id={`step-min-${s.id}`} value={s.minutes} step={5} onChange={(n) => setStep(i, { minutes: Math.round(n) })} />
                </Field>
              )}
              {s.kind !== "levain" && s.flex && (
                <>
                  <Field label="Shortest, min" help="flexible">
                    <NumInput id={`step-flexmin-${s.id}`} value={s.flex.min} step={30} onChange={(n) => setStep(i, { flex: { ...s.flex!, min: Math.round(n) } })} />
                  </Field>
                  <Field label="Longest, min">
                    <NumInput id={`step-flexmax-${s.id}`} value={s.flex.max} step={30} onChange={(n) => setStep(i, { flex: { ...s.flex!, max: Math.round(n) } })} />
                  </Field>
                </>
              )}
              {s.kind !== "levain" && s.folds && (
                <>
                  <Field label="Folds" help="folds">
                    <NumInput id={`step-folds-${s.id}`} value={s.folds.count} step={1} onChange={(n) => setStep(i, { folds: { ...s.folds!, count: Math.round(n) } })} />
                  </Field>
                  <Field label="Every, min">
                    <NumInput id={`step-every-${s.id}`} value={s.folds.every} step={5} onChange={(n) => setStep(i, { folds: { ...s.folds!, every: Math.round(n) } })} />
                  </Field>
                </>
              )}
            </div>
            {s.kind !== "levain" && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <Check id={`step-temp-${s.id}`} label="Slower when cool" checked={s.temp} onChange={(temp) => setStep(i, { temp, flex: temp ? null : s.flex })} />
                <Check
                  id={`step-flex-${s.id}`}
                  label="Flexible length"
                  checked={s.flex !== null}
                  onChange={(on) => setStep(i, { flex: on ? { min: Math.round(s.minutes * 0.75), max: Math.round(s.minutes * 1.5) } : null, temp: on ? false : s.temp, folds: on ? null : s.folds })}
                />
                <Check
                  id={`step-hasfolds-${s.id}`}
                  label="Folds"
                  checked={s.folds !== null}
                  onChange={(on) => setStep(i, { folds: on ? { count: 3, every: 30 } : null, flex: on ? null : s.flex })}
                />
              </div>
            )}
            {i === config.steps.findIndex((x) => x.kind !== "levain") && <StepOptionsHelp />}
            <input
              id={`step-note-${s.id}`}
              aria-label="Note"
              className="input text-sm"
              placeholder="Note (optional)"
              value={s.note ?? ""}
              onChange={(e) => setStep(i, { note: e.target.value || null })}
            />
            <div className="flex gap-2">
              <button type="button" className="btn flex-1 px-2" disabled={i === 0} onClick={() => moveStep(i, -1)} aria-label="Move up">
                ↑
              </button>
              <button type="button" className="btn flex-1 px-2" disabled={i === config.steps.length - 1} onClick={() => moveStep(i, 1)} aria-label="Move down">
                ↓
              </button>
              <button
                type="button"
                className="btn-danger flex-1 px-2"
                disabled={config.steps.length === 1}
                onClick={() => setConfig({ ...config, steps: config.steps.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          onClick={() => {
            const taken = new Set(config.steps.map((s) => s.id));
            const step: RecipeStep = { id: stepId("step", taken), kind: "other", label: "New step", minutes: 30, temp: false, flex: null, folds: null, note: null };
            setConfig({ ...config, steps: [...config.steps, step] });
          }}
        >
          Add a step
        </button>
      </Section>

      <Section title="Notes">
        <textarea
          id="recipe-notes"
          className="input min-h-[96px] py-2"
          placeholder="Pan size, oven temperatures, toppings"
          value={config.notes}
          onChange={(e) => setConfig({ ...config, notes: e.target.value })}
        />
      </Section>

      {action.error && <ErrorNote error={action.error} />}
      <button type="submit" className="btn-primary" disabled={action.busy || !name.trim()}>
        {mode === "edit" ? "Save" : "Save recipe"}
      </button>
    </form>
  );
}

/** What the three step options mean; shown once, under the first step that has them. */
function StepOptionsHelp() {
  return (
    <details className="group text-sm">
      <summary className="focus-ring cursor-pointer list-none rounded font-bold text-crust">What do these options mean?</summary>
      <dl className="mt-2 flex flex-col gap-2 rounded-xl bg-crust-soft px-3 py-2.5 leading-relaxed">
        {(
          [
            ["Slower when cool", TIPS.slowerWhenCool.text],
            ["Flexible length", TIPS.flexible.text],
            ["Folds", TIPS.folds.text],
          ] as const
        ).map(([term, text]) => (
          <div key={term}>
            <dt className="font-bold">{term}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[36px] items-center gap-2">
      <input id={id} type="checkbox" className="h-4 w-4 accent-[rgb(var(--crust))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function RemoveButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Remove"
      disabled={disabled}
      onClick={onClick}
      className="focus-ring flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:text-warn disabled:opacity-30"
    >
      ×
    </button>
  );
}
