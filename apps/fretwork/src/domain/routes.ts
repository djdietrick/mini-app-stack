import { type AnyRoute, createRouteBuilder, forbidden, notFound } from "@stack/service-kit";
import { z } from "zod";
import type { FretworkRepo } from "../repo/types.js";
import { BUILTIN_EXERCISES, builtinExercise } from "./catalog.js";
import { exerciseInput, exercisePatch, runInput } from "./types.js";

/**
 * Every fretwork endpoint, transport-free. The same table is served by
 * Fastify self-hosted and by an Express-backed Firebase Function in the cloud.
 *
 * Exercises are the starter catalog (read-only, in code) plus the user's own.
 * Runs are append-only results posted by the SPA after it has graded them.
 */
const route = createRouteBuilder<FretworkRepo>();

const idParam = z.object({ id: z.string().uuid() });

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
        return ctx.repo.recordRun(ctx.user.userId, body);
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
  ];
}
