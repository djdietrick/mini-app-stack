import { type AnyRoute, badRequest, createRouteBuilder, notFound } from "@stack/service-kit";
import { z } from "zod";
import type { CrateRepo } from "../repo/types.js";
import type { ItunesGateway } from "./itunes.js";
import { QUEUE_STATUS, albumInput } from "./types.js";

/**
 * Every crate endpoint, transport-free. The same table is served by Fastify
 * self-hosted and by an Express-backed Firebase Function in the cloud.
 */
export interface CrateDeps {
  itunes: ItunesGateway;
}

const route = createRouteBuilder<CrateRepo>();

const idParam = z.object({ id: z.string().uuid() });
const statusQuery = z.object({ status: QUEUE_STATUS.optional() });

export function crateRoutes(deps: CrateDeps): AnyRoute<CrateRepo>[] {
  return [
    route({
      method: "GET",
      path: "/health",
      public: true,
      handler: async () => ({ ok: true }),
    }),

    route({
      method: "GET",
      path: "/search",
      input: { query: z.object({ q: z.string().min(1) }) },
      // Kept as a bare message rather than a flattened zod error, matching the
      // response this endpoint has always returned.
      onInvalid: () => badRequest("missing q"),
      handler: async (_ctx, { query }) => deps.itunes.search(query.q),
    }),

    route({
      method: "GET",
      path: "/artists/:artistId/albums",
      input: { params: z.object({ artistId: z.string().regex(/^\d+$/) }) },
      handler: async (_ctx, { params }) => deps.itunes.artistAlbums(params.artistId),
    }),

    route({
      method: "POST",
      path: "/queue",
      input: { body: albumInput },
      // 201 on a fresh queue entry, 200 when it was already queued.
      status: (out) => (out.queued ? 201 : 200),
      handler: async (ctx, { body }) => ctx.repo.addToQueue(ctx.user.userId, body),
    }),

    route({
      method: "GET",
      path: "/queue",
      input: { query: statusQuery },
      handler: async (ctx, { query }) => ctx.repo.listQueue(ctx.user.userId, query.status),
    }),

    route({
      method: "POST",
      path: "/queue/status",
      input: { body: z.object({ providerAlbumIds: z.array(z.string().min(1)).max(500) }) },
      handler: async (ctx, { body }) =>
        ctx.repo.statusFor(ctx.user.userId, body.providerAlbumIds),
    }),

    route({
      method: "GET",
      path: "/queue/random",
      input: { query: z.object({ genre: z.string().min(1).optional() }) },
      handler: async (ctx, { query }) => {
        const pick = await ctx.repo.randomQueued(ctx.user.userId, query.genre);
        if (!pick) throw notFound("queue is empty");
        return pick;
      },
    }),

    route({
      method: "GET",
      path: "/queue/genres",
      input: { query: statusQuery },
      handler: async (ctx, { query }) => ctx.repo.genreCounts(ctx.user.userId, query.status),
    }),

    route({
      method: "POST",
      path: "/queue/:id/listened",
      input: { params: idParam },
      handler: async (ctx, { params }) => ok(ctx.repo.markListened(ctx.user.userId, params.id)),
    }),

    route({
      method: "POST",
      path: "/queue/:id/skip",
      input: { params: idParam },
      handler: async (ctx, { params }) => ok(ctx.repo.skip(ctx.user.userId, params.id)),
    }),

    route({
      method: "POST",
      path: "/queue/:id/rating",
      input: {
        params: idParam,
        body: z.object({ rating: z.number().int().min(1).max(5).nullable() }),
      },
      handler: async (ctx, { params, body }) =>
        ok(ctx.repo.setRating(ctx.user.userId, params.id, body.rating)),
    }),

    route({
      method: "POST",
      path: "/queue/:id/requeue",
      input: { params: idParam },
      handler: async (ctx, { params }) => ok(ctx.repo.requeue(ctx.user.userId, params.id)),
    }),

    route({
      method: "DELETE",
      path: "/queue/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => ok(ctx.repo.remove(ctx.user.userId, params.id)),
    }),
  ];
}

/** Mutations report "did it match" and the 404 is decided here, not in the repo. */
async function ok(affected: Promise<boolean>): Promise<{ ok: true }> {
  if (!(await affected)) throw notFound();
  return { ok: true };
}
