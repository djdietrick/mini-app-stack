import { type ExerciseConfig, api } from "../api";
import { FindPractice } from "../practice/FindPractice";
import { RespondPractice } from "../practice/RespondPractice";
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
  if (canPractice(e.config)) {
    if (e.config.engine === "find") return <FindPractice exercise={e} config={e.config} />;
    if (e.config.engine === "respond") return <RespondPractice exercise={e} config={e.config} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-bold">{e.name}</h1>
      <p className="text-[15px] text-muted">Practice for this kind of exercise is on the way.</p>
      <a href={href({ name: "exercise", id: e.id })} className="btn focus-ring self-start">
        Back
      </a>
    </div>
  );
}

/**
 * Whether an exercise has a practice screen yet. "Play what you hear" waits
 * on audio output (reference tones); its grading is already in respond.ts.
 */
export function canPractice(config: ExerciseConfig): boolean {
  return config.engine === "find" || (config.engine === "respond" && config.prompt !== "play-heard-note");
}
