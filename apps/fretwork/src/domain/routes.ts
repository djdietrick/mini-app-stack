import { type AnyRoute, type Ctx, createRouteBuilder, forbidden, notFound } from "@stack/service-kit";
import { z } from "zod";
import type { FretworkRepo } from "../repo/types.js";
import { BUILTIN_EXERCISES, builtinExercise } from "./catalog.js";
import { practiceByDay, runEffects, weekQuery, weekSince } from "./progress.js";
import { suggestSession } from "./suggest.js";
import { exerciseInput, exercisePatch, routineInput, routinePatch, runInput } from "./types.js";

/**
 * Every fretwork endpoint, transport-free. The same table is served by
 * Fastify self-hosted and by an Express-backed Firebase Function in the cloud.
 *
 * Exercises are the starter catalog (read-only, in code) plus the user's own.
 * Runs are append-only results posted by the SPA after it has graded them;
 * recording one also folds it into the aggregates in domain/progress.ts.
 * Routines are the user's own ordered lists of exercises; the suggested
 * session is computed from progress on every request (domain/suggest.ts).
 */
const route = createRouteBuilder<FretworkRepo>();

const idParam = z.object({ id: z.string().uuid() });

/** Every exercise a routine names must be a built-in or the user's own, like a run's. */
async function checkExercises(ctx: Ctx<FretworkRepo>, items: readonly { exerciseId: string }[] | undefined) {
  if (!items) return;
  const own = new Set((await ctx.repo.listExercises(ctx.user.userId)).map((e) => e.id));
  if (items.some((i) => !builtinExercise(i.exerciseId) && !own.has(i.exerciseId))) {
    throw notFound("exercise not found");
  }
}

export function fretworkRoutes(): AnyRoute<FretworkRepo>[] {
  return [
    route({
      method: "GET",
      path: "/health",
      public: true,
      handler: async () => ({ ok: true }),
    }),

    route({
      method: "GET",
      path: "/exercises",
      // Built-ins first, in catalog order, then the user's own, newest first.
      handler: async (ctx) => [
        ...BUILTIN_EXERCISES,
        ...(await ctx.repo.listExercises(ctx.user.userId)),
      ],
    }),

    route({
      method: "GET",
      path: "/exercises/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => {
        const found =
          builtinExercise(params.id) ?? (await ctx.repo.getExercise(ctx.user.userId, params.id));
        if (!found) throw notFound();
        return found;
      },
    }),

    route({
      method: "POST",
      path: "/exercises",
      input: { body: exerciseInput },
      status: () => 201,
      handler: async (ctx, { body }) => ctx.repo.createExercise(ctx.user.userId, body),
    }),

    route({
      method: "PATCH",
      path: "/exercises/:id",
      input: { params: idParam, body: exercisePatch },
      handler: async (ctx, { params, body }) => {
        if (builtinExercise(params.id)) throw forbidden("BUILTIN_READ_ONLY");
        const updated = await ctx.repo.updateExercise(ctx.user.userId, params.id, body);
        if (!updated) throw notFound();
        return updated;
      },
    }),

    route({
      method: "DELETE",
      path: "/exercises/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => {
        if (builtinExercise(params.id)) throw forbidden("BUILTIN_READ_ONLY");
        if (!(await ctx.repo.deleteExercise(ctx.user.userId, params.id))) throw notFound();
        return { ok: true };
      },
    }),

    route({
      method: "POST",
      path: "/runs",
      input: { body: runInput },
      status: () => 201,
      handler: async (ctx, { body }) => {
        // A run must belong to something the user can see: a built-in or one
        // of their own. A deleted exercise cannot collect new runs.
        const known =
          builtinExercise(body.exerciseId) ??
          (await ctx.repo.getExercise(ctx.user.userId, body.exerciseId));
        if (!known) throw notFound("exercise not found");
        // The ladder rule comes from the exercise as it is now.
        return ctx.repo.recordRun(ctx.user.userId, body, runEffects(known.config));
      },
    }),

    route({
      method: "GET",
      path: "/runs",
      input: {
        query: z.object({
          exerciseId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
      handler: async (ctx, { query }) =>
        ctx.repo.listRuns(ctx.user.userId, { exerciseId: query.exerciseId, limit: query.limit }),
    }),

    route({
      method: "GET",
      path: "/progress",
      handler: async (ctx) => ctx.repo.listProgress(ctx.user.userId),
    }),

    route({
      method: "GET",
      path: "/stats/positions",
      handler: async (ctx) => ctx.repo.listPositionStats(ctx.user.userId),
    }),

    route({
      method: "GET",
      path: "/sessions/suggested",
      handler: async (ctx) => {
        const [own, progress, positions] = await Promise.all([
          ctx.repo.listExercises(ctx.user.userId),
          ctx.repo.listProgress(ctx.user.userId),
          ctx.repo.listPositionStats(ctx.user.userId),
        ]);
        return suggestSession({ exercises: [...BUILTIN_EXERCISES, ...own], progress, positions, now: new Date() });
      },
    }),

    route({
      method: "GET",
      path: "/routines",
      handler: async (ctx) => ctx.repo.listRoutines(ctx.user.userId),
    }),

    route({
      method: "GET",
      path: "/routines/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => {
        const found = await ctx.repo.getRoutine(ctx.user.userId, params.id);
        if (!found) throw notFound();
        return found;
      },
    }),

    route({
      method: "POST",
      path: "/routines",
      input: { body: routineInput },
      status: () => 201,
      handler: async (ctx, { body }) => {
        await checkExercises(ctx, body.items);
        return ctx.repo.createRoutine(ctx.user.userId, body);
      },
    }),

    route({
      method: "PATCH",
      path: "/routines/:id",
      input: { params: idParam, body: routinePatch },
      handler: async (ctx, { params, body }) => {
        await checkExercises(ctx, body.items);
        const updated = await ctx.repo.updateRoutine(ctx.user.userId, params.id, body);
        if (!updated) throw notFound();
        return updated;
      },
    }),

    route({
      method: "DELETE",
      path: "/routines/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => {
        if (!(await ctx.repo.deleteRoutine(ctx.user.userId, params.id))) throw notFound();
        return { ok: true };
      },
    }),

    route({
      method: "GET",
      path: "/stats/week",
      input: { query: weekQuery },
      // Firestore has no GROUP BY, so both backends total the days here.
      handler: async (ctx, { query }) => {
        const now = new Date();
        const runs = await ctx.repo.listRunTimes(ctx.user.userId, weekSince(query.days, now));
        return practiceByDay(runs, { days: query.days, tz: query.tz, now });
      },
    }),
  ];
}
