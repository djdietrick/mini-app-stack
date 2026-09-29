import type { Closable } from "@stack/service-kit";
import type { RunEffects } from "../domain/progress.js";
import type {
  ExerciseInput,
  ExercisePatch,
  ExerciseRow,
  PositionStatRow,
  ProgressRow,
  RoutineInput,
  RoutinePatch,
  RoutineRow,
  RunInput,
  RunRow,
} from "../domain/types.js";

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

  /**
   * Appends a finished run, and in the same transaction folds it into the
   * exercise's progress (`foldProgress`) and, when `effects.positions`, the
   * position stats (`foldPositions`). Runs are never edited.
   */
  recordRun(userId: string, run: RunInput, effects: RunEffects): Promise<RunRow>;
  /** Newest first by started_at. */
  listRuns(userId: string, opts: { exerciseId?: string; limit: number }): Promise<RunRow[]>;
  /** Start and length of every run started at or after `since` (ISO 8601), in any order. */
  listRunTimes(userId: string, since: string): Promise<{ started_at: string; duration_ms: number }[]>;

  /** One row per exercise practiced, most recently practiced first. */
  listProgress(userId: string): Promise<ProgressRow[]>;
  /** Every position with at least one attempt, by string then fret. */
  listPositionStats(userId: string): Promise<PositionStatRow[]>;

  /** The user's routines, newest first. */
  listRoutines(userId: string): Promise<RoutineRow[]>;
  getRoutine(userId: string, id: string): Promise<RoutineRow | null>;
  createRoutine(userId: string, input: RoutineInput): Promise<RoutineRow>;
  updateRoutine(userId: string, id: string, patch: RoutinePatch): Promise<RoutineRow | null>;
  deleteRoutine(userId: string, id: string): Promise<boolean>;
}
