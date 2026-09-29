import { useEffect, useState } from "react";
import { type ExerciseRow, api, fieldErrors } from "../api";
import { CATEGORY_LABELS } from "../describe";
import { href } from "../router";
import { useApi } from "../useApi";

interface Item {
  /** Stable React key while items move about. */
  key: number;
  exerciseId: string;
  minutes: number;
}

const MINUTES = { min: 1, max: 60 } as const;
let nextKey = 1;

/**
 * Builds or edits a routine: a name and an ordered list of exercises, each
 * with a time. Items move up and down with buttons rather than by dragging,
 * which works one-handed on a phone and with a keyboard.
 */
export function RoutineEditor({ id }: { id?: string }) {
  const exercises = useApi("exercises", api.listExercises);
  const routine = useApi(`routine:${id ?? "new"}`, () => (id ? api.getRoutine(id) : Promise.resolve(null)));
  const [name, setName] = useState("");
  const [items, setItems] = useState<Item[] | null>(id ? null : []);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ form: string[]; fields: Record<string, string[]> } | null>(null);

  // Fill the form once the routine arrives.
  useEffect(() => {
    if (!routine.data) return;
    setName(routine.data.name);
    setItems(routine.data.items.map((i) => ({ key: nextKey++, exerciseId: i.exercise_id, minutes: i.minutes })));
  }, [routine.data]);

  if (id && routine.error) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-miss">That routine doesn't exist, or isn't yours.</p>
        <a href={href({ name: "home" })} className="btn focus-ring self-start">
          Back
        </a>
      </div>
    );
  }
  if (!exercises.data || items === null) return <p className="text-sm text-muted">Loading…</p>;

  const all = exercises.data;
  const total = items.reduce((n, i) => n + i.minutes, 0);
  const update = (key: number, patch: Partial<Item>) =>
    setItems((xs) => xs!.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (from: number, to: number) =>
    setItems((xs) => {
      const next = [...xs!];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  const add = () => setItems((xs) => [...xs!, { key: nextKey++, exerciseId: all[0].id, minutes: 5 }]);

  const save = async () => {
    setBusy(true);
    setErrors(null);
    const body = { name, items: items.map((i) => ({ exerciseId: i.exerciseId, minutes: i.minutes })) };
    try {
      if (id) await api.updateRoutine(id, body);
      else await api.createRoutine(body);
      window.location.hash = href({ name: "home" });
    } catch (e) {
      setErrors(fieldErrors(e) ?? { form: [e instanceof Error ? e.message : "Couldn't save."], fields: {} });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id || !window.confirm(`Delete “${name}”?`)) return;
    setBusy(true);
    try {
      await api.deleteRoutine(id);
      window.location.hash = href({ name: "home" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <a href={href({ name: "home" })} className="focus-ring self-start rounded text-sm text-muted">
        ← Practice
      </a>
      <h1 className="font-display text-2xl font-bold">{id ? "Edit routine" : "New routine"}</h1>

      <label className="flex flex-col gap-1.5">
        <span className="label-caps">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Morning warm-up"
          className="focus-ring min-h-[44px] rounded-xl border border-line bg-surface px-3 text-[15px]"
          aria-invalid={!!errors?.fields.name}
        />
        {errors?.fields.name && <span className="text-[13px] text-miss">Give it a name (up to 80 characters).</span>}
      </label>

      <section className="flex flex-col gap-2" aria-labelledby="items-h">
        <div className="flex items-baseline justify-between">
          <h2 id="items-h" className="label-caps">
            Exercises, in order
          </h2>
          <span className="font-mono text-[13px] text-muted">{total} min</span>
        </div>
        {items.length === 0 && <p className="text-sm text-muted">Nothing yet. Add the first exercise.</p>}
        <ol className="flex flex-col gap-2">
          {items.map((it, i) => (
            <li key={it.key} className="card flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-xs text-brass">
                  {i + 1}
                </span>
                <ExerciseSelect all={all} value={it.exerciseId} onChange={(exerciseId) => update(it.key, { exerciseId })} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Stepper
                  label={`Minutes for item ${i + 1}`}
                  value={it.minutes}
                  onChange={(minutes) => update(it.key, { minutes })}
                />
                <span className="text-[13px] text-muted">min</span>
                <span className="ml-auto flex gap-1">
                  <button type="button" className="btn w-11 px-0" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move item ${i + 1} up`}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn w-11 px-0"
                    disabled={i === items.length - 1}
                    onClick={() => move(i, i + 1)}
                    aria-label={`Move item ${i + 1} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn w-11 px-0 text-miss"
                    onClick={() => setItems((xs) => xs!.filter((x) => x.key !== it.key))}
                    aria-label={`Remove item ${i + 1}`}
                  >
                    ✕
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" onClick={add} className="btn self-start" disabled={items.length >= 20}>
          Add exercise
        </button>
        {errors?.fields.items && <p className="text-[13px] text-miss">Add at least one exercise (up to 20), each 1–60 minutes.</p>}
      </section>

      {errors?.form.map((m) => (
        <p key={m} className="text-[13px] text-miss">
          {m === "exercise not found" ? "One of these exercises no longer exists. Pick another." : m}
        </p>
      ))}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} disabled={busy} className="btn-primary">
          Save routine
        </button>
        {id && (
          <a href={href({ name: "session", source: id })} className="btn focus-ring">
            Start
          </a>
        )}
        {id && (
          <button type="button" onClick={() => void remove()} disabled={busy} className="btn ml-auto text-miss">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function ExerciseSelect({ all, value, onChange }: { all: ExerciseRow[]; value: string; onChange: (id: string) => void }) {
  const known = all.some((e) => e.id === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Exercise"
      className="focus-ring min-h-[44px] w-full min-w-0 flex-1 rounded-xl border border-line bg-raised px-2 text-[15px]"
    >
      {!known && <option value={value}>Deleted exercise</option>}
      {(["notes", "scales", "arpeggios", "ear"] as const).map((c) => (
        <optgroup key={c} label={CATEGORY_LABELS[c]}>
          {all
            .filter((e) => e.category === c)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.min(MINUTES.max, Math.max(MINUTES.min, v)));
  return (
    <span className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className="btn w-11 px-0" onClick={() => set(value - 1)} aria-label="One minute less">
        −
      </button>
      <output className="min-w-[2.5rem] text-center font-mono text-lg">{value}</output>
      <button type="button" className="btn w-11 px-0" onClick={() => set(value + 1)} aria-label="One minute more">
        +
      </button>
    </span>
  );
}
