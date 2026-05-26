import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresClient } from "@stack/db-clients";
import { AuthClient } from "@stack/auth-client";
import { registerAuth } from "@stack/auth-client/fastify";
import { config } from "./config.js";
import { runMigrations } from "./migrate.js";

declare module "fastify" {
  interface FastifyRequest {
    householdId?: string;
    householdRole?: "owner" | "member";
  }
}

const pg = createPostgresClient({ url: config.databaseUrl, schema: "pantry" });

await runMigrations(pg);

const app = Fastify({ logger: true });
const { sql } = pg;

const auth = new AuthClient({
  authUrl: config.authUrl,
  cookieName: config.authCookieName,
  verifySecret: config.authVerifySecret,
});

const STATUS = z.enum(["stocked", "low", "out"]);
const TAG_KIND = z.enum(["store", "section", "general"]);
const idParam = z.object({ id: z.string().uuid() });

const INVITE_TTL_DAYS = 7;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest();

const apiRoutes = async (api: FastifyInstance) => {
  registerAuth(api, { client: auth });

  api.get("/health", async () => ({ ok: true }));

  // Resolve the caller's active household (if any) before pantry-data routes.
  api.addHook("preHandler", async (req) => {
    if (!req.user) return;
    const [row] = await sql<{ household_id: string | null; role: "owner" | "member" | null }[]>`
      SELECT us.active_household_id AS household_id, hm.role
      FROM user_settings us
      LEFT JOIN household_members hm
        ON hm.household_id = us.active_household_id
       AND hm.user_id = us.user_id
      WHERE us.user_id = ${req.user.userId}
    `;
    if (row && row.household_id && row.role) {
      req.householdId = row.household_id;
      req.householdRole = row.role;
    }
  });

  const requireHousehold = (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.householdId) {
      reply.code(409).send({ error: "NO_HOUSEHOLD" });
      return false;
    }
    return true;
  };

  // Look up membership without requiring it to be active.
  const memberRole = async (
    userId: string,
    householdId: string,
  ): Promise<"owner" | "member" | null> => {
    const [row] = await sql<{ role: "owner" | "member" }[]>`
      SELECT role FROM household_members
      WHERE user_id = ${userId} AND household_id = ${householdId}
    `;
    return row?.role ?? null;
  };

  // ---------- household management ----------

  api.get("/me/household", async (req) => {
    if (!req.householdId) return { household: null };
    const [h] = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM households WHERE id = ${req.householdId}
    `;
    if (!h) return { household: null };
    return { household: { ...h, role: req.householdRole } };
  });

  api.get("/households", async (req) => {
    return await sql`
      SELECT h.id, h.name, hm.role, hm.joined_at,
             (SELECT COUNT(*)::int FROM household_members m WHERE m.household_id = h.id) AS member_count,
             (h.id = (SELECT active_household_id FROM user_settings WHERE user_id = ${req.user!.userId})) AS active
      FROM households h
      JOIN household_members hm ON hm.household_id = h.id
      WHERE hm.user_id = ${req.user!.userId}
      ORDER BY h.name ASC
    `;
  });

  const createHouseholdBody = z.object({ name: z.string().min(1).max(80) });
  api.post("/households", async (req, reply) => {
    const parsed = createHouseholdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.user!.userId;

    const id = await sql.begin(async (tx) => {
      const [h] = await tx<{ id: string }[]>`
        INSERT INTO households (name) VALUES (${parsed.data.name}) RETURNING id
      `;
      await tx`
        INSERT INTO household_members (household_id, user_id, role)
        VALUES (${h.id}, ${userId}, 'owner')
      `;
      await tx`
        INSERT INTO user_settings (user_id, active_household_id)
        VALUES (${userId}, ${h.id})
        ON CONFLICT (user_id) DO UPDATE SET
          active_household_id = EXCLUDED.active_household_id,
          updated_at = now()
      `;
      return h.id;
    });

    return reply.code(201).send({ id });
  });

  const renameBody = z.object({ name: z.string().min(1).max(80) });
  api.patch("/households/:id", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const parsed = renameBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const role = await memberRole(req.user!.userId, parsedId.data.id);
    if (role !== "owner") return reply.code(403).send({ error: "owner only" });
    await sql`UPDATE households SET name = ${parsed.data.name} WHERE id = ${parsedId.data.id}`;
    return { ok: true };
  });

  api.delete("/households/:id", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const role = await memberRole(req.user!.userId, parsedId.data.id);
    if (role !== "owner") return reply.code(403).send({ error: "owner only" });
    // CASCADE handles members, invites, items, tags, grocery_lists.
    await sql`DELETE FROM households WHERE id = ${parsedId.data.id}`;
    return { ok: true };
  });

  api.post("/households/:id/activate", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const role = await memberRole(req.user!.userId, parsedId.data.id);
    if (!role) return reply.code(404).send({ error: "not a member" });
    await sql`
      INSERT INTO user_settings (user_id, active_household_id)
      VALUES (${req.user!.userId}, ${parsedId.data.id})
      ON CONFLICT (user_id) DO UPDATE SET
        active_household_id = EXCLUDED.active_household_id,
        updated_at = now()
    `;
    return { ok: true };
  });

  api.get("/households/:id/members", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const role = await memberRole(req.user!.userId, parsedId.data.id);
    if (!role) return reply.code(404).send({ error: "not a member" });
    return await sql`
      SELECT hm.user_id, hm.role, hm.joined_at, u.email, u.display_name
      FROM household_members hm
      JOIN shared.users u ON u.id = hm.user_id
      WHERE hm.household_id = ${parsedId.data.id}
      ORDER BY hm.joined_at ASC
    `;
  });

  api.delete("/households/:id/members/:userId", async (req, reply) => {
    const parsed = z
      .object({ id: z.string().uuid(), userId: z.string().uuid() })
      .safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const callerId = req.user!.userId;
    const callerRole = await memberRole(callerId, parsed.data.id);
    if (!callerRole) return reply.code(404).send({ error: "not a member" });

    const isSelf = parsed.data.userId === callerId;
    if (!isSelf && callerRole !== "owner") {
      return reply.code(403).send({ error: "owner only" });
    }

    const targetRole = await memberRole(parsed.data.userId, parsed.data.id);
    if (!targetRole) return reply.code(404).send({ error: "not a member" });

    await sql.begin(async (tx) => {
      await tx`
        DELETE FROM household_members
        WHERE household_id = ${parsed.data.id} AND user_id = ${parsed.data.userId}
      `;
      // If the leaver was the only member, drop the household entirely.
      const [remaining] = await tx<
        { user_id: string; role: "owner" | "member" }[]
      >`
        SELECT user_id, role FROM household_members
        WHERE household_id = ${parsed.data.id}
        ORDER BY joined_at ASC
        LIMIT 1
      `;
      if (!remaining) {
        await tx`DELETE FROM households WHERE id = ${parsed.data.id}`;
        return;
      }
      // Auto-promote longest-standing member if the owner left.
      if (targetRole === "owner" && remaining.role !== "owner") {
        await tx`
          UPDATE household_members SET role = 'owner'
          WHERE household_id = ${parsed.data.id} AND user_id = ${remaining.user_id}
        `;
      }
    });

    // If the removed user's active household pointed here, swap to another
    // membership (oldest first) or clear it.
    const [other] = await sql<{ household_id: string }[]>`
      SELECT household_id FROM household_members
      WHERE user_id = ${parsed.data.userId}
      ORDER BY joined_at ASC
      LIMIT 1
    `;
    await sql`
      UPDATE user_settings
      SET active_household_id = ${other?.household_id ?? null}, updated_at = now()
      WHERE user_id = ${parsed.data.userId}
        AND active_household_id = ${parsed.data.id}
    `;
    return { ok: true };
  });

  // ---------- invites ----------

  api.get("/households/:id/invites", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const role = await memberRole(req.user!.userId, parsedId.data.id);
    if (role !== "owner") return reply.code(403).send({ error: "owner only" });
    return await sql`
      SELECT id, created_at, expires_at
      FROM household_invites
      WHERE household_id = ${parsedId.data.id}
        AND accepted_at IS NULL
        AND expires_at > now()
      ORDER BY created_at DESC
    `;
  });

  api.post("/households/:id/invites", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const role = await memberRole(req.user!.userId, parsedId.data.id);
    if (role !== "owner") return reply.code(403).send({ error: "owner only" });

    const token = randomBytes(24).toString("base64url");
    const [row] = await sql<{ id: string; expires_at: string }[]>`
      INSERT INTO household_invites (household_id, token_hash, created_by, expires_at)
      VALUES (
        ${parsedId.data.id},
        ${hashToken(token)},
        ${req.user!.userId},
        now() + (${INVITE_TTL_DAYS} || ' days')::interval
      )
      RETURNING id, expires_at
    `;
    return reply.code(201).send({
      id: row.id,
      token,
      expiresAt: row.expires_at,
    });
  });

  api.delete("/households/:id/invites/:inviteId", async (req, reply) => {
    const parsed = z
      .object({ id: z.string().uuid(), inviteId: z.string().uuid() })
      .safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const role = await memberRole(req.user!.userId, parsed.data.id);
    if (role !== "owner") return reply.code(403).send({ error: "owner only" });
    await sql`
      DELETE FROM household_invites
      WHERE id = ${parsed.data.inviteId} AND household_id = ${parsed.data.id}
    `;
    return { ok: true };
  });

  // Public-ish: requires a valid login, but not active household membership.
  api.get("/invites/:token", async (req, reply) => {
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await sql<
      {
        household_name: string;
        inviter_name: string | null;
        inviter_email: string;
        expires_at: string;
        accepted_at: string | null;
      }[]
    >`
      SELECT h.name AS household_name,
             u.display_name AS inviter_name,
             u.email AS inviter_email,
             i.expires_at,
             i.accepted_at
      FROM household_invites i
      JOIN households h ON h.id = i.household_id
      JOIN shared.users u ON u.id = i.created_by
      WHERE i.token_hash = ${hashToken(parsed.data.token)}
    `;
    if (!row) return reply.code(404).send({ error: "invalid invite" });
    if (row.accepted_at) return reply.code(410).send({ error: "already used" });
    if (new Date(row.expires_at) <= new Date())
      return reply.code(410).send({ error: "expired" });
    return {
      householdName: row.household_name,
      inviterName: row.inviter_name ?? row.inviter_email,
      expiresAt: row.expires_at,
    };
  });

  api.post("/invites/:token/accept", async (req, reply) => {
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.user!.userId;

    const result = await sql.begin(async (tx) => {
      const [invite] = await tx<
        { id: string; household_id: string; expires_at: string; accepted_at: string | null }[]
      >`
        SELECT id, household_id, expires_at, accepted_at
        FROM household_invites
        WHERE token_hash = ${hashToken(parsed.data.token)}
        FOR UPDATE
      `;
      if (!invite) return { status: 404 as const, error: "invalid invite" };
      if (invite.accepted_at) return { status: 410 as const, error: "already used" };
      if (new Date(invite.expires_at) <= new Date())
        return { status: 410 as const, error: "expired" };

      await tx`
        INSERT INTO household_members (household_id, user_id, role)
        VALUES (${invite.household_id}, ${userId}, 'member')
        ON CONFLICT (household_id, user_id) DO NOTHING
      `;
      await tx`
        UPDATE household_invites
        SET accepted_at = now(), accepted_by = ${userId}
        WHERE id = ${invite.id}
      `;
      await tx`
        INSERT INTO user_settings (user_id, active_household_id)
        VALUES (${userId}, ${invite.household_id})
        ON CONFLICT (user_id) DO UPDATE SET
          active_household_id = EXCLUDED.active_household_id,
          updated_at = now()
      `;
      return { status: 200 as const, householdId: invite.household_id };
    });

    if (result.status !== 200) return reply.code(result.status).send({ error: result.error });
    return { householdId: result.householdId };
  });

  // ---------- items ----------

  api.get("/items", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const rows = await sql<
      {
        id: string;
        name: string;
        quantity: number;
        size: string | null;
        status: "stocked" | "low" | "out";
        notes: string | null;
        updated_at: string;
        tag_ids: string[];
      }[]
    >`
      SELECT i.id, i.name, i.quantity, i.size, i.status, i.notes, i.updated_at,
             COALESCE(
               (SELECT array_agg(it.tag_id::text) FROM item_tags it WHERE it.item_id = i.id),
               '{}'
             ) AS tag_ids
      FROM items i
      WHERE i.household_id = ${req.householdId!}
      ORDER BY i.name ASC
    `;
    return rows;
  });

  const itemBody = z.object({
    name: z.string().min(1).max(200),
    quantity: z.number().int().min(0).optional(),
    size: z.string().max(80).nullable().optional(),
    status: STATUS.optional(),
    notes: z.string().max(2000).nullable().optional(),
    tagIds: z.array(z.string().uuid()).optional(),
  });

  api.post("/items", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsed = itemBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const a = parsed.data;
    const hid = req.householdId!;

    try {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO items (household_id, name, quantity, size, status, notes)
        VALUES (${hid}, ${a.name}, ${a.quantity ?? 1}, ${a.size ?? null},
                ${a.status ?? "stocked"}, ${a.notes ?? null})
        RETURNING id
      `;
      if (a.tagIds && a.tagIds.length) {
        await sql`
          INSERT INTO item_tags (item_id, tag_id)
          SELECT ${row.id}, t.id FROM tags t
          WHERE t.household_id = ${hid} AND t.id = ANY(${a.tagIds})
        `;
      }
      return reply.code(201).send({ id: row.id });
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === "23505") return reply.code(409).send({ error: "duplicate name" });
      throw e;
    }
  });

  const itemPatchBody = itemBody.partial();

  api.patch("/items/:id", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const parsed = itemPatchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const hid = req.householdId!;
    const a = parsed.data;

    const updates: ReturnType<typeof sql>[] = [];
    if (a.name !== undefined) updates.push(sql`name = ${a.name}`);
    if (a.quantity !== undefined) updates.push(sql`quantity = ${a.quantity}`);
    if (a.size !== undefined) updates.push(sql`size = ${a.size}`);
    if (a.status !== undefined) updates.push(sql`status = ${a.status}`);
    if (a.notes !== undefined) updates.push(sql`notes = ${a.notes}`);
    updates.push(sql`updated_at = now()`);

    let setClause = updates[0];
    for (let i = 1; i < updates.length; i++) setClause = sql`${setClause}, ${updates[i]}`;

    const rows = await sql`
      UPDATE items SET ${setClause}
      WHERE id = ${parsedId.data.id} AND household_id = ${hid}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });

    if (a.tagIds !== undefined) {
      await sql`DELETE FROM item_tags WHERE item_id = ${parsedId.data.id}`;
      if (a.tagIds.length) {
        await sql`
          INSERT INTO item_tags (item_id, tag_id)
          SELECT ${parsedId.data.id}, t.id FROM tags t
          WHERE t.household_id = ${hid} AND t.id = ANY(${a.tagIds})
        `;
      }
    }
    return { ok: true };
  });

  const statusBody = z.object({ status: STATUS });
  api.post("/items/:id/status", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const parsed = statusBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const rows = await sql`
      UPDATE items SET status = ${parsed.data.status}, updated_at = now()
      WHERE id = ${parsedId.data.id} AND household_id = ${req.householdId!}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  api.delete("/items/:id", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const rows = await sql`
      DELETE FROM items WHERE id = ${parsedId.data.id} AND household_id = ${req.householdId!}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  // ---------- tags ----------

  api.get("/tags", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    return await sql`
      SELECT id, name, kind, color
      FROM tags WHERE household_id = ${req.householdId!}
      ORDER BY kind ASC, name ASC
    `;
  });

  const tagBody = z.object({
    name: z.string().min(1).max(80),
    kind: TAG_KIND,
    color: z.string().max(20).nullable().optional(),
  });

  api.post("/tags", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsed = tagBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const a = parsed.data;
    try {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO tags (household_id, name, kind, color)
        VALUES (${req.householdId!}, ${a.name}, ${a.kind}, ${a.color ?? null})
        RETURNING id
      `;
      return reply.code(201).send({ id: row.id });
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === "23505") return reply.code(409).send({ error: "duplicate tag" });
      throw e;
    }
  });

  const tagPatchBody = tagBody.partial();
  api.patch("/tags/:id", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const parsed = tagPatchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const a = parsed.data;

    const updates: ReturnType<typeof sql>[] = [];
    if (a.name !== undefined) updates.push(sql`name = ${a.name}`);
    if (a.kind !== undefined) updates.push(sql`kind = ${a.kind}`);
    if (a.color !== undefined) updates.push(sql`color = ${a.color}`);
    if (updates.length === 0) return { ok: true };

    let setClause = updates[0];
    for (let i = 1; i < updates.length; i++) setClause = sql`${setClause}, ${updates[i]}`;
    const rows = await sql`
      UPDATE tags SET ${setClause}
      WHERE id = ${parsedId.data.id} AND household_id = ${req.householdId!}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  api.delete("/tags/:id", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const rows = await sql`
      DELETE FROM tags WHERE id = ${parsedId.data.id} AND household_id = ${req.householdId!}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  // ---------- grocery lists ----------

  api.get("/lists", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    return await sql`
      SELECT l.id, l.name, l.status, l.created_at, l.completed_at,
             (SELECT COUNT(*)::int FROM grocery_list_items li WHERE li.list_id = l.id) AS item_count,
             (SELECT COUNT(*)::int FROM grocery_list_items li WHERE li.list_id = l.id AND li.checked_off) AS checked_count
      FROM grocery_lists l
      WHERE l.household_id = ${req.householdId!}
      ORDER BY l.created_at DESC
      LIMIT 100
    `;
  });

  const newListBody = z.object({
    name: z.string().min(1).max(120).optional(),
    itemIds: z.array(z.string().uuid()).default([]),
    extras: z
      .array(
        z.object({ name: z.string().min(1).max(200), quantity: z.number().int().min(1).default(1) }),
      )
      .default([]),
  });

  api.post("/lists", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsed = newListBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const hid = req.householdId!;
    const a = parsed.data;
    const name = a.name ?? new Date().toISOString().slice(0, 10) + " list";

    const listId = await sql.begin(async (tx) => {
      const [list] = await tx<{ id: string }[]>`
        INSERT INTO grocery_lists (household_id, name) VALUES (${hid}, ${name}) RETURNING id
      `;
      if (a.itemIds.length) {
        await tx`
          INSERT INTO grocery_list_items (list_id, item_id, name_snapshot, quantity)
          SELECT ${list.id}, i.id, i.name, 1
          FROM items i
          WHERE i.household_id = ${hid} AND i.id = ANY(${a.itemIds})
        `;
      }
      for (const extra of a.extras) {
        await tx`
          INSERT INTO grocery_list_items (list_id, item_id, name_snapshot, quantity)
          VALUES (${list.id}, NULL, ${extra.name}, ${extra.quantity})
        `;
      }
      return list.id;
    });

    return reply.code(201).send({ id: listId });
  });

  api.get("/lists/:id", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const [list] = await sql<
      { id: string; name: string; status: string; created_at: string; completed_at: string | null }[]
    >`
      SELECT id, name, status, created_at, completed_at
      FROM grocery_lists WHERE id = ${parsedId.data.id} AND household_id = ${req.householdId!}
    `;
    if (!list) return reply.code(404).send({ error: "not found" });
    const items = await sql`
      SELECT li.id, li.item_id, li.name_snapshot, li.quantity, li.checked_off,
             i.status AS item_status,
             COALESCE(
               (SELECT array_agg(t.name ORDER BY t.kind, t.name)
                FROM item_tags it JOIN tags t ON t.id = it.tag_id
                WHERE it.item_id = li.item_id AND t.kind = 'section'),
               '{}'
             ) AS sections,
             COALESCE(
               (SELECT array_agg(t.name ORDER BY t.name)
                FROM item_tags it JOIN tags t ON t.id = it.tag_id
                WHERE it.item_id = li.item_id AND t.kind = 'store'),
               '{}'
             ) AS stores
      FROM grocery_list_items li
      LEFT JOIN items i ON i.id = li.item_id
      WHERE li.list_id = ${list.id}
      ORDER BY li.created_at ASC
    `;
    return { ...list, items };
  });

  const addListItemBody = z.object({
    itemId: z.string().uuid().nullable().optional(),
    name: z.string().min(1).max(200).optional(),
    quantity: z.number().int().min(1).optional(),
  });

  api.post("/lists/:id/items", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const parsed = addListItemBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const hid = req.householdId!;
    const a = parsed.data;

    const [list] = await sql<{ id: string }[]>`
      SELECT id FROM grocery_lists WHERE id = ${parsedId.data.id} AND household_id = ${hid}
    `;
    if (!list) return reply.code(404).send({ error: "not found" });

    let snapshot = a.name;
    if (a.itemId) {
      const [item] = await sql<{ name: string }[]>`
        SELECT name FROM items WHERE id = ${a.itemId} AND household_id = ${hid}
      `;
      if (!item) return reply.code(404).send({ error: "item not found" });
      snapshot = snapshot ?? item.name;
    }
    if (!snapshot) return reply.code(400).send({ error: "name required for ad-hoc item" });

    const [row] = await sql<{ id: string }[]>`
      INSERT INTO grocery_list_items (list_id, item_id, name_snapshot, quantity)
      VALUES (${list.id}, ${a.itemId ?? null}, ${snapshot}, ${a.quantity ?? 1})
      RETURNING id
    `;
    return reply.code(201).send({ id: row.id });
  });

  const patchListItemBody = z.object({
    checkedOff: z.boolean().optional(),
    quantity: z.number().int().min(0).optional(),
  });

  api.patch("/lists/:id/items/:lid", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsed = z
      .object({ id: z.string().uuid(), lid: z.string().uuid() })
      .safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const parsedBody = patchListItemBody.safeParse(req.body);
    if (!parsedBody.success) return reply.code(400).send({ error: parsedBody.error.flatten() });
    const a = parsedBody.data;

    const updates: ReturnType<typeof sql>[] = [];
    if (a.checkedOff !== undefined) updates.push(sql`checked_off = ${a.checkedOff}`);
    if (a.quantity !== undefined) updates.push(sql`quantity = ${a.quantity}`);
    if (updates.length === 0) return { ok: true };
    let setClause = updates[0];
    for (let i = 1; i < updates.length; i++) setClause = sql`${setClause}, ${updates[i]}`;

    const rows = await sql`
      UPDATE grocery_list_items SET ${setClause}
      WHERE id = ${parsed.data.lid}
        AND list_id IN (SELECT id FROM grocery_lists WHERE id = ${parsed.data.id} AND household_id = ${req.householdId!})
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  api.delete("/lists/:id/items/:lid", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsed = z
      .object({ id: z.string().uuid(), lid: z.string().uuid() })
      .safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const rows = await sql`
      DELETE FROM grocery_list_items
      WHERE id = ${parsed.data.lid}
        AND list_id IN (SELECT id FROM grocery_lists WHERE id = ${parsed.data.id} AND household_id = ${req.householdId!})
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  const finishBody = z.object({
    updates: z
      .array(
        z.object({
          listItemId: z.string().uuid(),
          quantity: z.number().int().min(0).default(1),
        }),
      )
      .default([]),
  });

  api.post("/lists/:id/finish", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const parsed = finishBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const hid = req.householdId!;

    await sql.begin(async (tx) => {
      const [list] = await tx<{ id: string }[]>`
        SELECT id FROM grocery_lists
        WHERE id = ${parsedId.data.id} AND household_id = ${hid}
      `;
      if (!list) throw new Error("not found");

      const explicit = new Map(parsed.data.updates.map((u) => [u.listItemId, u.quantity]));
      const checked = await tx<
        { id: string; item_id: string | null }[]
      >`SELECT id, item_id FROM grocery_list_items WHERE list_id = ${list.id} AND checked_off = true`;

      for (const row of checked) {
        const qty = explicit.has(row.id) ? explicit.get(row.id)! : 1;
        await tx`UPDATE grocery_list_items SET quantity = ${qty} WHERE id = ${row.id}`;
        if (row.item_id) {
          await tx`
            UPDATE items
            SET quantity = ${qty}, status = 'stocked', updated_at = now()
            WHERE id = ${row.item_id} AND household_id = ${hid}
          `;
        }
      }

      await tx`
        UPDATE grocery_lists SET status = 'completed', completed_at = now()
        WHERE id = ${list.id}
      `;
    });
    return { ok: true };
  });

  api.delete("/lists/:id", async (req, reply) => {
    if (!requireHousehold(req, reply)) return;
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const rows = await sql`
      DELETE FROM grocery_lists WHERE id = ${parsedId.data.id} AND household_id = ${req.householdId!}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
};

await app.register(apiRoutes, { prefix: "/api" });

await app.register(fastifyHttpProxy, {
  upstream: config.authUrl,
  prefix: "/auth",
  rewritePrefix: "",
});

app.get("/health", async () => ({ ok: true }));

const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
await app.register(fastifyStatic, { root: webDist });
app.setNotFoundHandler((req, reply) => {
  if (req.method !== "GET" || req.url.startsWith("/api") || req.url.startsWith("/auth")) {
    return reply.code(404).send({ error: "not found" });
  }
  return reply.sendFile("index.html");
});

const shutdown = async () => {
  await app.close();
  await pg.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
