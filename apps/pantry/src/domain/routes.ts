import { createHash, randomBytes } from "node:crypto";
import {
  type AnyRoute,
  AppError,
  type SessionUser,
  badRequest,
  conflict,
  createRouteBuilder,
  forbidden,
  notFound,
} from "@stack/service-kit";
import { z } from "zod";
import type { PantryRepo } from "../repo/types.js";
import {
  type HouseholdScope,
  ITEM_STATUS,
  addListItemBody,
  finishBody,
  itemBody,
  itemPatchBody,
  newListBody,
  patchListItemBody,
  tagBody,
  tagPatchBody,
} from "./types.js";

/**
 * Every pantry endpoint, transport-free. Fastify serves this table
 * self-hosted; an Express-backed Firebase Function serves it in the cloud.
 *
 * Status codes and error bodies match what apps/pantry/web/src/api.ts has
 * always received, with three deliberate exceptions, each marked below:
 *   - removing a member accepts a non-UUID user id (Firebase uids aren't UUIDs)
 *   - renaming an item or tag onto an existing name is a 409, not a 500
 *   - finishing an unknown list is a 404, not a 500
 */

const route = createRouteBuilder<PantryRepo, HouseholdScope>();

const INVITE_TTL_DAYS = 7;

const idParam = z.object({ id: z.string().uuid() });
const tokenParam = z.object({ token: z.string().min(1) });
const nameBody = z.object({ name: z.string().min(1).max(80) });

const hashToken = (token: string) => createHash("sha256").update(token).digest();

/**
 * The adapters' resolveScope hook — what used to be pantry's preHandler.
 * Runs once per authenticated request, including household-management routes
 * that don't need it, exactly as the preHandler did.
 */
export const resolvePantryScope = (user: SessionUser, repo: PantryRepo) =>
  repo.activeHousehold(user.userId);

/** Data routes need an active household; the SPA sends users to onboarding on this 409. */
function requireHousehold(scope: HouseholdScope): string {
  if (!scope) throw conflict("NO_HOUSEHOLD");
  return scope.householdId;
}

async function requireOwner(repo: PantryRepo, userId: string, householdId: string) {
  if ((await repo.memberRole(userId, householdId)) !== "owner") throw forbidden("owner only");
}

async function requireMember(repo: PantryRepo, userId: string, householdId: string) {
  const role = await repo.memberRole(userId, householdId);
  if (!role) throw notFound("not a member");
  return role;
}

const ok = { ok: true } as const;
const created = () => 201;

export function pantryRoutes(): AnyRoute<PantryRepo, HouseholdScope>[] {
  return [
    route({
      method: "GET",
      path: "/health",
      public: true,
      handler: async () => ({ ok: true }),
    }),

    // ---------- household management ----------

    route({
      method: "GET",
      path: "/me/household",
      handler: async ({ repo, scope }) => {
        if (!scope) return { household: null };
        const h = await repo.getHousehold(scope.householdId);
        if (!h) return { household: null };
        return { household: { ...h, role: scope.role } };
      },
    }),

    route({
      method: "GET",
      path: "/households",
      handler: async ({ repo, user }) => repo.listHouseholds(user.userId),
    }),

    route({
      method: "POST",
      path: "/households",
      input: { body: nameBody },
      status: created,
      handler: async ({ repo, user }, { body }) => ({
        id: await repo.createHousehold(user.userId, body.name),
      }),
    }),

    route({
      method: "PATCH",
      path: "/households/:id",
      input: { params: idParam, body: nameBody },
      handler: async ({ repo, user }, { params, body }) => {
        await requireOwner(repo, user.userId, params.id);
        await repo.renameHousehold(params.id, body.name);
        return ok;
      },
    }),

    route({
      method: "DELETE",
      path: "/households/:id",
      input: { params: idParam },
      handler: async ({ repo, user }, { params }) => {
        await requireOwner(repo, user.userId, params.id);
        await repo.deleteHousehold(params.id);
        return ok;
      },
    }),

    route({
      method: "POST",
      path: "/households/:id/activate",
      input: { params: idParam },
      handler: async ({ repo, user }, { params }) => {
        await requireMember(repo, user.userId, params.id);
        await repo.setActiveHousehold(user.userId, params.id);
        return ok;
      },
    }),

    route({
      method: "GET",
      path: "/households/:id/members",
      input: { params: idParam },
      handler: async ({ repo, user }, { params }) => {
        await requireMember(repo, user.userId, params.id);
        return repo.listMembers(params.id);
      },
    }),

    route({
      method: "DELETE",
      path: "/households/:id/members/:userId",
      input: {
        params: z.object({
          id: z.string().uuid(),
          // Deliberately not .uuid(). Self-hosted user ids are UUIDs, but
          // Firebase Auth uids are 28-character strings, and this route has to
          // accept both. Firebase caps uids at 128 characters.
          userId: z.string().min(1).max(128),
        }),
      },
      handler: async ({ repo, user }, { params }) => {
        const callerRole = await requireMember(repo, user.userId, params.id);

        const isSelf = params.userId === user.userId;
        if (!isSelf && callerRole !== "owner") throw forbidden("owner only");

        const targetRole = await repo.memberRole(params.userId, params.id);
        if (!targetRole) throw notFound("not a member");

        await repo.removeMember(params.id, params.userId, targetRole);
        return ok;
      },
    }),

    // ---------- invites ----------

    route({
      method: "GET",
      path: "/households/:id/invites",
      input: { params: idParam },
      handler: async ({ repo, user }, { params }) => {
        await requireOwner(repo, user.userId, params.id);
        return repo.listInvites(params.id);
      },
    }),

    route({
      method: "POST",
      path: "/households/:id/invites",
      input: { params: idParam },
      status: created,
      handler: async ({ repo, user }, { params }) => {
        await requireOwner(repo, user.userId, params.id);
        // Only the hash is stored; the raw token exists in this response and
        // nowhere else.
        const token = randomBytes(24).toString("base64url");
        const row = await repo.createInvite(
          params.id,
          hashToken(token),
          user.userId,
          INVITE_TTL_DAYS,
        );
        return { id: row.id, token, expiresAt: row.expires_at };
      },
    }),

    route({
      method: "DELETE",
      path: "/households/:id/invites/:inviteId",
      input: { params: z.object({ id: z.string().uuid(), inviteId: z.string().uuid() }) },
      handler: async ({ repo, user }, { params }) => {
        await requireOwner(repo, user.userId, params.id);
        await repo.revokeInvite(params.id, params.inviteId);
        return ok;
      },
    }),

    // Requires a login, but not membership of anything.
    route({
      method: "GET",
      path: "/invites/:token",
      input: { params: tokenParam },
      handler: async ({ repo }, { params }) => {
        const row = await repo.previewInvite(hashToken(params.token));
        if (!row) throw notFound("invalid invite");
        if (row.accepted_at) throw new AppError(410, "already used");
        if (new Date(row.expires_at) <= new Date()) throw new AppError(410, "expired");
        return {
          householdName: row.household_name,
          inviterName: row.inviter_name ?? row.inviter_email,
          expiresAt: row.expires_at,
        };
      },
    }),

    route({
      method: "POST",
      path: "/invites/:token/accept",
      input: { params: tokenParam },
      handler: async ({ repo, user }, { params }) => {
        const result = await repo.acceptInvite(hashToken(params.token), user.userId);
        if (result.ok) return { householdId: result.householdId };
        if (result.reason === "invalid") throw notFound("invalid invite");
        throw new AppError(410, result.reason === "used" ? "already used" : "expired");
      },
    }),

    // ---------- items ----------

    route({
      method: "GET",
      path: "/items",
      handler: async ({ repo, scope }) => repo.listItems(requireHousehold(scope)),
    }),

    route({
      method: "POST",
      path: "/items",
      input: { body: itemBody },
      status: created,
      handler: async ({ repo, scope }, { body }) => {
        const id = await repo.createItem(requireHousehold(scope), body);
        if (!id) throw conflict("duplicate name");
        return { id };
      },
    }),

    route({
      method: "PATCH",
      path: "/items/:id",
      input: { params: idParam, body: itemPatchBody },
      handler: async ({ repo, scope }, { params, body }) => {
        const result = await repo.updateItem(requireHousehold(scope), params.id, body);
        if (result === "not_found") throw notFound();
        // Previously an unhandled unique violation, i.e. a 500. Same body as POST.
        if (result === "duplicate") throw conflict("duplicate name");
        return ok;
      },
    }),

    route({
      method: "POST",
      path: "/items/:id/status",
      input: { params: idParam, body: z.object({ status: ITEM_STATUS }) },
      handler: async ({ repo, scope }, { params, body }) => {
        if (!(await repo.setItemStatus(requireHousehold(scope), params.id, body.status))) {
          throw notFound();
        }
        return ok;
      },
    }),

    route({
      method: "DELETE",
      path: "/items/:id",
      input: { params: idParam },
      handler: async ({ repo, scope }, { params }) => {
        if (!(await repo.deleteItem(requireHousehold(scope), params.id))) throw notFound();
        return ok;
      },
    }),

    // ---------- tags ----------

    route({
      method: "GET",
      path: "/tags",
      handler: async ({ repo, scope }) => repo.listTags(requireHousehold(scope)),
    }),

    route({
      method: "POST",
      path: "/tags",
      input: { body: tagBody },
      status: created,
      handler: async ({ repo, scope }, { body }) => {
        const id = await repo.createTag(requireHousehold(scope), body);
        if (!id) throw conflict("duplicate tag");
        return { id };
      },
    }),

    route({
      method: "PATCH",
      path: "/tags/:id",
      input: { params: idParam, body: tagPatchBody },
      handler: async ({ repo, scope }, { params, body }) => {
        const householdId = requireHousehold(scope);
        // An empty patch succeeds without checking the tag exists, as it always has.
        if (body.name === undefined && body.kind === undefined && body.color === undefined) {
          return ok;
        }
        const result = await repo.updateTag(householdId, params.id, body);
        if (result === "not_found") throw notFound();
        // Previously an unhandled unique violation, i.e. a 500. Same body as POST.
        if (result === "duplicate") throw conflict("duplicate tag");
        return ok;
      },
    }),

    route({
      method: "DELETE",
      path: "/tags/:id",
      input: { params: idParam },
      handler: async ({ repo, scope }, { params }) => {
        if (!(await repo.deleteTag(requireHousehold(scope), params.id))) throw notFound();
        return ok;
      },
    }),

    // ---------- grocery lists ----------

    route({
      method: "GET",
      path: "/lists",
      handler: async ({ repo, scope }) => repo.listLists(requireHousehold(scope)),
    }),

    route({
      method: "POST",
      path: "/lists",
      input: { body: newListBody },
      status: created,
      handler: async ({ repo, scope }, { body }) => {
        const householdId = requireHousehold(scope);
        const name = body.name ?? new Date().toISOString().slice(0, 10) + " list";
        return { id: await repo.createList(householdId, name, body.itemIds, body.extras) };
      },
    }),

    route({
      method: "GET",
      path: "/lists/:id",
      input: { params: idParam },
      handler: async ({ repo, scope }, { params }) => {
        const list = await repo.getList(requireHousehold(scope), params.id);
        if (!list) throw notFound();
        return list;
      },
    }),

    route({
      method: "POST",
      path: "/lists/:id/items",
      input: { params: idParam, body: addListItemBody },
      status: created,
      handler: async ({ repo, scope }, { params, body }) => {
        const householdId = requireHousehold(scope);
        if (!(await repo.listExists(householdId, params.id))) throw notFound();

        let snapshot = body.name;
        if (body.itemId) {
          const itemName = await repo.itemName(householdId, body.itemId);
          if (itemName === null) throw notFound("item not found");
          snapshot = snapshot ?? itemName;
        }
        if (!snapshot) throw badRequest("name required for ad-hoc item");

        const id = await repo.addListItem(
          params.id,
          body.itemId ?? null,
          snapshot,
          body.quantity ?? 1,
        );
        return { id };
      },
    }),

    route({
      method: "PATCH",
      path: "/lists/:id/items/:lid",
      input: {
        params: z.object({ id: z.string().uuid(), lid: z.string().uuid() }),
        body: patchListItemBody,
      },
      handler: async ({ repo, scope }, { params, body }) => {
        const householdId = requireHousehold(scope);
        if (body.checkedOff === undefined && body.quantity === undefined) return ok;
        if (!(await repo.patchListItem(householdId, params.id, params.lid, body))) {
          throw notFound();
        }
        return ok;
      },
    }),

    route({
      method: "DELETE",
      path: "/lists/:id/items/:lid",
      input: { params: z.object({ id: z.string().uuid(), lid: z.string().uuid() }) },
      handler: async ({ repo, scope }, { params }) => {
        if (!(await repo.deleteListItem(requireHousehold(scope), params.id, params.lid))) {
          throw notFound();
        }
        return ok;
      },
    }),

    route({
      method: "POST",
      path: "/lists/:id/finish",
      input: { params: idParam, body: finishBody },
      handler: async ({ repo, scope }, { params, body }) => {
        const householdId = requireHousehold(scope);
        const quantities = new Map(body.updates.map((u) => [u.listItemId, u.quantity]));
        // Previously `throw new Error("not found")` inside the transaction,
        // which surfaced as a 500.
        if (!(await repo.finishList(householdId, params.id, quantities))) throw notFound();
        return ok;
      },
    }),

    route({
      method: "DELETE",
      path: "/lists/:id",
      input: { params: idParam },
      handler: async ({ repo, scope }, { params }) => {
        if (!(await repo.deleteList(requireHousehold(scope), params.id))) throw notFound();
        return ok;
      },
    }),
  ];
}
