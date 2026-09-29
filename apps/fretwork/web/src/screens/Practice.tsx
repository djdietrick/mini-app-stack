import { api } from "../api";
import { FindPractice } from "../practice/FindPractice";
import { RespondPractice } from "../practice/RespondPractice";
import { SequencePractice } from "../practice/SequencePractice";
import { href } from "../router";
import { useApi } from "../useApi";

/** Loads an exercise and hands it to its engine's practice screen. */
export function Practice({ id }: { id: string }) {
  const exercise = useApi(`exercise:${id}`, () => api.getExercise(id));

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
  switch (e.config.engine) {
    case "find":
      return <FindPractice exercise={e} config={e.config} />;
    case "respond":
      return <RespondPractice exercise={e} config={e.config} />;
    case "sequence":
      return <SequencePractice exercise={e} config={e.config} />;
  }
}
