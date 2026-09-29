import { api } from "../api";
import { FindPractice } from "../practice/FindPractice";
import { RespondPractice } from "../practice/RespondPractice";
import { SequencePractice } from "../practice/SequencePractice";
import { href } from "../router";
import { useApi } from "../useApi";
import { useWakeLock } from "../wakeLock";

/**
 * Loads an exercise and hands it to its engine's practice screen. The screen
 * stays awake while it is open, and taps on it never select text or zoom
 * (`.practice` in index.css): the phone is on a stand, and a double tap on
 * the neck is two notes.
 */
export function Practice({ id }: { id: string }) {
  const exercise = useApi(`exercise:${id}`, () => api.getExercise(id));
  useWakeLock();

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
  return (
    <div className="practice">
      {e.config.engine === "find" && <FindPractice exercise={e} config={e.config} />}
      {e.config.engine === "respond" && <RespondPractice exercise={e} config={e.config} />}
      {e.config.engine === "sequence" && <SequencePractice exercise={e} config={e.config} />}
    </div>
  );
}
