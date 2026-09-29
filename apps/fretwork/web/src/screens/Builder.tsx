import { type ReactNode, useEffect, useId, useState } from "react";
import type { FindConfig, RespondConfig, SequenceConfig } from "../../../src/domain/types.js";
import { DEFAULT_DEGREES, DEFAULT_INTERVALS } from "../../../src/practice/respond.js";
import {
  ARPEGGIOS,
  PATTERNS,
  PATTERN_LABELS,
  SCALES,
  SHAPES,
  SHAPE_LABELS,
  STRING_LETTERS,
  degreeLabel,
  intervalName,
  noteName,
} from "../../../src/theory/index.js";
import { type Category, type ExerciseConfig, type ExerciseRow, api, fieldErrors } from "../api";
import {
  BUILD_TYPES,
  type BuildType,
  autoCategory,
  autoName,
  buildTypeOf,
  defaultConfig,
  previewNotes,
} from "../builder";
import { Fretboard } from "../components/Fretboard";
import { CATEGORY_LABELS, PROMPT_LABELS, preview, sourceLabel } from "../describe";
import { href } from "../router";
import { useApi } from "../useApi";

type Errors = { form: string[]; fields: Record<string, string[]> };

/**
 * The Build tab: make a new exercise, edit one of your own, or copy any
 * exercise (a copy is how a built-in, which stays read-only, is customised).
 * The form edits a config directly; the neck, the note chips and the
 * warnings below it follow every change. The server validates on save, and
 * its field errors come back inline.
 */
export function Builder({ mode, id }: { mode?: "edit" | "copy"; id?: string }) {
  const source = useApi(`build:${mode ?? "new"}:${id ?? ""}`, () => (id ? api.getExercise(id) : Promise.resolve(null)));
  if (id && source.loading && !source.data) return <p className="text-sm text-muted">Loading…</p>;
  if (id && (source.error || !source.data)) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-miss">That exercise doesn't exist, or isn't yours.</p>
        <a href={href({ name: "library" })} className="btn focus-ring self-start">
          Back to library
        </a>
      </div>
    );
  }
  if (mode === "edit" && source.data?.builtin) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted">Built-in exercises are read-only. Make a copy to change it.</p>
        <a
          href={href({ name: "build", mode: "copy", id: source.data.id })}
          className="btn-primary focus-ring self-start"
        >
          Copy it
        </a>
      </div>
    );
  }
  return <Form key={`${mode}:${id}`} mode={mode ?? "new"} from={source.data ?? null} />;
}

function Form({ mode, from }: { mode: "new" | "edit" | "copy"; from: ExerciseRow | null }) {
  const [config, setConfig] = useState<ExerciseConfig>(() => from?.config ?? defaultConfig("scale"));
  const [name, setName] = useState(() =>
    from ? (mode === "copy" ? `${from.name} (copy)`.slice(0, 80) : from.name) : "",
  );
  const [nameTouched, setNameTouched] = useState(!!from);
  const [category, setCategory] = useState<Category>(() => from?.category ?? autoCategory(config));
  const [categoryTouched, setCategoryTouched] = useState(!!from);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors | null>(null);

  const type = buildTypeOf(config);
  const shownName = nameTouched ? name : autoName(config);

  useEffect(() => {
    if (!categoryTouched) setCategory(autoCategory(config, category));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, categoryTouched]);

  const pickType = (t: Exclude<BuildType, "sequence">) => {
    if (t !== type) setConfig(defaultConfig(t, config));
  };

  const save = async () => {
    setBusy(true);
    setErrors(null);
    const body = { name: shownName, category, config };
    try {
      const saved = mode === "edit" && from ? await api.updateExercise(from.id, body) : await api.createExercise(body);
      window.location.hash = href({ name: "exercise", id: saved.id });
    } catch (e) {
      setErrors(fieldErrors(e) ?? { form: [e instanceof Error ? e.message : "Couldn't save."], fields: {} });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!from || !window.confirm(`Delete “${from.name}”? Its past runs stay in your history.`)) return;
    setBusy(true);
    try {
      await api.deleteExercise(from.id);
      window.location.hash = href({ name: "library" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className="flex flex-col gap-5">
        {from && (
          <a
            href={href({ name: "exercise", id: from.id })}
            className="focus-ring self-start rounded text-sm text-muted"
          >
            ← {from.name}
          </a>
        )}
        <h1 className="font-display text-2xl font-bold">
          {mode === "edit" ? "Edit exercise" : mode === "copy" ? "Copy exercise" : "Build an exercise"}
        </h1>

        {type === "sequence" ? (
          <p className="card p-4 text-[13px] text-muted">
            This one plays {sourceLabel(config as SequenceConfig)}. That source can't be changed here yet; everything
            else can.
          </p>
        ) : (
          <div role="radiogroup" aria-label="Type" className="grid grid-cols-2 gap-2">
            {BUILD_TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                role="radio"
                aria-checked={type === t.type}
                onClick={() => pickType(t.type)}
                className={
                  "focus-ring flex min-h-[64px] flex-col items-start justify-center rounded-xl border px-3 py-2 text-left " +
                  (type === t.type ? "border-brass bg-raised" : "border-line bg-surface")
                }
              >
                <span className={"text-[15px] font-semibold " + (type === t.type ? "text-brass" : "")}>{t.label}</span>
                <span className="text-[12px] text-muted">{t.hint}</span>
              </button>
            ))}
          </div>
        )}

        {config.engine === "sequence" && <SequenceForm c={config} set={setConfig} />}
        {config.engine === "find" && <FindForm c={config} set={setConfig} />}
        {config.engine === "respond" && <RespondForm c={config} set={setConfig} />}

        {errors?.fields.config && (
          <p className="text-[13px] text-miss">The server rejected these settings: {errors.fields.config.join("; ")}</p>
        )}
      </div>

      <div className="flex flex-col gap-5 lg:sticky lg:top-6">
        <Preview config={config} />

        <Field label="Name" error={errors?.fields.name && "Give it a name, up to 80 characters."}>
          {(fid) => (
            <div className="flex flex-col gap-1">
              <input
                id={fid}
                value={shownName}
                onChange={(e) => {
                  setNameTouched(true);
                  setName(e.target.value);
                }}
                maxLength={80}
                className="focus-ring min-h-[44px] rounded-xl border border-line bg-surface px-3 text-[15px]"
                aria-invalid={!!errors?.fields.name}
              />
              {nameTouched && (
                <button
                  type="button"
                  onClick={() => setNameTouched(false)}
                  className="focus-ring self-start rounded text-[13px] text-muted underline"
                >
                  Use “{autoName(config)}”
                </button>
              )}
            </div>
          )}
        </Field>

        <Field label="Library section" error={errors?.fields.category?.join("; ")}>
          {(fid) => (
            <select
              id={fid}
              value={category}
              onChange={(e) => {
                setCategoryTouched(true);
                setCategory(e.target.value as Category);
              }}
              className="focus-ring min-h-[44px] rounded-xl border border-line bg-raised px-2 text-[15px]"
            >
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          )}
        </Field>

        {errors?.form.map((m) => (
          <p key={m} className="text-[13px] text-miss">
            {m}
          </p>
        ))}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void save()} disabled={busy} className="btn-primary">
            {mode === "edit" ? "Save changes" : "Save exercise"}
          </button>
          {mode === "edit" && (
            <button type="button" onClick={() => void remove()} disabled={busy} className="btn ml-auto text-miss">
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- per-engine forms ----------

function SequenceForm({ c, set }: { c: SequenceConfig; set: (c: SequenceConfig) => void }) {
  const src = c.source;
  const formulas = src.kind === "arpeggio" ? ARPEGGIOS : SCALES;
  return (
    <>
      {(src.kind === "scale" || src.kind === "arpeggio") && (
        <>
          <Field label="Root">
            {(fid) => (
              <NotePicker
                labelledBy={`${fid}-label`}
                value={[src.root]}
                onChange={([root]) => set({ ...c, source: { ...src, root } })}
              />
            )}
          </Field>
          <Field label={src.kind === "scale" ? "Scale" : "Arpeggio"}>
            {(fid) => (
              <Select
                id={fid}
                value={src.formula}
                options={formulas.map((f) => [f.id, f.name])}
                onChange={(formula) => set({ ...c, source: { ...src, formula } })}
              />
            )}
          </Field>
        </>
      )}
      <WindowAndStrings c={c} set={set} />
      <Field label="Pattern">
        {(fid) => (
          <Select
            id={fid}
            value={c.pattern}
            options={PATTERNS.map((p) => [p, PATTERN_LABELS[p]])}
            onChange={(pattern) => set({ ...c, pattern })}
          />
        )}
      </Field>
      <Field label="Shape">
        {(fid) => (
          <Segmented
            labelledBy={`${fid}-label`}
            value={c.shape ?? "lower-fret"}
            options={SHAPES.map((s) => [s, SHAPE_LABELS[s]])}
            onChange={(shape) => set({ ...c, shape: shape === "lower-fret" ? undefined : shape })}
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Start tempo">
          {(fid) => (
            <Stepper
              labelledBy={`${fid}-label`}
              value={c.tempo.start}
              min={30}
              max={240}
              step={2}
              unit="bpm"
              onChange={(start) => set({ ...c, tempo: { ...c.tempo, start } })}
            />
          )}
        </Field>
        <Field label="Speed up by">
          {(fid) => (
            <Stepper
              labelledBy={`${fid}-label`}
              value={c.tempo.step}
              min={0}
              max={20}
              step={1}
              unit={c.tempo.step === 0 ? "off" : "bpm"}
              onChange={(step) => set({ ...c, tempo: { ...c.tempo, step } })}
            />
          )}
        </Field>
        <Field label="After clean runs">
          {(fid) => (
            <Stepper
              labelledBy={`${fid}-label`}
              value={c.tempo.cleanRunsToAdvance}
              min={1}
              max={10}
              step={1}
              onChange={(cleanRunsToAdvance) => set({ ...c, tempo: { ...c.tempo, cleanRunsToAdvance } })}
            />
          )}
        </Field>
      </div>
      <Grading value={c.grading} onChange={(grading) => set({ ...c, grading })} />
    </>
  );
}

function FindForm({ c, set }: { c: FindConfig; set: (c: FindConfig) => void }) {
  return (
    <>
      <Field label="Note to find">
        {(fid) => (
          <div className="flex flex-col gap-2">
            <Segmented
              labelledBy={`${fid}-label`}
              value={c.target.kind}
              options={[
                ["random", "A new one each run"],
                ["pitch-class", "Always the same"],
              ]}
              onChange={(kind) =>
                set({
                  ...c,
                  target:
                    kind === "random" ? { kind } : { kind, pc: c.target.kind === "pitch-class" ? c.target.pc : 0 },
                })
              }
            />
            {c.target.kind === "pitch-class" && (
              <NotePicker
                labelledBy={`${fid}-label`}
                value={[c.target.pc]}
                onChange={([pc]) => set({ ...c, target: { kind: "pitch-class", pc } })}
              />
            )}
          </div>
        )}
      </Field>
      <Field label="Order">
        {(fid) => (
          <Segmented
            labelledBy={`${fid}-label`}
            value={c.order}
            options={[
              ["string-by-string", "String by string"],
              ["any", "Every position, any order"],
            ]}
            onChange={(order) => set({ ...c, order })}
          />
        )}
      </Field>
      <WindowAndStrings c={c} set={set} />
      <Grading value={c.grading} onChange={(grading) => set({ ...c, grading })} />
      <TimeLimit value={c.timeLimitSec} per="run" onChange={(timeLimitSec) => set({ ...c, timeLimitSec })} />
    </>
  );
}

const INTERVAL_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function RespondForm({ c, set }: { c: RespondConfig; set: (c: RespondConfig) => void }) {
  const usesIntervals = c.prompt === "interval" || c.prompt === "target-degree";
  return (
    <>
      <Field label="Prompt">
        {(fid) => (
          <Select
            id={fid}
            value={c.prompt}
            options={(Object.keys(PROMPT_LABELS) as RespondConfig["prompt"][]).map((p) => [p, PROMPT_LABELS[p]])}
            // Intervals mean different things per prompt, so they reset to that prompt's default.
            onChange={(prompt) => set({ ...c, prompt, intervals: undefined })}
          />
        )}
      </Field>
      <Field label={c.prompt === "target-degree" ? "Drone roots" : c.prompt === "interval" ? "Roots" : "Notes to ask"}>
        {(fid) => (
          <div className="flex flex-col gap-2">
            <NotePicker
              labelledBy={`${fid}-label`}
              multiple
              value={c.pitchClasses}
              onChange={(pitchClasses) => pitchClasses.length && set({ ...c, pitchClasses })}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn min-h-[36px] text-[13px]"
                onClick={() => set({ ...c, pitchClasses: [0, 2, 4, 5, 7, 9, 11] })}
              >
                Naturals
              </button>
              <button
                type="button"
                className="btn min-h-[36px] text-[13px]"
                onClick={() => set({ ...c, pitchClasses: [...Array(12).keys()] })}
              >
                All 12
              </button>
            </div>
          </div>
        )}
      </Field>
      {usesIntervals && (
        <Field label={c.prompt === "target-degree" ? "Degrees to land on" : "Intervals"}>
          {(fid) => (
            <Toggles
              labelledBy={`${fid}-label`}
              values={INTERVAL_CHOICES}
              selected={c.intervals ?? [...(c.prompt === "target-degree" ? DEFAULT_DEGREES : DEFAULT_INTERVALS)]}
              label={(i) => (c.prompt === "target-degree" ? degreeLabel(i) : i === 12 ? "8ve" : degreeLabel(i))}
              title={(i) => intervalName(i)}
              onPress={(i) => {
                const intervals = toggled(
                  c.intervals ?? (c.prompt === "target-degree" ? [...DEFAULT_DEGREES] : [...DEFAULT_INTERVALS]),
                  i,
                );
                if (intervals.length) set({ ...c, intervals });
              }}
            />
          )}
        </Field>
      )}
      <WindowAndStrings c={c} set={set} />
      <Field label="Cards">
        {(fid) => (
          <Stepper
            labelledBy={`${fid}-label`}
            value={c.cards}
            min={1}
            max={100}
            step={1}
            onChange={(cards) => set({ ...c, cards })}
          />
        )}
      </Field>
      <TimeLimit value={c.timeLimitSec} per="card" onChange={(timeLimitSec) => set({ ...c, timeLimitSec })} />
    </>
  );
}

// ---------- shared controls ----------

function WindowAndStrings<C extends ExerciseConfig>({ c, set }: { c: C; set: (c: C) => void }) {
  const toggle = (s: number) => {
    const next = c.strings.includes(s) ? c.strings.filter((x) => x !== s) : [...c.strings, s].sort((a, b) => a - b);
    if (next.length) set({ ...c, strings: next });
  };
  return (
    <>
      <FretRange lo={c.frets.lo} hi={c.frets.hi} onChange={(frets) => set({ ...c, frets })} />
      <Field label="Strings">
        {(fid) => (
          <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Strings">
            {[6, 5, 4, 3, 2, 1].map((s) => {
              const on = c.strings.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  aria-label={`String ${s}, ${STRING_LETTERS[s - 1]}`}
                  onClick={() => toggle(s)}
                  className={
                    "focus-ring min-h-[44px] rounded-lg border font-mono text-[15px] " +
                    (on ? "border-brass bg-brass text-brass-ink" : "border-line bg-surface text-muted")
                  }
                >
                  {STRING_LETTERS[s - 1]}
                </button>
              );
            })}
          </div>
        )}
      </Field>
    </>
  );
}

const MAX_FRET = 24;

function FretRange({
  lo,
  hi,
  onChange,
}: {
  lo: number;
  hi: number;
  onChange: (w: { lo: number; hi: number }) => void;
}) {
  return (
    <Field label={`Fret window · ${lo === hi ? `fret ${lo}` : `frets ${lo}–${hi}`}`}>
      {(fid) => (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-3 text-[13px] text-muted">
            <span className="w-10 shrink-0">From</span>
            <input
              type="range"
              min={0}
              max={MAX_FRET}
              value={lo}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({ lo: v, hi: Math.max(v, hi) });
              }}
              className="h-11 w-full accent-[#e5a54b]"
            />
            <span className="w-6 text-right font-mono text-ink">{lo}</span>
          </label>
          <label className="flex items-center gap-3 text-[13px] text-muted">
            <span className="w-10 shrink-0">To</span>
            <input
              type="range"
              min={0}
              max={MAX_FRET}
              value={hi}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({ lo: Math.min(lo, v), hi: v });
              }}
              className="h-11 w-full accent-[#e5a54b]"
            />
            <span className="w-6 text-right font-mono text-ink">{hi}</span>
          </label>
        </div>
      )}
    </Field>
  );
}

function Grading({
  value,
  onChange,
}: {
  value: "exact" | "pitch-class";
  onChange: (v: "exact" | "pitch-class") => void;
}) {
  return (
    <Field label="Grading">
      {(fid) => (
        <Segmented
          labelledBy={`${fid}-label`}
          value={value}
          options={[
            ["exact", "Exact pitch"],
            ["pitch-class", "Any octave"],
          ]}
          onChange={onChange}
        />
      )}
    </Field>
  );
}

function TimeLimit({
  value,
  per,
  onChange,
}: {
  value: number | null;
  per: "run" | "card";
  onChange: (v: number | null) => void;
}) {
  return (
    <Field label={`Time limit per ${per}`}>
      {(fid) => (
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            labelledBy={`${fid}-label`}
            value={value === null ? "off" : "on"}
            options={[
              ["off", "None"],
              ["on", "Limit"],
            ]}
            onChange={(v) => onChange(v === "off" ? null : per === "run" ? 60 : 10)}
          />
          {value !== null && (
            <Stepper
              labelledBy={`${fid}-label`}
              value={value}
              min={5}
              max={600}
              step={5}
              unit="s"
              onChange={onChange}
            />
          )}
        </div>
      )}
    </Field>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | false;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label id={`${id}-label`} htmlFor={id} className="label-caps">
        {label}
      </label>
      {children(id)}
      {error && <span className="text-[13px] text-miss">{error}</span>}
    </div>
  );
}

function Select<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="focus-ring min-h-[44px] rounded-xl border border-line bg-raised px-2 text-[15px]"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function Segmented<T extends string>({
  value,
  options,
  labelledBy,
  onChange,
}: {
  value: T;
  options: [T, string][];
  labelledBy?: string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 self-start rounded-xl bg-raised p-1" role="group" aria-labelledby={labelledBy}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={
            "focus-ring min-h-[40px] rounded-lg px-3 text-[13px] " +
            (value === v ? "bg-brass font-semibold text-brass-ink" : "text-muted")
          }
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Twelve note chips: one selected, or with `multiple`, any number of them. */
function NotePicker({
  value,
  multiple,
  labelledBy,
  onChange,
}: {
  value: number[];
  multiple?: boolean;
  labelledBy?: string;
  onChange: (v: number[]) => void;
}) {
  return (
    <Toggles
      values={[...Array(12).keys()]}
      selected={value}
      label={(pc) => noteName(pc)}
      labelledBy={labelledBy}
      onPress={(pc) => onChange(multiple ? toggled(value, pc) : [pc])}
    />
  );
}

function toggled(list: number[], v: number): number[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => a - b);
}

function Toggles({
  values,
  selected,
  label,
  title,
  labelledBy,
  onPress,
}: {
  values: number[];
  selected: number[];
  label: (v: number) => string;
  title?: (v: number) => string;
  labelledBy?: string;
  onPress: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-1.5" role="group" aria-labelledby={labelledBy}>
      {values.map((v) => {
        const on = selected.includes(v);
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            title={title?.(v)}
            aria-label={title?.(v)}
            onClick={() => onPress(v)}
            className={
              "focus-ring min-h-[44px] rounded-lg border font-display text-[15px] font-bold " +
              (on ? "border-brass bg-brass text-brass-ink" : "border-line bg-surface text-ink")
            }
          >
            {label(v)}
          </button>
        );
      })}
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  step,
  unit,
  labelledBy,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  labelledBy?: string;
  onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <span className="flex items-center gap-1" role="group" aria-labelledby={labelledBy}>
      <button
        type="button"
        className="btn w-11 px-0"
        onClick={() => set(value - step)}
        disabled={value <= min}
        aria-label={`Less, by ${step}`}
      >
        −
      </button>
      <output className="min-w-[3rem] text-center font-mono text-lg">
        {value}
        {unit && <span className="text-[12px] text-muted"> {unit}</span>}
      </output>
      <button
        type="button"
        className="btn w-11 px-0"
        onClick={() => set(value + step)}
        disabled={value >= max}
        aria-label={`More, by ${step}`}
      >
        +
      </button>
    </span>
  );
}

// ---------- the preview ----------

function Preview({ config }: { config: ExerciseConfig }) {
  const p = preview({ config });
  const notes = previewNotes(config);
  return (
    <section className="card flex flex-col gap-3 p-4" aria-labelledby="preview-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="preview-h" className="label-caps">
          Preview
        </h2>
        <span className="text-right text-[13px] text-muted">{p.caption}</span>
      </div>
      <Fretboard frets={p.view} highlight={p.window} dots={p.dots} title="Preview of the exercise on the fretboard" />
      {p.sequence.length > 0 && (
        <ol className="flex flex-wrap gap-1" aria-label={`${p.sequence.length} notes in order`}>
          {p.sequence.map((n, i) => (
            <li
              key={i}
              className={
                "flex h-9 w-9 flex-col items-center justify-center rounded-md border " +
                (n.root ? "border-brass bg-brass text-brass-ink" : "border-line bg-surface")
              }
            >
              <span className="font-display text-[12px] font-bold leading-none">{n.name}</span>
              <span className="font-mono text-[8px] leading-none">{n.degree}</span>
            </li>
          ))}
        </ol>
      )}
      <div aria-live="polite" className="flex flex-col gap-2">
        {notes.map((n) => (
          <p key={n.text} className={"text-[13px] " + (n.tone === "warn" ? "text-miss" : "text-muted")}>
            {n.tone === "warn" ? "⚠ " : ""}
            {n.text}
          </p>
        ))}
      </div>
    </section>
  );
}
