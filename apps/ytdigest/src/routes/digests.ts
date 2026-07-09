import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type postgres from "postgres";
import type { Mailer } from "@stack/mailer";
import { sendDigest } from "../digest/sendDigest.js";

const idParam = z.object({ id: z.string().uuid() });

export function registerDigestRoutes(api: FastifyInstance, sql: postgres.Sql, mailer: Mailer): void {
  api.get("/digests", async (req) => {
    return sql`
      SELECT r.id, r.cadence, r.run_date, r.sent_at,
             (SELECT COUNT(*)::int FROM digest_items di WHERE di.digest_run_id = r.id) AS item_count
      FROM digest_runs r
      WHERE r.user_id = ${req.user!.userId}
      ORDER BY r.run_date DESC, r.created_at DESC
      LIMIT 50
    `;
  });

  api.get("/digests/:id", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const [run] = await sql`
      SELECT id, cadence, run_date, sent_at FROM digest_runs
      WHERE id = ${parsedId.data.id} AND user_id = ${req.user!.userId}
    `;
    if (!run) return reply.code(404).send({ error: "not found" });
    const items = await sql`
      SELECT di.video_id, v.title, v.thumbnail_url, c.title AS channel_title, di.matched_rule_id, di.reason_json
      FROM digest_items di
      JOIN videos v ON v.id = di.video_id
      JOIN channels c ON c.id = v.channel_id
      WHERE di.digest_run_id = ${run.id}
      ORDER BY c.title ASC
    `;
    return { ...run, items };
  });

  api.post("/digests/run-now", async (req) => {
    const result = await sendDigest(
      sql,
      mailer,
      req.user!.userId,
      req.user!.email,
      new Date(),
      true,
    );
    return result;
  });
}
