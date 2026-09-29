/**
 * Thin client for /api. The wire types come straight from the server's domain
 * module (type-only, so nothing server-side lands in the bundle), which keeps
 * the SPA and both backends on one definition.
 */
import type {
  Category,
  ExerciseConfig,
  ExerciseInput,
  ExercisePatch,
  ExerciseRow,
  RunInput,
  RunRow,
} from "../../src/domain/types.js";

export type { Category, ExerciseConfig, ExerciseInput, ExercisePatch, ExerciseRow, RunInput, RunRow };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${status}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export const api = {
  listExercises: () => call<ExerciseRow[]>("GET", "/exercises"),
  getExercise: (id: string) => call<ExerciseRow>("GET", `/exercises/${id}`),
  createExercise: (input: ExerciseInput) => call<ExerciseRow>("POST", "/exercises", input),
  updateExercise: (id: string, patch: ExercisePatch) =>
    call<ExerciseRow>("PATCH", `/exercises/${id}`, patch),
  deleteExercise: (id: string) => call<{ ok: true }>("DELETE", `/exercises/${id}`),
  recordRun: (run: RunInput) => call<RunRow>("POST", "/runs", run),
  listRuns: (opts: { exerciseId?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.exerciseId) q.set("exerciseId", opts.exerciseId);
    if (opts.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return call<RunRow[]>("GET", `/runs${qs ? `?${qs}` : ""}`);
  },
};
