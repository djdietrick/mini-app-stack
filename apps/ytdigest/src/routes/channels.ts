import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type postgres from "postgres";
import { resolveChannel } from "../youtube/client.js";

export function registerChannelRoutes(api: FastifyInstance, sql: postgres.Sql): void {
  api.get("/channels", async (req) => {
    return sql`
      SELECT c.id, c.youtube_channel_id, c.title, c.thumbnail_url, c.last_polled_at,
             s.id AS subscription_id
      FROM channels c
      LEFT JOIN subscriptions s ON s.channel_id = c.id AND s.user_id = ${req.user!.userId}
      ORDER BY c.title ASC
    `;
  });

  const resolveBody = z.object({ query: z.string().min(1).max(200) });
  api.post("/channels/resolve", async (req, reply) => {
    const parsed = resolveBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const resolved = await resolveChannel(parsed.data.query);
    if (!resolved) return reply.code(404).send({ error: "channel not found" });
    return resolved;
  });
}
