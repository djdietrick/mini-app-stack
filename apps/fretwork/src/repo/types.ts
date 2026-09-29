import type { Closable } from "@stack/service-kit";
import type { ExerciseInput, ExercisePatch, ExerciseRow, RunInput, RunRow } from "../domain/types.js";

/**
 * fretwork's data port. Implemented twice: postgres.ts (self-hosted) and
 * firestore.ts (cloud). Domain code depends only on this.
 *
 * Only a user's own exercises are stored; built-ins come from
 * domain/catalog.ts and never reach the repo. Every method takes userId so
 * ownership is enforced in the query itself. Mutations report "did it match"
 * (null / false) and the route decides the 404.
 */
export interface FretworkRepo extends Closable {
  /** The user's own exercises, newest first. */
  listExercises(userId: string): Promise<ExerciseRow[]>;
  getExercise(userId: string, id: string): Promise<ExerciseRow | null>;
  createExercise(userId: string, input: ExerciseInput): Promise<ExerciseRow>;
  updateExercise(userId: string, id: string, patch: ExercisePatch): Promise<ExerciseRow | null>;
  deleteExercise(userId: string, id: string): Promise<boolean>;

  /** Appends a finished run. Runs are never edited. */
  recordRun(userId: string, run: RunInput): Promise<RunRow>;
  /** Newest first by started_at. */
  listRuns(userId: string, opts: { exerciseId?: string; limit: number }): Promise<RunRow[]>;
}
