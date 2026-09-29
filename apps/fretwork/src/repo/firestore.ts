import { randomUUID } from "node:crypto";
import { Timestamp } from "@google-cloud/firestore";
import type { Firestore } from "@google-cloud/firestore";
import type {
  Category,
  ExerciseConfig,
  ExerciseRow,
  NoteResult,
  RunInput,
  RunRow,
} from "../domain/types.js";
import type { FretworkRepo } from "./types.js";

/**
 * Cloud implementation.
 *
 * Document layout:
 *   fretwork_exercises/{uuid}   one per user-created exercise
 *   fretwork_runs/{uuid}        one per finished run, per-note detail embedded
 *
 * Ids are app-generated UUIDs, not Firestore auto-ids, so `z.string().uuid()`
 * on the route params holds on both backends. Configs are stored as plain
 * maps after a JSON round-trip, which drops `undefined` (Firestore rejects it
 * unless the client opts in, and the Functions client does not).
 */
export function createFirestoreFretworkRepo(db: Firestore, prefix = "fretwork_"): FretworkRepo {
  const exercises = db.collection(`${prefix}exercises`);
  const runs = db.collection(`${prefix}runs`);

  interface ExerciseDoc {
    userId: string;
    name: string;
    category: Category;
    config: ExerciseConfig;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  }

  interface RunDoc {
    userId: string;
    exerciseId: string;
    startedAt: Timestamp;
    durationMs: number;
    tempo: number | null;
    notesTotal: number;
    notesClean: number;
    clean: boolean;
    notes: NoteResult[];
    createdAt: Timestamp;
  }

  const toExercise = (id: string, d: ExerciseDoc): ExerciseRow => ({
    id,
    name: d.name,
    category: d.category,
    engine: d.config.engine,
    config: d.config,
    builtin: false,
    created_at: d.createdAt.toDate().toISOString(),
    updated_at: d.updatedAt.toDate().toISOString(),
  });

  const toRun = (id: string, d: RunDoc): RunRow => ({
    id,
    exercise_id: d.exerciseId,
    started_at: d.startedAt.toDate().toISOString(),
    duration_ms: d.durationMs,
    tempo: d.tempo,
    notes_total: d.notesTotal,
    notes_clean: d.notesClean,
    clean: d.clean,
    created_at: d.createdAt.toDate().toISOString(),
  });

  const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  return {
    async listExercises(userId) {
      const snap = await exercises.where("userId", "==", userId).orderBy("createdAt", "desc").get();
      return snap.docs.map((d) => toExercise(d.id, d.data() as ExerciseDoc));
    },

    async getExercise(userId, id) {
      const snap = await exercises.doc(id).get();
      if (!snap.exists) return null;
      const doc = snap.data() as ExerciseDoc;
      // Mirrors `WHERE id = $1 AND user_id = $2`: someone else's is not found.
      return doc.userId === userId ? toExercise(snap.id, doc) : null;
    },

    async createExercise(userId, input) {
      const now = Timestamp.now();
      const doc: ExerciseDoc = {
        userId,
        name: input.name,
        category: input.category,
        config: plain(input.config),
        createdAt: now,
        updatedAt: now,
      };
      const ref = exercises.doc(randomUUID());
      await ref.set(doc);
      return toExercise(ref.id, doc);
    },

    async updateExercise(userId, id, patch) {
      const ref = exercises.doc(id);
      // Read-then-write in one transaction so the ownership check and the
      // update cannot interleave with a delete. No side effects: it may retry.
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const doc = snap.data() as ExerciseDoc;
        if (doc.userId !== userId) return null;
        const next: ExerciseDoc = {
          ...doc,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.category !== undefined ? { category: patch.category } : {}),
          ...(patch.config !== undefined ? { config: plain(patch.config) } : {}),
          updatedAt: Timestamp.now(),
        };
        tx.set(ref, next);
        return toExercise(id, next);
      });
    },

    async deleteExercise(userId, id) {
      const ref = exercises.doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || (snap.data() as ExerciseDoc).userId !== userId) return false;
        tx.delete(ref);
        return true;
      });
    },

    async recordRun(userId, run: RunInput) {
      const doc: RunDoc = {
        userId,
        exerciseId: run.exerciseId,
        startedAt: Timestamp.fromDate(new Date(run.startedAt)),
        durationMs: run.durationMs,
        tempo: run.tempo,
        notesTotal: run.notesTotal,
        notesClean: run.notesClean,
        clean: run.clean,
        notes: plain(run.notes),
        createdAt: Timestamp.now(),
      };
      const ref = runs.doc(randomUUID());
      await ref.set(doc);
      return toRun(ref.id, doc);
    },

    async listRuns(userId, { exerciseId, limit }) {
      let q = runs.where("userId", "==", userId);
      if (exerciseId) q = q.where("exerciseId", "==", exerciseId);
      // `select` leaves the per-note array on the server; the list never shows it.
      const snap = await q
        .orderBy("startedAt", "desc")
        .limit(limit)
        .select(
          "exerciseId",
          "startedAt",
          "durationMs",
          "tempo",
          "notesTotal",
          "notesClean",
          "clean",
          "createdAt",
        )
        .get();
      return snap.docs.map((d) => toRun(d.id, d.data() as RunDoc));
    },

    async close() {
      // No-op by design. The Firestore client is shared across warm
      // invocations of a Function instance; terminating it here would break
      // the next request served by the same instance.
    },
  };
}
