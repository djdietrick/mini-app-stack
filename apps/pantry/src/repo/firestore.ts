import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "@google-cloud/firestore";
import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
  WriteBatch,
} from "@google-cloud/firestore";
import type {
  ItemRow,
  ItemStatus,
  ListItemRow,
  Role,
  TagKind,
  TagRow,
} from "../domain/types.js";
import type { PantryRepo } from "./types.js";

/**
 * Cloud implementation.
 *
 * Document layout (each prefixed `pantry_`):
 *   households/{uuid}                     name
 *   household_members/{householdId}_{uid}  deterministic id = the old composite PK
 *   user_settings/{uid}                   activeHouseholdId
 *   household_invites/{uuid}              tokenHash is the hex SHA-256; the raw token is never stored
 *   items/{uuid}                          tagIds[] replaces the item_tags join table
 *   tags/{uuid}
 *   lists/{uuid}                          entries[] replaces grocery_list_items
 * plus the unprefixed `users/{uid}` mirror the auth function maintains, which
 * stands in for shared.users.
 *
 * What Postgres gave for free and this file has to do by hand:
 *
 * - UNIQUE (household_id, name) on items and (household_id, kind, name) on
 *   tags. Names are citext, so uniqueness is case-insensitive. Each doc carries
 *   a lowercased `nameKey`, and the duplicate check and the write share a
 *   transaction.
 *
 * - ON DELETE CASCADE / SET NULL. Deleting a household deletes its documents
 *   explicitly (cascadeDelete); deleting a tag strips it from items. The one
 *   SET NULL that isn't eager is a list entry's link to a deleted item. getList
 *   reports the link as null when the item no longer exists, which is what
 *   the SQL's SET NULL produced, without scanning every list on each delete.
 *
 * - Joins. List entries are embedded in their list document rather than kept
 *   in a separate collection. A grocery list is small, is always read whole,
 *   and "finish" must update it atomically, so one document fits better than
 *   a collection with per-list counts to maintain. Array order is insertion
 *   order, which is the SQL's ORDER BY created_at.
 *
 * Document ids are app-generated UUIDs so `z.string().uuid()` on route params
 * holds on both backends.
 */
export interface FirestorePantryOptions {
  /** Collection prefix. Tests pass a unique one per run. */
  prefix?: string;
  /** The auth function's user mirror; the equivalent of shared.users. */
  usersCollection?: string;
}

interface HouseholdDoc {
  name: string;
  createdAt: Timestamp;
}

interface MemberDoc {
  householdId: string;
  userId: string;
  role: Role;
  joinedAt: Timestamp;
}

interface SettingsDoc {
  activeHouseholdId: string | null;
  updatedAt: Timestamp;
}

interface InviteDoc {
  householdId: string;
  tokenHash: string;
  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  acceptedAt: Timestamp | null;
  acceptedBy: string | null;
}

interface ItemDoc {
  householdId: string;
  name: string;
  nameKey: string;
  quantity: number;
  size: string | null;
  status: ItemStatus;
  notes: string | null;
  tagIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface TagDoc {
  householdId: string;
  name: string;
  nameKey: string;
  kind: TagKind;
  color: string | null;
  createdAt: Timestamp;
}

interface ListEntry {
  id: string;
  itemId: string | null;
  nameSnapshot: string;
  quantity: number;
  checkedOff: boolean;
}

interface ListDoc {
  householdId: string;
  name: string;
  status: "active" | "completed";
  createdAt: Timestamp;
  completedAt: Timestamp | null;
  entries: ListEntry[];
}

interface UserDoc {
  email?: string | null;
  displayName?: string | null;
}

/** citext compares via lower(); this is the same comparison key. */
const nameKey = (name: string) => name.toLowerCase();

const iso = (t: Timestamp) => t.toDate().toISOString();
const isoOrNull = (t: Timestamp | null) => (t ? iso(t) : null);

/** ORDER BY on a citext column: case-insensitive, then locale order. */
const byNameKey = (a: { nameKey: string }, b: { nameKey: string }) =>
  a.nameKey.localeCompare(b.nameKey);

/** A batch commits at most 500 writes. */
const BATCH_LIMIT = 500;

const isNotFound = (e: unknown) => (e as { code?: number }).code === 5;

export function createFirestorePantryRepo(
  db: Firestore,
  { prefix = "pantry_", usersCollection = "users" }: FirestorePantryOptions = {},
): PantryRepo {
  const households = db.collection(`${prefix}households`);
  const members = db.collection(`${prefix}household_members`);
  const settings = db.collection(`${prefix}user_settings`);
  const invites = db.collection(`${prefix}household_invites`);
  const items = db.collection(`${prefix}items`);
  const tags = db.collection(`${prefix}tags`);
  const lists = db.collection(`${prefix}lists`);
  const users = db.collection(usersCollection);

  const memberRef = (householdId: string, userId: string) =>
    members.doc(`${householdId}_${userId}`);

  /** Reads a doc and returns its data only if it belongs to this household. */
  function owned<T extends { householdId: string }>(
    snap: DocumentSnapshot,
    householdId: string,
  ): T | null {
    if (!snap.exists) return null;
    const data = snap.data() as T;
    return data.householdId === householdId ? data : null;
  }

  /**
   * Read-check-write on one household-scoped doc, mirroring
   * `UPDATE/DELETE ... WHERE id = $1 AND household_id = $2 RETURNING id`.
   * `patch` returns the update, or null to delete.
   */
  async function mutate<T extends { householdId: string }>(
    ref: DocumentReference,
    householdId: string,
    patch: (doc: T) => Partial<T> | null,
  ): Promise<boolean> {
    return db.runTransaction(async (tx) => {
      const doc = owned<T>(await tx.get(ref), householdId);
      if (!doc) return false;
      const update = patch(doc);
      if (update === null) tx.delete(ref);
      else tx.update(ref, update as Record<string, unknown>);
      return true;
    });
  }

  /** Commits writes in chunks, because a batch caps at 500. Not atomic across chunks. */
  async function commitInChunks(
    writes: ((batch: WriteBatch) => void)[],
  ): Promise<void> {
    for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const w of writes.slice(i, i + BATCH_LIMIT)) w(batch);
      await batch.commit();
    }
  }

  /**
   * The ON DELETE CASCADE / SET NULL that Postgres runs when a household row
   * goes. Not atomic, since a household can hold more than one transaction's
   * worth of documents. It runs in an order that is safe to stop partway:
   * memberships go first, so access is cut before the data goes, and the
   * household doc goes last. Re-running it after a failure finishes the job.
   */
  async function cascadeDelete(householdId: string): Promise<void> {
    const now = Timestamp.now();
    const [pointing, memberSnap] = await Promise.all([
      settings.where("activeHouseholdId", "==", householdId).get(),
      members.where("householdId", "==", householdId).get(),
    ]);
    await commitInChunks([
      ...pointing.docs.map((d) => (b: WriteBatch) =>
        b.update(d.ref, { activeHouseholdId: null, updatedAt: now }),
      ),
      ...memberSnap.docs.map((d) => (b: WriteBatch) => b.delete(d.ref)),
    ]);

    const scoped = await Promise.all(
      [invites, items, tags, lists].map((c) => c.where("householdId", "==", householdId).get()),
    );
    await commitInChunks(
      scoped.flatMap((snap) =>
        snap.docs.map((d) => (b: WriteBatch) => b.delete(d.ref)),
      ),
    );

    await households.doc(householdId).delete();
  }

  /**
   * `INSERT INTO item_tags ... SELECT FROM tags WHERE household_id = $1 AND
   * id = ANY($2)`: keeps only ids naming this household's tags, once each.
   * Transactional so it counts as a read before the item write.
   */
  async function validTagIds(
    tx: Transaction,
    householdId: string,
    ids: string[],
  ): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const snaps = await tx.getAll(...unique.map((id) => tags.doc(id)));
    return snaps.filter((s) => owned<TagDoc>(s, householdId)).map((s) => s.id);
  }

  /** True if another item in the household already uses this name. */
  async function itemNameTaken(
    tx: Transaction,
    householdId: string,
    key: string,
    exceptId?: string,
  ): Promise<boolean> {
    const snap = await tx.get(
      items.where("householdId", "==", householdId).where("nameKey", "==", key).limit(2),
    );
    return snap.docs.some((d) => d.id !== exceptId);
  }

  async function tagNameTaken(
    tx: Transaction,
    householdId: string,
    kind: TagKind,
    key: string,
    exceptId?: string,
  ): Promise<boolean> {
    const snap = await tx.get(
      tags
        .where("householdId", "==", householdId)
        .where("kind", "==", kind)
        .where("nameKey", "==", key)
        .limit(2),
    );
    return snap.docs.some((d) => d.id !== exceptId);
  }

  const toItemRow = (id: string, d: ItemDoc): ItemRow => ({
    id,
    name: d.name,
    quantity: d.quantity,
    size: d.size,
    status: d.status,
    notes: d.notes,
    updated_at: iso(d.updatedAt),
    tag_ids: d.tagIds,
  });

  /**
   * Read-modify-write of one list's embedded entries. `edit` returns false when
   * the entry isn't there, which is the route's 404.
   */
  async function editEntries(
    householdId: string,
    listId: string,
    edit: (entries: ListEntry[]) => boolean,
  ): Promise<boolean> {
    const ref = lists.doc(listId);
    return db.runTransaction(async (tx) => {
      const list = owned<ListDoc>(await tx.get(ref), householdId);
      if (!list) return false;
      const entries = list.entries.map((e) => ({ ...e }));
      if (!edit(entries)) return false;
      tx.update(ref, { entries });
      return true;
    });
  }

  return {
    // ---------- households ----------

    async activeHousehold(userId) {
      const s = await settings.doc(userId).get();
      const activeId = (s.data() as SettingsDoc | undefined)?.activeHouseholdId;
      if (!activeId) return null;
      const m = await memberRef(activeId, userId).get();
      if (!m.exists) return null;
      return { householdId: activeId, role: (m.data() as MemberDoc).role };
    },

    async memberRole(userId, householdId) {
      const m = await memberRef(householdId, userId).get();
      return m.exists ? (m.data() as MemberDoc).role : null;
    },

    async getHousehold(householdId) {
      const h = await households.doc(householdId).get();
      return h.exists ? { id: h.id, name: (h.data() as HouseholdDoc).name } : null;
    },

    async listHouseholds(userId) {
      const [mine, s] = await Promise.all([
        members.where("userId", "==", userId).get(),
        settings.doc(userId).get(),
      ]);
      if (mine.empty) return [];
      const activeId = (s.data() as SettingsDoc | undefined)?.activeHouseholdId ?? null;

      const memberships = mine.docs.map((d) => d.data() as MemberDoc);
      const [hSnaps, counts] = await Promise.all([
        db.getAll(...memberships.map((m) => households.doc(m.householdId))),
        Promise.all(
          memberships.map((m) =>
            members.where("householdId", "==", m.householdId).count().get(),
          ),
        ),
      ]);

      return memberships
        .map((m, i) => ({ m, h: hSnaps[i], count: counts[i].data().count }))
        .filter(({ h }) => h.exists) // the JOIN on households
        .map(({ m, h, count }) => ({
          id: m.householdId,
          name: (h.data() as HouseholdDoc).name,
          role: m.role,
          joined_at: iso(m.joinedAt),
          member_count: count,
          active: m.householdId === activeId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async createHousehold(userId, name) {
      const id = randomUUID();
      const now = Timestamp.now();
      const batch = db.batch();
      batch.set(households.doc(id), { name, createdAt: now } satisfies HouseholdDoc);
      batch.set(memberRef(id, userId), {
        householdId: id,
        userId,
        role: "owner",
        joinedAt: now,
      } satisfies MemberDoc);
      batch.set(
        settings.doc(userId),
        { activeHouseholdId: id, updatedAt: now } satisfies SettingsDoc,
        { merge: true },
      );
      await batch.commit();
      return id;
    },

    async renameHousehold(householdId, name) {
      try {
        await households.doc(householdId).update({ name });
      } catch (e) {
        // UPDATE of a missing row is a no-op in SQL; keep it one here.
        if (!isNotFound(e)) throw e;
      }
    },

    deleteHousehold: cascadeDelete,

    async setActiveHousehold(userId, householdId) {
      await settings
        .doc(userId)
        .set({ activeHouseholdId: householdId, updatedAt: Timestamp.now() }, { merge: true });
    },

    async listMembers(householdId) {
      const snap = await members.where("householdId", "==", householdId).get();
      if (snap.empty) return [];
      const ms = snap.docs.map((d) => d.data() as MemberDoc);
      const userSnaps = await db.getAll(...ms.map((m) => users.doc(m.userId)));

      return ms
        .map((m, i) => ({ m, u: userSnaps[i] }))
        .filter(({ u }) => u.exists) // the JOIN on shared.users
        .sort((a, b) => a.m.joinedAt.toMillis() - b.m.joinedAt.toMillis())
        .map(({ m, u }) => {
          const user = u.data() as UserDoc;
          return {
            user_id: m.userId,
            role: m.role,
            joined_at: iso(m.joinedAt),
            email: user.email ?? "",
            display_name: user.displayName ?? null,
          };
        });
    },

    async removeMember(householdId, userId, targetRole) {
      const emptied = await db.runTransaction(async (tx) => {
        const all = await tx.get(members.where("householdId", "==", householdId));
        const remaining = all.docs
          .map((d) => ({ ref: d.ref, m: d.data() as MemberDoc }))
          .filter(({ m }) => m.userId !== userId)
          .sort((a, b) => a.m.joinedAt.toMillis() - b.m.joinedAt.toMillis());

        tx.delete(memberRef(householdId, userId));
        // If the leaver was the only member, the household goes too.
        if (remaining.length === 0) return true;
        // Auto-promote the longest-standing member if the owner left.
        const [next] = remaining;
        if (targetRole === "owner" && next.m.role !== "owner") {
          tx.update(next.ref, { role: "owner" });
        }
        return false;
      });

      if (emptied) await cascadeDelete(householdId);

      // If the removed user's active household pointed here, swap to another
      // membership (oldest first) or clear it. After a cascade this finds the
      // pointer already cleared, exactly as SET NULL leaves it in Postgres.
      const theirs = await members.where("userId", "==", userId).get();
      const other = theirs.docs
        .map((d) => d.data() as MemberDoc)
        .sort((a, b) => a.joinedAt.toMillis() - b.joinedAt.toMillis())[0];

      const ref = settings.doc(userId);
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if ((s.data() as SettingsDoc | undefined)?.activeHouseholdId !== householdId) return;
        tx.update(ref, {
          activeHouseholdId: other?.householdId ?? null,
          updatedAt: Timestamp.now(),
        });
      });
    },

    // ---------- invites ----------

    async listInvites(householdId) {
      const now = Date.now();
      const snap = await invites.where("householdId", "==", householdId).get();
      return snap.docs
        .map((d) => ({ id: d.id, i: d.data() as InviteDoc }))
        .filter(({ i }) => i.acceptedAt === null && i.expiresAt.toMillis() > now)
        .sort((a, b) => b.i.createdAt.toMillis() - a.i.createdAt.toMillis())
        .map(({ id, i }) => ({ id, created_at: iso(i.createdAt), expires_at: iso(i.expiresAt) }));
    },

    async createInvite(householdId, tokenHash, createdBy, ttlDays) {
      const id = randomUUID();
      const now = Timestamp.now();
      const expiresAt = Timestamp.fromMillis(now.toMillis() + ttlDays * 24 * 60 * 60 * 1000);
      await invites.doc(id).set({
        householdId,
        tokenHash: tokenHash.toString("hex"),
        createdBy,
        createdAt: now,
        expiresAt,
        acceptedAt: null,
        acceptedBy: null,
      } satisfies InviteDoc);
      return { id, expires_at: iso(expiresAt) };
    },

    async revokeInvite(householdId, inviteId) {
      await mutate<InviteDoc>(invites.doc(inviteId), householdId, () => null);
    },

    async previewInvite(tokenHash) {
      const snap = await invites
        .where("tokenHash", "==", tokenHash.toString("hex"))
        .limit(1)
        .get();
      if (snap.empty) return null;
      const i = snap.docs[0].data() as InviteDoc;

      const [h, u] = await db.getAll(households.doc(i.householdId), users.doc(i.createdBy));
      if (!h.exists || !u.exists) return null; // the JOINs on households and shared.users
      const inviter = u.data() as UserDoc;
      return {
        household_name: (h.data() as HouseholdDoc).name,
        inviter_name: inviter.displayName ?? null,
        inviter_email: inviter.email ?? "",
        expires_at: iso(i.expiresAt),
        accepted_at: isoOrNull(i.acceptedAt),
      };
    },

    async acceptInvite(tokenHash, userId) {
      const byHash = invites.where("tokenHash", "==", tokenHash.toString("hex")).limit(1);

      // The transaction is what makes an invite single-use: two people
      // accepting at once both read acceptedAt === null, and Firestore retries
      // the loser, who then sees it set. That is the job FOR UPDATE did.
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(byHash);
        if (snap.empty) return { ok: false as const, reason: "invalid" as const };
        const inviteRef = snap.docs[0].ref;
        const invite = snap.docs[0].data() as InviteDoc;
        if (invite.acceptedAt) return { ok: false as const, reason: "used" as const };
        if (invite.expiresAt.toMillis() <= Date.now()) {
          return { ok: false as const, reason: "expired" as const };
        }

        const now = Timestamp.now();
        const mRef = memberRef(invite.householdId, userId);
        const existing = await tx.get(mRef);

        // ON CONFLICT (household_id, user_id) DO NOTHING
        if (!existing.exists) {
          tx.set(mRef, {
            householdId: invite.householdId,
            userId,
            role: "member",
            joinedAt: now,
          } satisfies MemberDoc);
        }
        tx.update(inviteRef, { acceptedAt: now, acceptedBy: userId });
        tx.set(
          settings.doc(userId),
          { activeHouseholdId: invite.householdId, updatedAt: now } satisfies SettingsDoc,
          { merge: true },
        );
        return { ok: true as const, householdId: invite.householdId };
      });
    },

    // ---------- items ----------

    async listItems(householdId) {
      const snap = await items.where("householdId", "==", householdId).get();
      return snap.docs
        .map((d) => ({ id: d.id, doc: d.data() as ItemDoc }))
        .sort((a, b) => byNameKey(a.doc, b.doc))
        .map(({ id, doc }) => toItemRow(id, doc));
    },

    async createItem(householdId, a) {
      return db.runTransaction(async (tx) => {
        const key = nameKey(a.name);
        if (await itemNameTaken(tx, householdId, key)) return null;
        const tagIds = await validTagIds(tx, householdId, a.tagIds ?? []);

        // Minted inside the callback so a retried attempt writes a fresh id.
        const id = randomUUID();
        const now = Timestamp.now();
        tx.set(items.doc(id), {
          householdId,
          name: a.name,
          nameKey: key,
          quantity: a.quantity ?? 1,
          size: a.size ?? null,
          status: a.status ?? "stocked",
          notes: a.notes ?? null,
          tagIds,
          createdAt: now,
          updatedAt: now,
        } satisfies ItemDoc);
        return id;
      });
    },

    async updateItem(householdId, id, a) {
      const ref = items.doc(id);
      return db.runTransaction(async (tx) => {
        const doc = owned<ItemDoc>(await tx.get(ref), householdId);
        if (!doc) return "not_found" as const;

        const update: Partial<ItemDoc> = { updatedAt: Timestamp.now() };
        if (a.name !== undefined) {
          const key = nameKey(a.name);
          // A case-only rename of the same item is not a conflict, as with citext.
          if (key !== doc.nameKey && (await itemNameTaken(tx, householdId, key, id))) {
            return "duplicate" as const;
          }
          update.name = a.name;
          update.nameKey = key;
        }
        if (a.quantity !== undefined) update.quantity = a.quantity;
        if (a.size !== undefined) update.size = a.size;
        if (a.status !== undefined) update.status = a.status;
        if (a.notes !== undefined) update.notes = a.notes;
        if (a.tagIds !== undefined) update.tagIds = await validTagIds(tx, householdId, a.tagIds);

        tx.update(ref, update);
        return "ok" as const;
      });
    },

    setItemStatus: (householdId, id, status) =>
      mutate<ItemDoc>(items.doc(id), householdId, () => ({
        status,
        updatedAt: Timestamp.now(),
      })),

    // List entries that pointed at this item are left alone; getList reports
    // them unlinked, which is what ON DELETE SET NULL did.
    deleteItem: (householdId, id) => mutate<ItemDoc>(items.doc(id), householdId, () => null),

    // ---------- tags ----------

    async listTags(householdId) {
      const snap = await tags.where("householdId", "==", householdId).get();
      return snap.docs
        .map((d) => ({ id: d.id, doc: d.data() as TagDoc }))
        .sort((a, b) =>
          a.doc.kind === b.doc.kind
            ? byNameKey(a.doc, b.doc)
            : a.doc.kind.localeCompare(b.doc.kind),
        )
        .map(
          ({ id, doc }): TagRow => ({ id, name: doc.name, kind: doc.kind, color: doc.color }),
        );
    },

    async createTag(householdId, a) {
      return db.runTransaction(async (tx) => {
        const key = nameKey(a.name);
        if (await tagNameTaken(tx, householdId, a.kind, key)) return null;
        const id = randomUUID();
        tx.set(tags.doc(id), {
          householdId,
          name: a.name,
          nameKey: key,
          kind: a.kind,
          color: a.color ?? null,
          createdAt: Timestamp.now(),
        } satisfies TagDoc);
        return id;
      });
    },

    async updateTag(householdId, id, a) {
      const ref = tags.doc(id);
      return db.runTransaction(async (tx) => {
        const doc = owned<TagDoc>(await tx.get(ref), householdId);
        if (!doc) return "not_found" as const;

        const kind = a.kind ?? doc.kind;
        const key = a.name !== undefined ? nameKey(a.name) : doc.nameKey;
        if (
          (kind !== doc.kind || key !== doc.nameKey) &&
          (await tagNameTaken(tx, householdId, kind, key, id))
        ) {
          return "duplicate" as const;
        }

        const update: Partial<TagDoc> = {};
        if (a.name !== undefined) {
          update.name = a.name;
          update.nameKey = key;
        }
        if (a.kind !== undefined) update.kind = a.kind;
        if (a.color !== undefined) update.color = a.color;
        tx.update(ref, update);
        return "ok" as const;
      });
    },

    async deleteTag(householdId, id) {
      const ref = tags.doc(id);
      return db.runTransaction(async (tx) => {
        if (!owned<TagDoc>(await tx.get(ref), householdId)) return false;
        // ON DELETE CASCADE on item_tags. Tag ids are UUIDs, so array-contains
        // alone cannot match another household's items.
        const tagged = await tx.get(items.where("tagIds", "array-contains", id));
        tx.delete(ref);
        for (const d of tagged.docs) tx.update(d.ref, { tagIds: FieldValue.arrayRemove(id) });
        return true;
      });
    },

    // ---------- grocery lists ----------

    async listLists(householdId) {
      const snap = await lists
        .where("householdId", "==", householdId)
        .orderBy("createdAt", "desc")
        .limit(100)
        .get();
      return snap.docs.map((d) => {
        const l = d.data() as ListDoc;
        return {
          id: d.id,
          name: l.name,
          status: l.status,
          created_at: iso(l.createdAt),
          completed_at: isoOrNull(l.completedAt),
          item_count: l.entries.length,
          checked_count: l.entries.filter((e) => e.checkedOff).length,
        };
      });
    },

    async createList(householdId, name, itemIds, extras) {
      return db.runTransaction(async (tx) => {
        const unique = [...new Set(itemIds)];
        const snaps = unique.length ? await tx.getAll(...unique.map((id) => items.doc(id))) : [];

        const entries: ListEntry[] = [
          ...snaps
            .map((s) => ({ id: s.id, doc: owned<ItemDoc>(s, householdId) }))
            .filter((x): x is { id: string; doc: ItemDoc } => x.doc !== null)
            .map(({ id, doc }) => ({
              id: randomUUID(),
              itemId: id,
              nameSnapshot: doc.name,
              quantity: 1,
              checkedOff: false,
            })),
          ...extras.map((e) => ({
            id: randomUUID(),
            itemId: null,
            nameSnapshot: e.name,
            quantity: e.quantity,
            checkedOff: false,
          })),
        ];

        const id = randomUUID();
        tx.set(lists.doc(id), {
          householdId,
          name,
          status: "active",
          createdAt: Timestamp.now(),
          completedAt: null,
          entries,
        } satisfies ListDoc);
        return id;
      });
    },

    async getList(householdId, listId) {
      const list = owned<ListDoc>(await lists.doc(listId).get(), householdId);
      if (!list) return null;

      // Two batched reads stand in for the joins: the linked items, then
      // every tag those items carry.
      const linkedIds = [...new Set(list.entries.flatMap((e) => (e.itemId ? [e.itemId] : [])))];
      const itemSnaps = linkedIds.length
        ? await db.getAll(...linkedIds.map((id) => items.doc(id)))
        : [];
      const itemById = new Map<string, ItemDoc>();
      for (const s of itemSnaps) {
        const doc = owned<ItemDoc>(s, householdId);
        if (doc) itemById.set(s.id, doc);
      }

      const tagIds = [...new Set([...itemById.values()].flatMap((i) => i.tagIds))];
      const tagSnaps = tagIds.length ? await db.getAll(...tagIds.map((id) => tags.doc(id))) : [];
      const tagById = new Map<string, TagDoc>();
      for (const s of tagSnaps) {
        const doc = owned<TagDoc>(s, householdId);
        if (doc) tagById.set(s.id, doc);
      }

      const tagNames = (item: ItemDoc | undefined, kind: TagKind) =>
        (item?.tagIds ?? [])
          .map((id) => tagById.get(id))
          .filter((t): t is TagDoc => t?.kind === kind)
          .sort(byNameKey)
          .map((t) => t.name);

      const rows: ListItemRow[] = list.entries.map((e) => {
        const item = e.itemId ? itemById.get(e.itemId) : undefined;
        return {
          id: e.id,
          // A link to a since-deleted item reads as unlinked: ON DELETE SET NULL.
          item_id: item ? e.itemId : null,
          name_snapshot: e.nameSnapshot,
          quantity: e.quantity,
          checked_off: e.checkedOff,
          item_status: item?.status ?? null,
          sections: tagNames(item, "section"),
          stores: tagNames(item, "store"),
        };
      });

      return {
        id: listId,
        name: list.name,
        status: list.status,
        created_at: iso(list.createdAt),
        completed_at: isoOrNull(list.completedAt),
        items: rows,
      };
    },

    async listExists(householdId, listId) {
      return owned<ListDoc>(await lists.doc(listId).get(), householdId) !== null;
    },

    async itemName(householdId, itemId) {
      return owned<ItemDoc>(await items.doc(itemId).get(), householdId)?.name ?? null;
    },

    async addListItem(listId, itemId, nameSnapshot, quantity) {
      const id = randomUUID();
      // arrayUnion appends without a read; the entry's unique id means it is
      // never mistaken for an existing element.
      await lists.doc(listId).update({
        entries: FieldValue.arrayUnion({
          id,
          itemId,
          nameSnapshot,
          quantity,
          checkedOff: false,
        } satisfies ListEntry),
      });
      return id;
    },

    patchListItem: (householdId, listId, listItemId, a) =>
      editEntries(householdId, listId, (entries) => {
        const entry = entries.find((e) => e.id === listItemId);
        if (!entry) return false;
        if (a.checkedOff !== undefined) entry.checkedOff = a.checkedOff;
        if (a.quantity !== undefined) entry.quantity = a.quantity;
        return true;
      }),

    deleteListItem: (householdId, listId, listItemId) =>
      editEntries(householdId, listId, (entries) => {
        const at = entries.findIndex((e) => e.id === listItemId);
        if (at === -1) return false;
        entries.splice(at, 1);
        return true;
      }),

    async finishList(householdId, listId, quantities) {
      const ref = lists.doc(listId);
      // One transaction, so a partially restocked pantry is impossible. It
      // writes the list plus one doc per distinct linked item, and a
      // transaction caps at 500 writes, so a list with more than 499 checked,
      // linked items would fail. No real grocery list gets near that.
      return db.runTransaction(async (tx) => {
        const list = owned<ListDoc>(await tx.get(ref), householdId);
        if (!list) return false;

        const entries = list.entries.map((e) => ({ ...e }));
        const checked = entries.filter((e) => e.checkedOff);
        const linkedIds = [...new Set(checked.flatMap((e) => (e.itemId ? [e.itemId] : [])))];
        const itemSnaps = linkedIds.length
          ? await tx.getAll(...linkedIds.map((id) => items.doc(id)))
          : [];
        const live = new Set(
          itemSnaps.filter((s) => owned<ItemDoc>(s, householdId)).map((s) => s.id),
        );

        const now = Timestamp.now();
        // Keyed by item so one item on two checked lines is written once, with
        // the later line winning, which is where the sequential SQL ends up.
        const restock = new Map<string, number>();
        for (const e of checked) {
          const qty = quantities.has(e.id) ? quantities.get(e.id)! : 1;
          e.quantity = qty;
          if (e.itemId && live.has(e.itemId)) restock.set(e.itemId, qty);
        }

        for (const [itemId, qty] of restock) {
          tx.update(items.doc(itemId), { quantity: qty, status: "stocked", updatedAt: now });
        }
        tx.update(ref, { entries, status: "completed", completedAt: now });
        return true;
      });
    },

    deleteList: (householdId, listId) =>
      mutate<ListDoc>(lists.doc(listId), householdId, () => null),

    async close() {
      // No-op by design. The Firestore client is shared across warm
      // invocations of a Function instance; terminating it here would break
      // the next request served by the same instance.
    },
  };
}
