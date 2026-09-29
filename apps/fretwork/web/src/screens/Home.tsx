import { api, type ExerciseRow } from "../api";
import { href } from "../router";
import { useApi } from "../useApi";

/**
 * Today's practice. For now the suggestion is a fixed pick of one built-in per
 * category; it becomes a real suggestion (weak spots, due tempo bumps) once
 * progress tracking lands, with the player's own routines alongside it.
 */
export function Home() {
  const exercises = useApi("exercises", api.listExercises);
  const runs = useApi("runs:recent", () => api.listRuns({ limit: 5 }));

  const byId = new Map((exercises.data ?? []).map((e) => [e.id, e]));
  const suggestion = pickSuggestion(exercises.data ?? []);

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4 p-5">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-xl font-bold">Suggested session</h1>
          <span className="font-mono text-[13px] text-muted">{suggestion.length * 5} min</span>
        </div>
        {exercises.loading && !exercises.data && <p className="text-sm text-muted">Loading…</p>}
        {exercises.error && <p className="text-sm text-miss">Couldn't load exercises.</p>}
        <ol className="flex flex-col gap-2">
          {suggestion.map((e, i) => (
            <li key={e.id}>
              <a
                href={href({ name: "exercise", id: e.id })}
                className="focus-ring flex min-h-[44px] items-center gap-3 rounded-xl"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-raised font-mono text-xs text-brass">
                  {i + 1}
                </span>
                <span className="flex-1 text-[15px]">{e.name}</span>
                <span className="text-[13px] text-muted">5 min</span>
              </a>
            </li>
          ))}
        </ol>
        <p className="text-[13px] text-faint">
          Suggestions will follow your weak spots once progress tracking is in. You'll be able to save your
          own routines too.
        </p>
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

function pickSuggestion(all: ExerciseRow[]): ExerciseRow[] {
  const out: ExerciseRow[] = [];
  for (const category of ["notes", "scales", "arpeggios"] as const) {
    const first = all.find((e) => e.builtin && e.category === category);
    if (first) out.push(first);
  }
  return out;
}
