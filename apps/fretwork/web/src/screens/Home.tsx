import { useState } from "react";
import { api, type ExerciseRow, type RoutineRow } from "../api";
import { href } from "../router";
import { useApi } from "../useApi";

/**
 * Today's practice: the suggested session (GET /sessions/suggested, from
 * progress and the fretboard map; the rule is src/domain/suggest.ts), the
 * player's own routines, and recent runs. "Save as routine" copies the
 * suggestion into a routine the player can then edit.
 */
export function Home() {
  const exercises = useApi("exercises", api.listExercises);
  const suggestion = useApi("session:suggested", api.suggestedSession);
  const routines = useApi("routines", api.listRoutines);
  const runs = useApi("runs:recent", () => api.listRuns({ limit: 5 }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const byId = new Map((exercises.data ?? []).map((e) => [e.id, e]));
  const items = suggestion.data?.items ?? [];

  const saveAsRoutine = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      const day = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const r = await api.createRoutine({
        name: `Session from ${day}`,
        items: items.map((i) => ({ exerciseId: i.exercise_id, minutes: i.minutes })),
      });
      window.location.hash = href({ name: "routine", id: r.id });
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4 p-5" aria-labelledby="suggested-h">
        <div className="flex items-baseline justify-between">
          <h1 id="suggested-h" className="font-display text-xl font-bold">
            Suggested session
          </h1>
          {suggestion.data && <span className="font-mono text-[13px] text-muted">{suggestion.data.minutes} min</span>}
        </div>
        {suggestion.loading && !suggestion.data && <p className="text-sm text-muted">Loading…</p>}
        {suggestion.error && <p className="text-sm text-miss">Couldn't load today's suggestion.</p>}
        <ol className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li key={item.exercise_id}>
              <a
                href={href({ name: "exercise", id: item.exercise_id })}
                className="focus-ring flex min-h-[52px] items-center gap-3 rounded-xl"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-xs text-brass">
                  {i + 1}
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-[15px]">{byId.get(item.exercise_id)?.name ?? "…"}</span>
                  <span className="text-[13px] text-muted">{item.reason}</span>
                </span>
                <span className="shrink-0 text-[13px] text-muted">{item.minutes} min</span>
              </a>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {items.length > 0 && (
            <a href={href({ name: "session", source: "suggested" })} className="btn-primary focus-ring">
              Start session
            </a>
          )}
          {items.length > 0 && (
            <button type="button" onClick={() => void saveAsRoutine()} disabled={saving} className="btn">
              Save as routine
            </button>
          )}
          <a href={href({ name: "tune" })} className="btn focus-ring">
            Tune up first
          </a>
        </div>
        {saveError && <p className="text-[13px] text-miss">Couldn't save it as a routine. Try again.</p>}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="routines-h">
        <div className="flex items-center justify-between">
          <h2 id="routines-h" className="font-display text-lg font-bold">
            Your routines
          </h2>
          <a href={href({ name: "routine" })} className="btn focus-ring">
            New routine
          </a>
        </div>
        {routines.error && <p className="text-sm text-miss">Couldn't load your routines.</p>}
        {routines.data && routines.data.length === 0 && (
          <p className="text-sm text-muted">
            A routine is your own list of exercises, each with a time. Build one, or save today's suggestion as a
            starting point.
          </p>
        )}
        <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2">
          {(routines.data ?? []).map((r) => (
            <RoutineCard key={r.id} routine={r} byId={byId} />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold">Recent runs</h2>
        {runs.data && runs.data.length === 0 && (
          <p className="text-sm text-muted">No runs yet. Pick an exercise from the library to start.</p>
        )}
        <ul className="flex flex-col">
          {(runs.data ?? []).map((r) => (
            <li key={r.id} className="flex min-h-[52px] items-center gap-3 border-b border-raised">
              <span className="flex-1 text-[15px]">{byId.get(r.exercise_id)?.name ?? "Deleted exercise"}</span>
              <span className="font-mono text-[13px] text-muted">
                {r.notes_clean}/{r.notes_total}
                {r.tempo ? ` · ${r.tempo} bpm` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RoutineCard({ routine, byId }: { routine: RoutineRow; byId: Map<string, ExerciseRow> }) {
  const minutes = routine.items.reduce((n, i) => n + i.minutes, 0);
  const names = routine.items.map((i) => byId.get(i.exercise_id)?.name ?? "Deleted exercise");
  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold">{routine.name}</span>
        <span className="shrink-0 font-mono text-[13px] text-muted">{minutes} min</span>
      </div>
      <p className="text-[13px] text-muted">{names.join(" · ")}</p>
      <div className="flex gap-2">
        <a href={href({ name: "session", source: routine.id })} className="btn-primary focus-ring">
          Start
        </a>
        <a href={href({ name: "routine", id: routine.id })} className="btn focus-ring">
          Edit
        </a>
      </div>
    </li>
  );
}
