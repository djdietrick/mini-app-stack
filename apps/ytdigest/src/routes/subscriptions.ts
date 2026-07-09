import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type postgres from "postgres";
import { resolveChannel } from "../youtube/client.js";

const idParam = z.object({ id: z.string().uuid() });

const CADENCE = z.enum(["daily", "weekly"]);
const NOTIFY_MODE = z.enum(["all", "rules"]);

export function registerSubscriptionRoutes(api: FastifyInstance, sql: postgres.Sql): void {
  api.get("/subscriptions", async (req) => {
    return sql`
      SELECT s.id, s.channel_id, c.title AS channel_title, c.thumbnail_url,
             s.cadence, s.digest_day_of_week, s.notify_mode, s.last_digested_at, s.created_at
      FROM subscriptions s
      JOIN channels c ON c.id = s.channel_id
      WHERE s.user_id = ${req.user!.userId}
      ORDER BY c.title ASC
    `;
  });

  const createBody = z
    .object({
      query: z.string().min(1).max(200),
      cadence: CADENCE,
      digestDayOfWeek: z.number().int().min(0).max(6).optional(),
      notifyMode: NOTIFY_MODE.default("rules"),
    })
    .refine((b) => b.cadence !== "weekly" || b.digestDayOfWeek !== undefined, {
      message: "digestDayOfWeek is required for weekly cadence",
      path: ["digestDayOfWeek"],
    });

  api.post("/subscriptions", async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const a = parsed.data;

    const resolved = await resolveChannel(a.query);
    if (!resolved) return reply.code(404).send({ error: "channel not found" });

    const [channel] = await sql<{ id: string }[]>`
      INSERT INTO channels (youtube_channel_id, title, thumbnail_url, uploads_playlist_id)
      VALUES (${resolved.youtubeChannelId}, ${resolved.title}, ${resolved.thumbnailUrl}, ${resolved.uploadsPlaylistId})
      ON CONFLICT (youtube_channel_id) DO UPDATE SET title = EXCLUDED.title, thumbnail_url = EXCLUDED.thumbnail_url
      RETURNING id
    `;

    try {
      const [sub] = await sql<{ id: string }[]>`
        INSERT INTO subscriptions (user_id, channel_id, cadence, digest_day_of_week, notify_mode)
        VALUES (${req.user!.userId}, ${channel.id}, ${a.cadence}, ${a.digestDayOfWeek ?? null}, ${a.notifyMode})
        RETURNING id
      `;
      return reply.code(201).send({ id: sub.id, channelId: channel.id });
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === "23505") return reply.code(409).send({ error: "already subscribed" });
      throw e;
    }
  });

  const patchBody = z.object({
    cadence: CADENCE.optional(),
    digestDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    notifyMode: NOTIFY_MODE.optional(),
  });

  api.patch("/subscriptions/:id", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const a = parsed.data;

    const updates: ReturnType<typeof sql>[] = [];
    if (a.cadence !== undefined) updates.push(sql`cadence = ${a.cadence}`);
    if (a.digestDayOfWeek !== undefined) updates.push(sql`digest_day_of_week = ${a.digestDayOfWeek}`);
    if (a.notifyMode !== undefined) updates.push(sql`notify_mode = ${a.notifyMode}`);
    if (updates.length === 0) return { ok: true };

    let setClause = updates[0];
    for (let i = 1; i < updates.length; i++) setClause = sql`${setClause}, ${updates[i]}`;

    const rows = await sql`
      UPDATE subscriptions SET ${setClause}
      WHERE id = ${parsedId.data.id} AND user_id = ${req.user!.userId}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  api.delete("/subscriptions/:id", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const rows = await sql`
      DELETE FROM subscriptions WHERE id = ${parsedId.data.id} AND user_id = ${req.user!.userId}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
}
