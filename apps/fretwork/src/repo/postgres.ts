import type { PostgresClient } from "@stack/db-clients";
import type {
  Category,
  ExerciseConfig,
  ExerciseRow,
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

    async recordRun(userId, run: RunInput) {
      const [row] = await sql<RunDbRow[]>`
        INSERT INTO runs (user_id, exercise_id, started_at, duration_ms, tempo,
                          notes_total, notes_clean, clean, notes)
        VALUES (${userId}, ${run.exerciseId}, ${run.startedAt}::timestamptz, ${run.durationMs},
                ${run.tempo}, ${run.notesTotal}, ${run.notesClean}, ${run.clean},
                ${JSON.stringify(run.notes)}::jsonb)
        RETURNING id, exercise_id, started_at, duration_ms, tempo,
                  notes_total, notes_clean, clean, created_at
      `;
      return toRun(row);
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

    close: () => pg.close(),
  };
}

function iso(ts: string | Date): string {
  return new Date(ts).toISOString();
}
