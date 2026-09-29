import { useRef, useState } from "react";
import { api, type ExerciseRow, type RunRow } from "../api";
import { formatDuration, useNow } from "../practice/common";
import { href } from "../router";
import { useApi } from "../useApi";
import { useWakeLock } from "../wakeLock";
import { Practice } from "./Practice";

interface Step {
  exercise: ExerciseRow;
  minutes: number;
  reason?: string;
}

interface Spent {
  ms: number;
  skipped: boolean;
}

/**
 * Runs a session: the suggested one, or a routine. Each item opens its
 * exercise's own practice screen with a timer above it; Next moves on, Skip
 * moves on and marks it skipped. The screens post their own runs as usual,
 * so the summary reads the runs recorded since the session started.
 *
 * The items are fixed when the session loads. The suggestion changes as runs
 * are recorded, and this screen stays mounted for the whole session, so it
 * never reloads them mid-way.
 */
export function Session({ source }: { source: string }) {
  const plan = useApi(`session:${source}`, async () => {
    const [exercises, items, name] =
      source === "suggested"
        ? await Promise.all([api.listExercises(), api.suggestedSession().then((s) => s.items), "Suggested session"])
        : await Promise.all([api.listExercises(), api.getRoutine(source)]).then(
            ([ex, r]) => [ex, r.items.map((i) => ({ ...i, reason: undefined })), r.name] as const,
          );
    const byId = new Map(exercises.map((e) => [e.id, e]));
    const steps: Step[] = items.flatMap((i) => {
      const exercise = byId.get(i.exercise_id);
      return exercise ? [{ exercise, minutes: i.minutes, reason: i.reason }] : [];
    });
    return { name, steps, missing: items.length - steps.length };
  });

  if (plan.loading && !plan.data) return <p className="text-sm text-muted">Loading…</p>;
  if (plan.error || !plan.data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-miss">That session couldn't be loaded. The routine may have been deleted.</p>
        <a href={href({ name: "home" })} className="btn focus-ring self-start">
          Back
        </a>
      </div>
    );
  }
  if (plan.data.steps.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted">Nothing to practice: every exercise in this routine has been deleted.</p>
        <a href={href({ name: "home" })} className="btn focus-ring self-start">
          Back
        </a>
      </div>
    );
  }
  return <Runner name={plan.data.name} steps={plan.data.steps} missing={plan.data.missing} suggested={source === "suggested"} />;
}

function Runner({ name, steps, missing, suggested }: { name: string; steps: Step[]; missing: number; suggested: boolean }) {
  const [index, setIndex] = useState(0);
  const [spent, setSpent] = useState<Spent[]>([]);
  const [itemStart, setItemStart] = useState(() => performance.now());
  const sessionStart = useRef(new Date().toISOString());
  const done = index >= steps.length;
  const now = useNow(!done, 1000);
  // Held across items, so moving on doesn't let the screen dim for a moment.
  useWakeLock(!done);

  const advance = (skipped: boolean) => {
    setSpent((s) => [...s, { ms: performance.now() - itemStart, skipped }]);
    setItemStart(performance.now());
    setIndex((i) => i + 1);
    window.scrollTo(0, 0);
  };

  if (done) return <Summary name={name} steps={steps} spent={spent} since={sessionStart.current} suggested={suggested} />;

  const step = steps[index];
  const leftMs = step.minutes * 60_000 - (now - itemStart);
  const over = leftMs <= 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3 p-4" aria-label="Session">
        <div className="flex items-baseline justify-between gap-3">
          <span className="label-caps truncate">
            {name} · {index + 1} of {steps.length}
          </span>
          <span
            className={"shrink-0 font-mono text-2xl " + (over ? "text-correct" : leftMs < 30_000 ? "text-brass" : "text-ink")}
            role="timer"
            aria-live="off"
          >
            {over ? "Time" : clock(leftMs)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
          <div
            className="h-full bg-brass transition-[width] duration-1000 ease-linear"
            style={{ width: `${Math.min(100, (100 * (now - itemStart)) / (step.minutes * 60_000))}%` }}
          />
        </div>
        {step.reason && <p className="text-[13px] text-muted">{step.reason}</p>}
        {over && (
          <p className="text-[15px] text-correct" aria-live="polite">
            Time's up. Finish the run you're on, then move on.
          </p>
        )}
        {index === 0 && missing > 0 && (
          <p className="text-[13px] text-faint">
            {missing === 1 ? "One item was skipped:" : `${missing} items were skipped:`} its exercise has been deleted.
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => advance(false)} className={over ? "btn-primary" : "btn"}>
            {index + 1 === steps.length ? "Finish" : "Next"}
          </button>
          <button type="button" onClick={() => advance(true)} className="btn">
            Skip
          </button>
        </div>
      </section>

      <Practice key={index} id={step.exercise.id} />
    </div>
  );
}

function Summary({ name, steps, spent, since, suggested }: { name: string; steps: Step[]; spent: Spent[]; since: string; suggested: boolean }) {
  const runs = useApi(`session-runs:${since}`, () => api.listRuns({ limit: 200 }));
  const [saved, setSaved] = useState<string | null>(null);
  const recent = (runs.data ?? []).filter((r) => r.started_at >= since);
  const total = spent.reduce((n, s) => n + s.ms, 0);

  const save = async () => {
    const r = await api.createRoutine({
      name: `Session from ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      items: steps.map((s) => ({ exerciseId: s.exercise.id, minutes: s.minutes })),
    });
    setSaved(r.id);
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <span className="label-caps text-brass">{name}</span>
        <h1 className="font-display text-3xl font-bold">Session done</h1>
        <p className="font-mono text-[15px] text-muted">
          {formatDuration(total)} · {recent.length} {recent.length === 1 ? "run" : "runs"}
        </p>
      </header>

      <ol className="flex flex-col">
        {steps.map((s, i) => {
          const mine = recent.filter((r) => r.exercise_id === s.exercise.id);
          return (
            <li key={i} className="flex min-h-[56px] items-center gap-3 border-b border-raised py-2">
              <span className="flex flex-1 flex-col">
                <span className="text-[15px]">{s.exercise.name}</span>
                <span className="text-[13px] text-muted">{runsLine(mine)}</span>
              </span>
              <span className="shrink-0 font-mono text-[13px] text-muted">
                {spent[i]?.skipped ? "skipped" : formatDuration(spent[i]?.ms ?? 0)}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap gap-2">
        <a href={href({ name: "home" })} className="btn-primary focus-ring">
          Done
        </a>
        <a href={href({ name: "progress" })} className="btn focus-ring">
          Progress
        </a>
        {suggested && !saved && (
          <button type="button" onClick={() => void save()} className="btn">
            Save as routine
          </button>
        )}
        {saved && (
          <a href={href({ name: "routine", id: saved })} className="btn focus-ring">
            Edit the new routine
          </a>
        )}
      </div>
    </div>
  );
}

function runsLine(runs: RunRow[]): string {
  if (!runs.length) return "No runs";
  const clean = runs.filter((r) => r.clean).length;
  const top = Math.max(0, ...runs.map((r) => r.tempo ?? 0));
  return `${runs.length} ${runs.length === 1 ? "run" : "runs"}, ${clean} clean${top ? ` · up to ${top} bpm` : ""}`;
}

/** "4:05" */
function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
