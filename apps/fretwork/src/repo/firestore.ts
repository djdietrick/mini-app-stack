import { randomUUID } from "node:crypto";
import { Timestamp } from "@google-cloud/firestore";
import type { Firestore } from "@google-cloud/firestore";
import { EMPTY_PROGRESS, type ProgressState, foldPositions, foldProgress } from "../domain/progress.js";
import type {
  Category,
  ExerciseConfig,
  ExerciseRow,
  NoteResult,
  PositionStatRow,
  ProgressRow,
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
 *   fretwork_progress/{userId}_{exerciseId}
 *                               the tempo ladder and streak; a deterministic id,
 *                               so there is one per exercise without a unique index
 *   fretwork_position_stats/{userId}
 *                               the whole fretboard map in one doc, as a map
 *                               "string:fret" -> { a, h, ms }: one write per run,
 *                               and at most 150 cells, far under the 1 MiB limit
 *
 * recordRun writes all three in one transaction.
 *
 * Ids are app-generated UUIDs, not Firestore auto-ids, so `z.string().uuid()`
 * on the route params holds on both backends. Configs are stored as plain
 * maps after a JSON round-trip, which drops `undefined` (Firestore rejects it
 * unless the client opts in, and the Functions client does not).
 */
export function createFirestoreFretworkRepo(db: Firestore, prefix = "fretwork_"): FretworkRepo {
  const exercises = db.collection(`${prefix}exercises`);
  const runs = db.collection(`${prefix}runs`);
  const progress = db.collection(`${prefix}progress`);
  const positionStats = db.collection(`${prefix}position_stats`);

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

  interface ProgressDoc {
    userId: string;
    exerciseId: string;
    tempo: number | null;
    cleanStreak: number;
    bestTempo: number | null;
    runs: number;
    lastPracticedAt: Timestamp;
  }

  /** `a` attempts, `h` hits, `ms` summed over hits. Short keys: this is the one doc per user. */
  interface PositionStatsDoc {
    userId: string;
    cells: Record<string, { a: number; h: number; ms: number }>;
  }

  const toState = (d: ProgressDoc): ProgressState => ({
    tempo: d.tempo,
    cleanStreak: d.cleanStreak,
    bestTempo: d.bestTempo,
    runs: d.runs,
    lastPracticedAt: d.lastPracticedAt.toDate().toISOString(),
  });

  const toProgress = (d: ProgressDoc): ProgressRow => ({
    exercise_id: d.exerciseId,
    tempo: d.tempo,
    clean_streak: d.cleanStreak,
    best_tempo: d.bestTempo,
    runs: d.runs,
    last_practiced_at: d.lastPracticedAt.toDate().toISOString(),
  });

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

    async recordRun(userId, run: RunInput, effects) {
      const progressRef = progress.doc(`${userId}_${run.exerciseId}`);
      const statsRef = positionStats.doc(userId);
      const cells = effects.positions ? [...foldPositions(run.notes).entries()] : [];

      // All reads before any write, and nothing outside the transaction: the
      // callback is retried on contention, and only the last attempt commits.
      return db.runTransaction(async (tx) => {
        const prevSnap = await tx.get(progressRef);
        const statsSnap = cells.length ? await tx.get(statsRef) : null;

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
        tx.create(ref, doc);

        const prev = prevSnap.exists ? toState(prevSnap.data() as ProgressDoc) : EMPTY_PROGRESS;
        const next = foldProgress(prev, run, effects.ladder);
        const progressDoc: ProgressDoc = {
          userId,
          exerciseId: run.exerciseId,
          tempo: next.tempo,
          cleanStreak: next.cleanStreak,
          bestTempo: next.bestTempo,
          runs: next.runs,
          lastPracticedAt: Timestamp.fromDate(new Date(next.lastPracticedAt!)),
        };
        tx.set(progressRef, progressDoc);

        if (statsSnap) {
          const stats: PositionStatsDoc = statsSnap.exists
            ? (statsSnap.data() as PositionStatsDoc)
            : { userId, cells: {} };
          for (const [key, c] of cells) {
            const was = stats.cells[key] ?? { a: 0, h: 0, ms: 0 };
            stats.cells[key] = { a: was.a + c.attempts, h: was.h + c.hits, ms: was.ms + c.totalMs };
          }
          tx.set(statsRef, stats);
        }

        return toRun(ref.id, doc);
      });
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

    async listRunTimes(userId, since) {
      // Served by the (userId, startedAt desc) index that GET /runs uses.
      const snap = await runs
        .where("userId", "==", userId)
        .where("startedAt", ">=", Timestamp.fromDate(new Date(since)))
        .orderBy("startedAt", "desc")
        .select("startedAt", "durationMs")
        .get();
      return snap.docs.map((d) => {
        const r = d.data() as Pick<RunDoc, "startedAt" | "durationMs">;
        return { started_at: r.startedAt.toDate().toISOString(), duration_ms: r.durationMs };
      });
    },

    async listProgress(userId) {
      // One doc per exercise practiced: small, so sorted here rather than
      // with another composite index.
      const snap = await progress.where("userId", "==", userId).get();
      return snap.docs
        .map((d) => toProgress(d.data() as ProgressDoc))
        .sort(
          (a, b) =>
            b.last_practiced_at.localeCompare(a.last_practiced_at) ||
            (a.exercise_id < b.exercise_id ? -1 : a.exercise_id > b.exercise_id ? 1 : 0),
        );
    },

    async listPositionStats(userId) {
      const snap = await positionStats.doc(userId).get();
      if (!snap.exists) return [];
      const { cells } = snap.data() as PositionStatsDoc;
      return Object.entries(cells)
        .map(([key, c]): PositionStatRow => {
          const [string, fret] = key.split(":").map(Number);
          return { string, fret, attempts: c.a, hits: c.h, total_ms: c.ms };
        })
        .sort((a, b) => a.string - b.string || a.fret - b.fret);
    },

    async close() {
      // No-op by design. The Firestore client is shared across warm
      // invocations of a Function instance; terminating it here would break
      // the next request served by the same instance.
    },
  };
}
