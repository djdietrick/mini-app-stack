import type { PostgresClient } from "@stack/db-clients";
import type { ItemStatus, ListItemRow, Role } from "../domain/types.js";
import type { PantryRepo } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === "23505";

/**
 * Self-hosted implementation. The SQL is lifted from the pre-refactor
 * apps/pantry/src/index.ts so wire responses stay byte-identical; unqualified
 * table names resolve into the `pantry` schema via search_path.
 */
export function createPostgresPantryRepo(pg: PostgresClient): PantryRepo {
  const { sql } = pg;

  const memberRole = async (userId: string, householdId: string): Promise<Role | null> => {
    // The members route accepts non-UUID ids because Firebase uids aren't
    // UUIDs. Here that id can't match anyone, and passing it to a uuid column
    // would raise an invalid-input error, i.e. a 500 instead of a 404.
    if (!UUID.test(userId)) return null;
    const [row] = await sql<{ role: Role }[]>`
      SELECT role FROM household_members
      WHERE user_id = ${userId} AND household_id = ${householdId}
    `;
    return row?.role ?? null;
  };

  /** Folds optional SET fragments into one clause, as the original handlers did. */
  const joinSet = (updates: ReturnType<typeof sql>[]) => {
    let setClause = updates[0];
    for (let i = 1; i < updates.length; i++) setClause = sql`${setClause}, ${updates[i]}`;
    return setClause;
  };

  return {
    // ---------- households ----------

    async activeHousehold(userId) {
      const [row] = await sql<{ household_id: string | null; role: Role | null }[]>`
        SELECT us.active_household_id AS household_id, hm.role
        FROM user_settings us
        LEFT JOIN household_members hm
          ON hm.household_id = us.active_household_id
         AND hm.user_id = us.user_id
        WHERE us.user_id = ${userId}
      `;
      if (row && row.household_id && row.role) {
        return { householdId: row.household_id, role: row.role };
      }
      return null;
    },

    memberRole,

    async getHousehold(householdId) {
      const [h] = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM households WHERE id = ${householdId}
      `;
      return h ?? null;
    },

    async listHouseholds(userId) {
      return await sql`
        SELECT h.id, h.name, hm.role, hm.joined_at,
               (SELECT COUNT(*)::int FROM household_members m WHERE m.household_id = h.id) AS member_count,
               (h.id = (SELECT active_household_id FROM user_settings WHERE user_id = ${userId})) AS active
        FROM households h
        JOIN household_members hm ON hm.household_id = h.id
        WHERE hm.user_id = ${userId}
        ORDER BY h.name ASC
      `;
    },

    async createHousehold(userId, name) {
      return await sql.begin(async (tx) => {
        const [h] = await tx<{ id: string }[]>`
          INSERT INTO households (name) VALUES (${name}) RETURNING id
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
    },

    async renameHousehold(householdId, name) {
      await sql`UPDATE households SET name = ${name} WHERE id = ${householdId}`;
    },

    async deleteHousehold(householdId) {
      // CASCADE handles members, invites, items, tags, grocery_lists.
      await sql`DELETE FROM households WHERE id = ${householdId}`;
    },

    async setActiveHousehold(userId, householdId) {
      await sql`
        INSERT INTO user_settings (user_id, active_household_id)
        VALUES (${userId}, ${householdId})
        ON CONFLICT (user_id) DO UPDATE SET
          active_household_id = EXCLUDED.active_household_id,
          updated_at = now()
      `;
    },

    async listMembers(householdId) {
      return await sql`
        SELECT hm.user_id, hm.role, hm.joined_at, u.email, u.display_name
        FROM household_members hm
        JOIN shared.users u ON u.id = hm.user_id
        WHERE hm.household_id = ${householdId}
        ORDER BY hm.joined_at ASC
      `;
    },

    async removeMember(householdId, userId, targetRole) {
      await sql.begin(async (tx) => {
        await tx`
          DELETE FROM household_members
          WHERE household_id = ${householdId} AND user_id = ${userId}
        `;
        // If the leaver was the only member, drop the household entirely.
        const [remaining] = await tx<{ user_id: string; role: Role }[]>`
          SELECT user_id, role FROM household_members
          WHERE household_id = ${householdId}
          ORDER BY joined_at ASC
          LIMIT 1
        `;
        if (!remaining) {
          await tx`DELETE FROM households WHERE id = ${householdId}`;
          return;
        }
        // Auto-promote longest-standing member if the owner left.
        if (targetRole === "owner" && remaining.role !== "owner") {
          await tx`
            UPDATE household_members SET role = 'owner'
            WHERE household_id = ${householdId} AND user_id = ${remaining.user_id}
          `;
        }
      });

      // If the removed user's active household pointed here, swap to another
      // membership (oldest first) or clear it.
      const [other] = await sql<{ household_id: string }[]>`
        SELECT household_id FROM household_members
        WHERE user_id = ${userId}
        ORDER BY joined_at ASC
        LIMIT 1
      `;
      await sql`
        UPDATE user_settings
        SET active_household_id = ${other?.household_id ?? null}, updated_at = now()
        WHERE user_id = ${userId}
          AND active_household_id = ${householdId}
      `;
    },

    // ---------- invites ----------

    async listInvites(householdId) {
      return await sql`
        SELECT id, created_at, expires_at
        FROM household_invites
        WHERE household_id = ${householdId}
          AND accepted_at IS NULL
          AND expires_at > now()
        ORDER BY created_at DESC
      `;
    },

    async createInvite(householdId, tokenHash, createdBy, ttlDays) {
      const [row] = await sql<{ id: string; expires_at: string }[]>`
        INSERT INTO household_invites (household_id, token_hash, created_by, expires_at)
        VALUES (
          ${householdId},
          ${tokenHash},
          ${createdBy},
          now() + (${ttlDays} || ' days')::interval
        )
        RETURNING id, expires_at
      `;
      return row;
    },

    async revokeInvite(householdId, inviteId) {
      await sql`
        DELETE FROM household_invites
        WHERE id = ${inviteId} AND household_id = ${householdId}
      `;
    },

    async previewInvite(tokenHash) {
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
        WHERE i.token_hash = ${tokenHash}
      `;
      return row ?? null;
    },

    async acceptInvite(tokenHash, userId) {
      return await sql.begin(async (tx) => {
        const [invite] = await tx<
          { id: string; household_id: string; expires_at: string; accepted_at: string | null }[]
        >`
          SELECT id, household_id, expires_at, accepted_at
          FROM household_invites
          WHERE token_hash = ${tokenHash}
          FOR UPDATE
        `;
        if (!invite) return { ok: false as const, reason: "invalid" as const };
        if (invite.accepted_at) return { ok: false as const, reason: "used" as const };
        if (new Date(invite.expires_at) <= new Date()) {
          return { ok: false as const, reason: "expired" as const };
        }

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
        return { ok: true as const, householdId: invite.household_id };
      });
    },

    // ---------- items ----------

    async listItems(householdId) {
      return await sql`
        SELECT i.id, i.name, i.quantity, i.size, i.status, i.notes, i.updated_at,
               COALESCE(
                 (SELECT array_agg(it.tag_id::text) FROM item_tags it WHERE it.item_id = i.id),
                 '{}'
               ) AS tag_ids
        FROM items i
        WHERE i.household_id = ${householdId}
        ORDER BY i.name ASC
      `;
    },

    async createItem(householdId, a) {
      try {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO items (household_id, name, quantity, size, status, notes)
          VALUES (${householdId}, ${a.name}, ${a.quantity ?? 1}, ${a.size ?? null},
                  ${a.status ?? "stocked"}, ${a.notes ?? null})
          RETURNING id
        `;
        if (a.tagIds && a.tagIds.length) {
          await sql`
            INSERT INTO item_tags (item_id, tag_id)
            SELECT ${row.id}, t.id FROM tags t
            WHERE t.household_id = ${householdId} AND t.id = ANY(${a.tagIds})
          `;
        }
        return row.id;
      } catch (e) {
        if (isUniqueViolation(e)) return null;
        throw e;
      }
    },

    async updateItem(householdId, id, a) {
      const updates: ReturnType<typeof sql>[] = [];
      if (a.name !== undefined) updates.push(sql`name = ${a.name}`);
      if (a.quantity !== undefined) updates.push(sql`quantity = ${a.quantity}`);
      if (a.size !== undefined) updates.push(sql`size = ${a.size}`);
      if (a.status !== undefined) updates.push(sql`status = ${a.status}`);
      if (a.notes !== undefined) updates.push(sql`notes = ${a.notes}`);
      updates.push(sql`updated_at = now()`);

      let rows;
      try {
        rows = await sql`
          UPDATE items SET ${joinSet(updates)}
          WHERE id = ${id} AND household_id = ${householdId}
          RETURNING id
        `;
      } catch (e) {
        if (isUniqueViolation(e)) return "duplicate";
        throw e;
      }
      if (rows.length === 0) return "not_found";

      if (a.tagIds !== undefined) {
        await sql`DELETE FROM item_tags WHERE item_id = ${id}`;
        if (a.tagIds.length) {
          await sql`
            INSERT INTO item_tags (item_id, tag_id)
            SELECT ${id}, t.id FROM tags t
            WHERE t.household_id = ${householdId} AND t.id = ANY(${a.tagIds})
          `;
        }
      }
      return "ok";
    },

    async setItemStatus(householdId, id, status: ItemStatus) {
      const rows = await sql`
        UPDATE items SET status = ${status}, updated_at = now()
        WHERE id = ${id} AND household_id = ${householdId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    async deleteItem(householdId, id) {
      const rows = await sql`
        DELETE FROM items WHERE id = ${id} AND household_id = ${householdId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    // ---------- tags ----------

    async listTags(householdId) {
      return await sql`
        SELECT id, name, kind, color
        FROM tags WHERE household_id = ${householdId}
        ORDER BY kind ASC, name ASC
      `;
    },

    async createTag(householdId, a) {
      try {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO tags (household_id, name, kind, color)
          VALUES (${householdId}, ${a.name}, ${a.kind}, ${a.color ?? null})
          RETURNING id
        `;
        return row.id;
      } catch (e) {
        if (isUniqueViolation(e)) return null;
        throw e;
      }
    },

    async updateTag(householdId, id, a) {
      const updates: ReturnType<typeof sql>[] = [];
      if (a.name !== undefined) updates.push(sql`name = ${a.name}`);
      if (a.kind !== undefined) updates.push(sql`kind = ${a.kind}`);
      if (a.color !== undefined) updates.push(sql`color = ${a.color}`);

      try {
        const rows = await sql`
          UPDATE tags SET ${joinSet(updates)}
          WHERE id = ${id} AND household_id = ${householdId}
          RETURNING id
        `;
        return rows.length === 0 ? "not_found" : "ok";
      } catch (e) {
        if (isUniqueViolation(e)) return "duplicate";
        throw e;
      }
    },

    async deleteTag(householdId, id) {
      const rows = await sql`
        DELETE FROM tags WHERE id = ${id} AND household_id = ${householdId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    // ---------- grocery lists ----------

    async listLists(householdId) {
      return await sql`
        SELECT l.id, l.name, l.status, l.created_at, l.completed_at,
               (SELECT COUNT(*)::int FROM grocery_list_items li WHERE li.list_id = l.id) AS item_count,
               (SELECT COUNT(*)::int FROM grocery_list_items li WHERE li.list_id = l.id AND li.checked_off) AS checked_count
        FROM grocery_lists l
        WHERE l.household_id = ${householdId}
        ORDER BY l.created_at DESC
        LIMIT 100
      `;
    },

    async createList(householdId, name, itemIds, extras) {
      return await sql.begin(async (tx) => {
        const [list] = await tx<{ id: string }[]>`
          INSERT INTO grocery_lists (household_id, name) VALUES (${householdId}, ${name}) RETURNING id
        `;
        if (itemIds.length) {
          await tx`
            INSERT INTO grocery_list_items (list_id, item_id, name_snapshot, quantity)
            SELECT ${list.id}, i.id, i.name, 1
            FROM items i
            WHERE i.household_id = ${householdId} AND i.id = ANY(${itemIds})
          `;
        }
        for (const extra of extras) {
          await tx`
            INSERT INTO grocery_list_items (list_id, item_id, name_snapshot, quantity)
            VALUES (${list.id}, NULL, ${extra.name}, ${extra.quantity})
          `;
        }
        return list.id;
      });
    },

    async getList(householdId, listId) {
      const [list] = await sql<
        {
          id: string;
          name: string;
          status: "active" | "completed";
          created_at: string;
          completed_at: string | null;
        }[]
      >`
        SELECT id, name, status, created_at, completed_at
        FROM grocery_lists WHERE id = ${listId} AND household_id = ${householdId}
      `;
      if (!list) return null;
      const items = await sql<ListItemRow[]>`
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
    },

    async listExists(householdId, listId) {
      const [list] = await sql<{ id: string }[]>`
        SELECT id FROM grocery_lists WHERE id = ${listId} AND household_id = ${householdId}
      `;
      return Boolean(list);
    },

    async itemName(householdId, itemId) {
      const [item] = await sql<{ name: string }[]>`
        SELECT name FROM items WHERE id = ${itemId} AND household_id = ${householdId}
      `;
      return item?.name ?? null;
    },

    async addListItem(listId, itemId, nameSnapshot, quantity) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO grocery_list_items (list_id, item_id, name_snapshot, quantity)
        VALUES (${listId}, ${itemId}, ${nameSnapshot}, ${quantity})
        RETURNING id
      `;
      return row.id;
    },

    async patchListItem(householdId, listId, listItemId, a) {
      const updates: ReturnType<typeof sql>[] = [];
      if (a.checkedOff !== undefined) updates.push(sql`checked_off = ${a.checkedOff}`);
      if (a.quantity !== undefined) updates.push(sql`quantity = ${a.quantity}`);

      const rows = await sql`
        UPDATE grocery_list_items SET ${joinSet(updates)}
        WHERE id = ${listItemId}
          AND list_id IN (SELECT id FROM grocery_lists WHERE id = ${listId} AND household_id = ${householdId})
        RETURNING id
      `;
      return rows.length > 0;
    },

    async deleteListItem(householdId, listId, listItemId) {
      const rows = await sql`
        DELETE FROM grocery_list_items
        WHERE id = ${listItemId}
          AND list_id IN (SELECT id FROM grocery_lists WHERE id = ${listId} AND household_id = ${householdId})
        RETURNING id
      `;
      return rows.length > 0;
    },

    async finishList(householdId, listId, quantities) {
      return await sql.begin(async (tx) => {
        const [list] = await tx<{ id: string }[]>`
          SELECT id FROM grocery_lists
          WHERE id = ${listId} AND household_id = ${householdId}
        `;
        if (!list) return false;

        const checked = await tx<
          { id: string; item_id: string | null }[]
        >`SELECT id, item_id FROM grocery_list_items WHERE list_id = ${list.id} AND checked_off = true`;

        for (const row of checked) {
          const qty = quantities.has(row.id) ? quantities.get(row.id)! : 1;
          await tx`UPDATE grocery_list_items SET quantity = ${qty} WHERE id = ${row.id}`;
          if (row.item_id) {
            await tx`
              UPDATE items
              SET quantity = ${qty}, status = 'stocked', updated_at = now()
              WHERE id = ${row.item_id} AND household_id = ${householdId}
            `;
          }
        }

        await tx`
          UPDATE grocery_lists SET status = 'completed', completed_at = now()
          WHERE id = ${list.id}
        `;
        return true;
      });
    },

    async deleteList(householdId, listId) {
      const rows = await sql`
        DELETE FROM grocery_lists WHERE id = ${listId} AND household_id = ${householdId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    async close() {
      await pg.close();
    },
  };
}
