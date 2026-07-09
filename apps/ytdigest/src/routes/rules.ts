import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type postgres from "postgres";

const idParam = z.object({ id: z.string().uuid() });

const conditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("keyword"),
      field: z.enum(["title", "description"]),
      match: z.enum(["any", "all", "none"]),
      terms: z.array(z.string().min(1)).min(1),
    }),
    z.object({
      type: z.literal("performance"),
      metric: z.literal("views_per_hour"),
      comparedTo: z.literal("channel_baseline"),
      threshold: z.number().positive(),
    }),
    z.object({
      type: z.literal("engagement"),
      metric: z.literal("like_ratio"),
      comparedTo: z.literal("channel_baseline"),
      threshold: z.number().positive(),
    }),
    z.object({
      type: z.literal("duration"),
      min: z.number().int().min(0).optional(),
      max: z.number().int().min(0).optional(),
    }),
    ruleGroupSchema,
  ]),
);

const ruleGroupSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    op: z.enum(["AND", "OR"]),
    conditions: z.array(conditionSchema).min(1),
  }),
);

export function registerRuleRoutes(api: FastifyInstance, sql: postgres.Sql): void {
  api.get("/rules", async (req) => {
    return sql`
      SELECT id, scope, subscription_id, name, rule_json, enabled, created_at
      FROM criteria_rules
      WHERE user_id = ${req.user!.userId}
      ORDER BY created_at DESC
    `;
  });

  const createBody = z
    .object({
      scope: z.enum(["subscription", "global"]),
      subscriptionId: z.string().uuid().optional(),
      name: z.string().min(1).max(120),
      ruleJson: ruleGroupSchema,
      enabled: z.boolean().default(true),
    })
    .refine((b) => (b.scope === "subscription") === (b.subscriptionId !== undefined), {
      message: "subscriptionId is required for scope=subscription and forbidden for scope=global",
      path: ["subscriptionId"],
    });

  api.post("/rules", async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const a = parsed.data;

    const [row] = await sql<{ id: string }[]>`
      INSERT INTO criteria_rules (user_id, scope, subscription_id, name, rule_json, enabled)
      VALUES (${req.user!.userId}, ${a.scope}, ${a.subscriptionId ?? null}, ${a.name},
              ${JSON.stringify(a.ruleJson)}, ${a.enabled})
      RETURNING id
    `;
    return reply.code(201).send({ id: row.id });
  });

  const patchBody = z.object({
    name: z.string().min(1).max(120).optional(),
    ruleJson: ruleGroupSchema.optional(),
    enabled: z.boolean().optional(),
  });

  api.patch("/rules/:id", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const a = parsed.data;

    const updates: ReturnType<typeof sql>[] = [];
    if (a.name !== undefined) updates.push(sql`name = ${a.name}`);
    if (a.ruleJson !== undefined) updates.push(sql`rule_json = ${JSON.stringify(a.ruleJson)}`);
    if (a.enabled !== undefined) updates.push(sql`enabled = ${a.enabled}`);
    if (updates.length === 0) return { ok: true };

    let setClause = updates[0];
    for (let i = 1; i < updates.length; i++) setClause = sql`${setClause}, ${updates[i]}`;

    const rows = await sql`
      UPDATE criteria_rules SET ${setClause}
      WHERE id = ${parsedId.data.id} AND user_id = ${req.user!.userId}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  api.delete("/rules/:id", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const rows = await sql`
      DELETE FROM criteria_rules WHERE id = ${parsedId.data.id} AND user_id = ${req.user!.userId}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
}
