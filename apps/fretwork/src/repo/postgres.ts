import type { PostgresClient } from "@stack/db-clients";
import { type ProgressState, foldPositions, foldProgress } from "../domain/progress.js";
import type {
  Category,
  ExerciseConfig,
  ExerciseRow,
  PositionStatRow,
  ProgressRow,
  RoutineInput,
  RoutineRow,
  RunInput,
  RunRow,
} from "../domain/types.js";
import type { FretworkRepo } from "./types.js";

/**
 * Self-hosted implementation. Unqualified table names resolve into the
 * `fretwork` schema via search_path.
 *
 * Timestamps come back from the Drizzle-wrapped client as Postgres text
 * ("2026-09-27 16:40:17.324+00"); they are converted to ISO 8601 here so both
 * backends return the same format. JSONB is written as a JSON string and cast.
 * `bigint` comes back as a string too, and is converted with Number().
 */
export function createPostgresFretworkRepo(pg: PostgresClient): FretworkRepo {
  const { sql } = pg;

  interface ExerciseDbRow {
    id: string;
    name: string;
    category: Category;
    config: ExerciseConfig;
    created_at: string;
    updated_at: string;
  }

  const toExercise = (r: ExerciseDbRow): ExerciseRow => ({
    id: r.id,
    name: r.name,
    category: r.category,
    engine: r.config.engine,
    config: r.config,
    builtin: false,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  });

  interface RunDbRow extends Omit<RunRow, "started_at" | "created_at"> {
    started_at: string;
    created_at: string;
  }

  const toRun = (r: RunDbRow): RunRow => ({
    id: r.id,
    exercise_id: r.exercise_id,
    started_at: iso(r.started_at),
    duration_ms: r.duration_ms,
    tempo: r.tempo,
    notes_total: r.notes_total,
    notes_clean: r.notes_clean,
    clean: r.clean,
    created_at: iso(r.created_at),
  });

  interface ProgressDbRow {
    exercise_id: string;
    tempo: number | null;
    clean_streak: number;
    best_tempo: number | null;
    runs: number;
    last_practiced_at: string | null;
  }

  const toState = (r: ProgressDbRow): ProgressState => ({
    tempo: r.tempo,
    cleanStreak: r.clean_streak,
    bestTempo: r.best_tempo,
    runs: r.runs,
    lastPracticedAt: r.last_practiced_at === null ? null : iso(r.last_practiced_at),
  });

  const toProgress = (r: ProgressDbRow): ProgressRow => ({
    exercise_id: r.exercise_id,
    tempo: r.tempo,
    clean_streak: r.clean_streak,
    best_tempo: r.best_tempo,
    runs: r.runs,
    last_practiced_at: iso(r.last_practiced_at!),
  });

  interface RoutineDbRow {
    id: string;
    name: string;
    items: RoutineRow["items"];
    created_at: string;
    updated_at: string;
  }

  const toRoutine = (r: RoutineDbRow): RoutineRow => ({
    id: r.id,
    name: r.name,
    items: r.items,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  });

  /** Stored snake_case, as the wire has them, in the order given. */
  const itemsJson = (items: RoutineInput["items"]) =>
    JSON.stringify(items.map((i) => ({ exercise_id: i.exerciseId, minutes: i.minutes })));

  return {
    async listExercises(userId) {
      const rows = await sql<ExerciseDbRow[]>`
        SELECT id, name, category, config, created_at, updated_at
        FROM exercises
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
      return rows.map(toExercise);
    },

    async getExercise(userId, id) {
      const rows = await sql<ExerciseDbRow[]>`
        SELECT id, name, category, config, created_at, updated_at
        FROM exercises
        WHERE id = ${id} AND user_id = ${userId}
      `;
      return rows[0] ? toExercise(rows[0]) : null;
    },

    async createExercise(userId, input) {
      const [row] = await sql<ExerciseDbRow[]>`
        INSERT INTO exercises (user_id, name, category, config)
        VALUES (${userId}, ${input.name}, ${input.category}, ${JSON.stringify(input.config)}::jsonb)
        RETURNING id, name, category, config, created_at, updated_at
      `;
      return toExercise(row);
    },

    async updateExercise(userId, id, patch) {
      const rows = await sql<ExerciseDbRow[]>`
        UPDATE exercises SET
          name       = COALESCE(${patch.name ?? null}, name),
          category   = COALESCE(${patch.category ?? null}, category),
          config     = COALESCE(${patch.config ? JSON.stringify(patch.config) : null}::jsonb, config),
          updated_at = now()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id, name, category, config, created_at, updated_at
      `;
      return rows[0] ? toExercise(rows[0]) : null;
    },

    async deleteExercise(userId, id) {
      const rows = await sql`
        DELETE FROM exercises WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    async recordRun(userId, run: RunInput, effects) {
      return sql.begin(async (tx) => {
        const [row] = await tx<RunDbRow[]>`
          INSERT INTO runs (user_id, exercise_id, started_at, duration_ms, tempo,
                            notes_total, notes_clean, clean, notes)
          VALUES (${userId}, ${run.exerciseId}, ${run.startedAt}::timestamptz, ${run.durationMs},
                  ${run.tempo}, ${run.notesTotal}, ${run.notesClean}, ${run.clean},
                  ${JSON.stringify(run.notes)}::jsonb)
          RETURNING id, exercise_id, started_at, duration_ms, tempo,
                    notes_total, notes_clean, clean, created_at
        `;

        // Make sure the row exists, then lock it, so two runs recorded at
        // once fold one after the other instead of both from the same state.
        await tx`
          INSERT INTO exercise_progress (user_id, exercise_id)
          VALUES (${userId}, ${run.exerciseId})
          ON CONFLICT DO NOTHING
        `;
        const [prev] = await tx<ProgressDbRow[]>`
          SELECT exercise_id, tempo, clean_streak, best_tempo, runs, last_practiced_at
          FROM exercise_progress
          WHERE user_id = ${userId} AND exercise_id = ${run.exerciseId}
          FOR UPDATE
        `;
        const next = foldProgress(toState(prev), run, effects.ladder);
        await tx`
          UPDATE exercise_progress SET
            tempo = ${next.tempo},
            clean_streak = ${next.cleanStreak},
            best_tempo = ${next.bestTempo},
            runs = ${next.runs},
            last_practiced_at = ${next.lastPracticedAt}::timestamptz
          WHERE user_id = ${userId} AND exercise_id = ${run.exerciseId}
        `;

        const cells = effects.positions ? [...foldPositions(run.notes).values()] : [];
        if (cells.length) {
          const rows = cells.map((c) => ({
            user_id: userId,
            string: c.string,
            fret: c.fret,
            attempts: c.attempts,
            hits: c.hits,
            total_ms: c.totalMs,
          }));
          await tx`
            INSERT INTO position_stats ${tx(rows, "user_id", "string", "fret", "attempts", "hits", "total_ms")}
            ON CONFLICT (user_id, string, fret) DO UPDATE SET
              attempts = position_stats.attempts + EXCLUDED.attempts,
              hits     = position_stats.hits + EXCLUDED.hits,
              total_ms = position_stats.total_ms + EXCLUDED.total_ms
          `;
        }

        return toRun(row);
      });
    },

    async listRuns(userId, { exerciseId, limit }) {
      const rows = await sql<RunDbRow[]>`
        SELECT id, exercise_id, started_at, duration_ms, tempo,
               notes_total, notes_clean, clean, created_at
        FROM runs
        WHERE user_id = ${userId}
          ${exerciseId ? sql`AND exercise_id = ${exerciseId}` : sql``}
        ORDER BY started_at DESC, created_at DESC
        LIMIT ${limit}
      `;
      return rows.map(toRun);
    },

    async listRunTimes(userId, since) {
      const rows = await sql<{ started_at: string; duration_ms: number }[]>`
        SELECT started_at, duration_ms
        FROM runs
        WHERE user_id = ${userId} AND started_at >= ${since}::timestamptz
      `;
      return rows.map((r) => ({ started_at: iso(r.started_at), duration_ms: r.duration_ms }));
    },

    async listProgress(userId) {
      const rows = await sql<ProgressDbRow[]>`
        SELECT exercise_id, tempo, clean_streak, best_tempo, runs, last_practiced_at
        FROM exercise_progress
        WHERE user_id = ${userId} AND runs > 0
        ORDER BY last_practiced_at DESC, exercise_id
      `;
      return rows.map(toProgress);
    },

    async listPositionStats(userId) {
      const rows = await sql<(Omit<PositionStatRow, "total_ms"> & { total_ms: string })[]>`
        SELECT string, fret, attempts, hits, total_ms
        FROM position_stats
        WHERE user_id = ${userId}
        ORDER BY string, fret
      `;
      return rows.map((r) => ({ ...r, total_ms: Number(r.total_ms) }));
    },

    async listRoutines(userId) {
      const rows = await sql<RoutineDbRow[]>`
        SELECT id, name, items, created_at, updated_at
        FROM routines
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
      return rows.map(toRoutine);
    },

    async getRoutine(userId, id) {
      const rows = await sql<RoutineDbRow[]>`
        SELECT id, name, items, created_at, updated_at
        FROM routines
        WHERE id = ${id} AND user_id = ${userId}
      `;
      return rows[0] ? toRoutine(rows[0]) : null;
    },

    async createRoutine(userId, input) {
      const [row] = await sql<RoutineDbRow[]>`
        INSERT INTO routines (user_id, name, items)
        VALUES (${userId}, ${input.name}, ${itemsJson(input.items)}::jsonb)
        RETURNING id, name, items, created_at, updated_at
      `;
      return toRoutine(row);
    },

    async updateRoutine(userId, id, patch) {
      const rows = await sql<RoutineDbRow[]>`
        UPDATE routines SET
          name       = COALESCE(${patch.name ?? null}, name),
          items      = COALESCE(${patch.items ? itemsJson(patch.items) : null}::jsonb, items),
          updated_at = now()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id, name, items, created_at, updated_at
      `;
      return rows[0] ? toRoutine(rows[0]) : null;
    },

    async deleteRoutine(userId, id) {
      const rows = await sql`
        DELETE FROM routines WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    close: () => pg.close(),
  };
}

function iso(ts: string | Date): string {
  return new Date(ts).toISOString();
}
