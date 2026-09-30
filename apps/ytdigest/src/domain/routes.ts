import { type AnyRoute, badRequest, conflict, createRouteBuilder, notFound } from "@stack/service-kit";
import { z } from "zod";
import type { YtdigestRepo } from "../repo/types.js";
import { type DigestMailer, type DigestOptions, sendDigest } from "./digest.js";
import {
  buildFeed,
  decodeCursor,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  videoDetail,
} from "./feed.js";
import {
  createRuleBody,
  createSubscriptionBody,
  patchRuleBody,
  patchSubscriptionBody,
} from "./types.js";
import type { YouTubeGateway } from "./youtube.js";

/**
 * Every ytdigest endpoint, transport-free. Fastify serves this table
 * self-hosted; an Express-backed Firebase Function serves it in the cloud.
 * The background work (polling, the daily send) is in poll.ts and digest.ts,
 * driven by each target's own scheduler.
 *
 * Status codes and error bodies match what apps/ytdigest/web/src/api.ts has
 * always received, with one deliberate exception, marked below.
 */
export interface YtdigestDeps {
  youtube: YouTubeGateway;
  mailer: DigestMailer;
  digest?: DigestOptions;
}

const route = createRouteBuilder<YtdigestRepo>();

const idParam = z.object({ id: z.string().uuid() });
const ok = { ok: true } as const;
const created = () => 201;

export function ytdigestRoutes(deps: YtdigestDeps): AnyRoute<YtdigestRepo>[] {
  return [
    route({
      method: "GET",
      path: "/health",
      public: true,
      handler: async () => ({ ok: true }),
    }),

    // ---------- channels ----------

    route({
      method: "GET",
      path: "/channels",
      handler: async ({ repo, user }) => repo.listChannels(user.userId),
    }),

    route({
      method: "POST",
      path: "/channels/resolve",
      input: { body: z.object({ query: z.string().min(1).max(200) }) },
      handler: async (_ctx, { body }) => {
        const resolved = await deps.youtube.resolveChannel(body.query);
        if (!resolved) throw notFound("channel not found");
        return resolved;
      },
    }),

    // ---------- subscriptions ----------

    route({
      method: "GET",
      path: "/subscriptions",
      handler: async ({ repo, user }) => repo.listSubscriptions(user.userId),
    }),

    route({
      method: "POST",
      path: "/subscriptions",
      input: { body: createSubscriptionBody },
      status: created,
      handler: async ({ repo, user }, { body }) => {
        const resolved = await deps.youtube.resolveChannel(body.query);
        if (!resolved) throw notFound("channel not found");

        const channelId = await repo.upsertChannel(resolved);
        const id = await repo.createSubscription(
          user.userId,
          channelId,
          body.cadence,
          body.digestDayOfWeek ?? null,
          body.notifyMode,
        );
        if (!id) throw conflict("already subscribed");
        return { id, channelId };
      },
    }),

    route({
      method: "PATCH",
      path: "/subscriptions/:id",
      input: { params: idParam, body: patchSubscriptionBody },
      handler: async ({ repo, user }, { params, body }) => {
        if (
          body.cadence === undefined &&
          body.digestDayOfWeek === undefined &&
          body.notifyMode === undefined
        ) {
          return ok;
        }
        if (!(await repo.updateSubscription(user.userId, params.id, body))) throw notFound();
        return ok;
      },
    }),

    route({
      method: "DELETE",
      path: "/subscriptions/:id",
      input: { params: idParam },
      handler: async ({ repo, user }, { params }) => {
        if (!(await repo.deleteSubscription(user.userId, params.id))) throw notFound();
        return ok;
      },
    }),

    // ---------- rules ----------

    route({
      method: "GET",
      path: "/rules",
      handler: async ({ repo, user }) => repo.listRules(user.userId),
    }),

    route({
      method: "POST",
      path: "/rules",
      input: { body: createRuleBody },
      status: created,
      handler: async ({ repo, user }, { body }) => {
        // Previously an unknown id was a foreign-key violation, i.e. a 500,
        // and another user's subscription id was accepted. Firestore has no
        // foreign keys, so the check is explicit here for both backends.
        if (body.subscriptionId && !(await repo.subscriptionExists(user.userId, body.subscriptionId))) {
          throw notFound("subscription not found");
        }
        return { id: await repo.createRule(user.userId, body) };
      },
    }),

    route({
      method: "PATCH",
      path: "/rules/:id",
      input: { params: idParam, body: patchRuleBody },
      handler: async ({ repo, user }, { params, body }) => {
        if (body.name === undefined && body.ruleJson === undefined && body.enabled === undefined) {
          return ok;
        }
        if (!(await repo.updateRule(user.userId, params.id, body))) throw notFound();
        return ok;
      },
    }),

    route({
      method: "DELETE",
      path: "/rules/:id",
      input: { params: idParam },
      handler: async ({ repo, user }, { params }) => {
        if (!(await repo.deleteRule(user.userId, params.id))) throw notFound();
        return ok;
      },
    }),

    // ---------- feed ----------

    route({
      method: "GET",
      path: "/feed",
      input: {
        query: z.object({
          before: z.string().min(1).max(200).optional(),
          limit: z.coerce.number().int().min(1).max(FEED_MAX_LIMIT).default(FEED_DEFAULT_LIMIT),
        }),
      },
      handler: async ({ repo, user }, { query }) => {
        const before = query.before === undefined ? null : decodeCursor(query.before);
        if (query.before !== undefined && !before) throw badRequest("invalid cursor");
        return buildFeed(repo, user.userId, { before, limit: query.limit }, deps.digest?.baseline);
      },
    }),

    route({
      method: "GET",
      path: "/videos/:youtubeVideoId",
      // A YouTube id, not a UUID: that is the only id both backends share.
      input: { params: z.object({ youtubeVideoId: z.string().regex(/^[\w-]{1,64}$/) }) },
      handler: async ({ repo, user }, { params }) => {
        const video = await videoDetail(repo, user.userId, params.youtubeVideoId, deps.digest?.baseline);
        if (!video) throw notFound();
        return video;
      },
    }),

    // ---------- digests ----------

    route({
      method: "GET",
      path: "/digests",
      handler: async ({ repo, user }) => repo.listDigests(user.userId),
    }),

    route({
      method: "GET",
      path: "/digests/:id",
      input: { params: idParam },
      handler: async ({ repo, user }, { params }) => {
        const digest = await repo.getDigest(user.userId, params.id);
        if (!digest) throw notFound();
        return digest;
      },
    }),

    route({
      method: "POST",
      path: "/digests/run-now",
      handler: async ({ repo, user }) =>
        sendDigest(repo, deps.mailer, user.userId, user.email, new Date(), true, deps.digest),
    }),
  ];
}
