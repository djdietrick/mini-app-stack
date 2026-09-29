import { useState } from "react";
import { api } from "../api";
import { Fretboard } from "../components/Fretboard";
import { CATEGORY_LABELS, ENGINE_LABELS, preview, summary } from "../describe";
import { href } from "../router";
import { useApi } from "../useApi";

/**
 * What an exercise asks for, drawn on the neck. The practice screens for each
 * engine (fretboard-first for find, flashcards for respond, the lane for
 * sequence) hang off the Start button as they land.
 */
export function ExerciseDetail({ id }: { id: string }) {
  const exercise = useApi(`exercise:${id}`, () => api.getExercise(id));
  const [deleting, setDeleting] = useState(false);

  if (exercise.loading && !exercise.data) return <p className="text-sm text-muted">Loading…</p>;
  if (exercise.error || !exercise.data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-miss">That exercise doesn't exist, or isn't yours.</p>
        <a href={href({ name: "library" })} className="btn focus-ring self-start">
          Back to library
        </a>
      </div>
    );
  }

  const e = exercise.data;
  const p = preview(e);

  const remove = async () => {
    if (!window.confirm(`Delete “${e.name}”? Its past runs stay in your history.`)) return;
    setDeleting(true);
    try {
      await api.deleteExercise(e.id);
      window.location.hash = href({ name: "library" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <a href={href({ name: "library" })} className="focus-ring self-start rounded text-sm text-muted">
        ← Library
      </a>

      <header className="flex flex-col gap-2">
        <span className="label-caps text-brass">
          {CATEGORY_LABELS[e.category]} · {ENGINE_LABELS[e.engine]}
          {e.builtin ? " · built-in" : ""}
        </span>
        <h1 className="font-display text-3xl font-bold leading-tight">{e.name}</h1>
        <p className="text-[15px] text-muted">{summary(e)}</p>
      </header>

      <section className="card flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="label-caps">On the neck</span>
          <span className="text-[13px] text-muted">{p.caption}</span>
        </div>
        <Fretboard
          frets={p.view}
          highlight={p.window}
          dots={p.dots}
          title={`${e.name} on the fretboard`}
          className="lg:mx-auto lg:max-w-2xl"
        />
      </section>

      {p.sequence.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="label-caps">
            Sequence · {p.sequence.length} notes
          </span>
          <ol className="flex flex-wrap gap-1.5">
            {p.sequence.map((n, i) => (
              <li
                key={i}
                className={
                  "flex h-11 w-11 flex-col items-center justify-center rounded-lg border " +
                  (n.root ? "border-brass bg-brass text-brass-ink" : "border-line bg-surface")
                }
              >
                <span className="font-display text-sm font-bold leading-none">{n.name}</span>
                <span className="font-mono text-[9px] leading-none">{n.degree}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="flex flex-col gap-2">
        <button type="button" className="btn-primary" disabled>
          Start practice
        </button>
        <p className="text-center text-[13px] text-faint">
          Practice mode, with the microphone grading each note, is on the way.
        </p>
      </div>

      {!e.builtin && (
        <button type="button" onClick={() => void remove()} disabled={deleting} className="btn self-start text-miss">
          Delete exercise
        </button>
      )}
    </div>
  );
}
