import { createHash, randomUUID } from "node:crypto";
import { type Firestore, type Query, Timestamp } from "@google-cloud/firestore";
import type { BakeStep } from "../fermentation/index.js";
import {
  type BakeRow,
  DEFAULT_SETTINGS,
  type DueReminder,
  type FeedingRow,
  type PushSubscriptionRow,
  type RecipeConfig,
  type RecipeRow,
  type ReminderRow,
  type SettingsRow,
  type StarterRecord,
  type VapidKeys,
} from "../domain/types.js";
import type { CrumbRepo } from "./types.js";

/**
 * Cloud implementation.
 *
 * Document layout (every collection prefixed `crumb_`):
 *   starters/{uuid}            one per starter
 *   feedings/{uuid}            one per feed, with userId and starterId
 *   recipes/{uuid}             one per user recipe; built-ins are in code
 *   bakes/{uuid}               one per bake, its planned steps embedded in order
 *   reminders/{uuid}           one per pending or sent reminder; `pending` is
 *                              the dispatcher's index, since `sentAt == null`
 *                              can't share a composite index with a range
 *   push_subscriptions/{sha256(endpoint)}
 *                              a deterministic id, so one row per device
 *                              without a unique index
 *   settings/{userId}
 *   config/vapid               the app's VAPID key pair, made once
 *
 * A reminder group is replaced in one transaction, and the dispatcher claims
 * due reminders in one, so two dispatch runs never send the same reminder.
 * Recipe configs and bake steps go through a JSON round-trip before they are
 * written, which drops `undefined` (Firestore rejects it).
 *
 * Ids are app-generated UUIDs, not Firestore auto-ids, so `z.string().uuid()`
 * on the route params holds on both backends.
 */
export function createFirestoreCrumbRepo(db: Firestore, prefix = "crumb_"): CrumbRepo {
  const starters = db.collection(`${prefix}starters`);
  const feedings = db.collection(`${prefix}feedings`);
  const recipes = db.collection(`${prefix}recipes`);
  const bakes = db.collection(`${prefix}bakes`);
  const reminders = db.collection(`${prefix}reminders`);
  const pushSubs = db.collection(`${prefix}push_subscriptions`);
  const settings = db.collection(`${prefix}settings`);
  const config = db.collection(`${prefix}config`);

  // ---------- document shapes ----------

  interface StarterDoc {
    userId: string;
    name: string;
    flour: string;
    hydration: number;
    location: StarterRecord["location"];
    locationSince: Timestamp;
    reserveGrams: number;
    notes: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  }

  interface FeedingDoc {
    userId: string;
    starterId: string;
    fedAt: Timestamp;
    starterG: number;
    flourG: number;
    waterG: number;
    tempF: number | null;
    peakAt: Timestamp | null;
    risePct: number | null;
    notes: string;
    remindAtPeak: boolean;
    createdAt: Timestamp;
  }

  interface RecipeDoc {
    userId: string;
    name: string;
    kind: RecipeRow["kind"];
    config: RecipeConfig;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  }

  interface BakeDoc {
    userId: string;
    recipeId: string;
    recipeName: string;
    kind: BakeRow["kind"];
    starterId: string | null;
    status: BakeRow["status"];
    readyAt: Timestamp;
    pieces: number;
    pieceGrams: number;
    tempF: number;
    levain: BakeRow["levain"];
    mix: BakeRow["mix"];
    /** Wire shape, snake_case and ISO strings, exactly as served. */
    steps: BakeStep[];
    notes: string;
    rating: number | null;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  }

  interface ReminderDoc {
    userId: string;
    group: string;
    key: string;
    title: string;
    body: string;
    url: string;
    email: string;
    dueAt: Timestamp;
    sentAt: Timestamp | null;
    pending: boolean;
    createdAt: Timestamp;
  }

  interface PushDoc {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    createdAt: Timestamp;
  }

  const iso = (t: Timestamp) => t.toDate().toISOString();
  const ts = (s: string) => Timestamp.fromDate(new Date(s));
  const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  const toStarter = (id: string, d: StarterDoc): StarterRecord => ({
    id,
    name: d.name,
    flour: d.flour,
    hydration: d.hydration,
    location: d.location,
    location_since: iso(d.locationSince),
    reserve_grams: d.reserveGrams,
    notes: d.notes,
    created_at: iso(d.createdAt),
    updated_at: iso(d.updatedAt),
  });

  const toFeeding = (id: string, d: FeedingDoc): FeedingRow => ({
    id,
    starter_id: d.starterId,
    fed_at: iso(d.fedAt),
    starter_g: d.starterG,
    flour_g: d.flourG,
    water_g: d.waterG,
    temp_f: d.tempF,
    peak_at: d.peakAt ? iso(d.peakAt) : null,
    rise_pct: d.risePct,
    notes: d.notes,
    remind_at_peak: d.remindAtPeak,
    created_at: iso(d.createdAt),
  });

  const toRecipe = (id: string, d: RecipeDoc): RecipeRow => ({
    id,
    name: d.name,
    kind: d.kind,
    config: d.config,
    builtin: false,
    created_at: iso(d.createdAt),
    updated_at: iso(d.updatedAt),
  });

  const toBake = (id: string, d: BakeDoc): BakeRow => ({
    id,
    recipe_id: d.recipeId,
    recipe_name: d.recipeName,
    kind: d.kind,
    starter_id: d.starterId,
    status: d.status,
    ready_at: iso(d.readyAt),
    pieces: d.pieces,
    piece_grams: d.pieceGrams,
    temp_f: d.tempF,
    levain: d.levain,
    mix: d.mix,
    steps: d.steps,
    notes: d.notes,
    rating: d.rating,
    created_at: iso(d.createdAt),
    updated_at: iso(d.updatedAt),
  });

  const toReminder = (id: string, d: ReminderDoc): ReminderRow => ({
    id,
    group: d.group,
    key: d.key,
    title: d.title,
    body: d.body,
    url: d.url,
    due_at: iso(d.dueAt),
    sent_at: d.sentAt ? iso(d.sentAt) : null,
  });

  const toPush = (id: string, d: PushDoc): PushSubscriptionRow => ({
    id,
    endpoint: d.endpoint,
    p256dh: d.p256dh,
    auth: d.auth,
    created_at: iso(d.createdAt),
  });

  const pushId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

  /** Deletes everything a query matches, in batches under the 500-write cap. */
  async function deleteAll(q: Query): Promise<void> {
    for (;;) {
      const snap = await q.limit(400).get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  /** Mirrors `WHERE id = $1 AND user_id = $2`: someone else's is not found. */
  async function owned<T extends { userId: string }>(
    col: FirebaseFirestore.CollectionReference,
    userId: string,
    id: string,
  ): Promise<T | null> {
    const snap = await col.doc(id).get();
    if (!snap.exists) return null;
    const doc = snap.data() as T;
    return doc.userId === userId ? doc : null;
  }

  return {
    // ---------- starters ----------

    async listStarters(userId) {
      const snap = await starters.where("userId", "==", userId).get();
      return snap.docs
        .map((d) => toStarter(d.id, d.data() as StarterDoc))
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    },

    async getStarter(userId, id) {
      const doc = await owned<StarterDoc>(starters, userId, id);
      return doc ? toStarter(id, doc) : null;
    },

    async createStarter(userId, input) {
      const now = Timestamp.now();
      const doc: StarterDoc = {
        userId,
        name: input.name,
        flour: input.flour,
        hydration: input.hydration,
        location: input.location,
        locationSince: now,
        reserveGrams: input.reserveGrams,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      };
      const id = randomUUID();
      await starters.doc(id).set(doc);
      return toStarter(id, doc);
    },

    async updateStarter(userId, id, patch) {
      const ref = starters.doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const doc = snap.data() as StarterDoc;
        if (doc.userId !== userId) return null;
        const now = Timestamp.now();
        const next: StarterDoc = {
          ...doc,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.flour !== undefined ? { flour: patch.flour } : {}),
          ...(patch.hydration !== undefined ? { hydration: patch.hydration } : {}),
          ...(patch.reserveGrams !== undefined ? { reserveGrams: patch.reserveGrams } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.location !== undefined && patch.location !== doc.location
            ? { location: patch.location, locationSince: now }
            : {}),
          updatedAt: now,
        };
        tx.set(ref, next);
        return toStarter(id, next);
      });
    },

    async deleteStarter(userId, id) {
      if (!(await owned<StarterDoc>(starters, userId, id))) return false;
      await starters.doc(id).delete();
      await deleteAll(feedings.where("userId", "==", userId).where("starterId", "==", id));
      // ON DELETE SET NULL, by hand.
      const planned = await bakes.where("userId", "==", userId).where("starterId", "==", id).get();
      for (let i = 0; i < planned.docs.length; i += 400) {
        const batch = db.batch();
        planned.docs.slice(i, i + 400).forEach((d) => batch.update(d.ref, { starterId: null }));
        await batch.commit();
      }
      return true;
    },

    // ---------- feedings ----------

    async listFeedings(userId, starterId, limit) {
      const snap = await feedings
        .where("starterId", "==", starterId)
        .where("userId", "==", userId)
        .orderBy("fedAt", "desc")
        .limit(limit)
        .get();
      return snap.docs.map((d) => toFeeding(d.id, d.data() as FeedingDoc));
    },

    async getFeeding(userId, id) {
      const doc = await owned<FeedingDoc>(feedings, userId, id);
      return doc ? toFeeding(id, doc) : null;
    },

    async createFeeding(userId, starterId, input) {
      const doc: FeedingDoc = {
        userId,
        starterId,
        fedAt: ts(input.fedAt),
        starterG: input.starterG,
        flourG: input.flourG,
        waterG: input.waterG,
        tempF: input.tempF,
        peakAt: null,
        risePct: null,
        notes: input.notes,
        remindAtPeak: input.remindAtPeak,
        createdAt: Timestamp.now(),
      };
      const id = randomUUID();
      await feedings.doc(id).set(doc);
      return toFeeding(id, doc);
    },

    async updateFeeding(userId, id, patch) {
      const ref = feedings.doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const doc = snap.data() as FeedingDoc;
        if (doc.userId !== userId) return null;
        const next: FeedingDoc = {
          ...doc,
          ...(patch.peakAt !== undefined ? { peakAt: patch.peakAt === null ? null : ts(patch.peakAt) } : {}),
          ...(patch.risePct !== undefined ? { risePct: patch.risePct } : {}),
          ...(patch.tempF !== undefined ? { tempF: patch.tempF } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        };
        tx.set(ref, next);
        return toFeeding(id, next);
      });
    },

    async deleteFeeding(userId, id) {
      if (!(await owned<FeedingDoc>(feedings, userId, id))) return false;
      await feedings.doc(id).delete();
      return true;
    },

    // ---------- recipes ----------

    async listRecipes(userId) {
      const snap = await recipes.where("userId", "==", userId).orderBy("createdAt", "desc").get();
      return snap.docs.map((d) => toRecipe(d.id, d.data() as RecipeDoc));
    },

    async getRecipe(userId, id) {
      const doc = await owned<RecipeDoc>(recipes, userId, id);
      return doc ? toRecipe(id, doc) : null;
    },

    async createRecipe(userId, input) {
      const now = Timestamp.now();
      const doc: RecipeDoc = { userId, name: input.name, kind: input.kind, config: plain(input.config), createdAt: now, updatedAt: now };
      const id = randomUUID();
      await recipes.doc(id).set(doc);
      return toRecipe(id, doc);
    },

    async updateRecipe(userId, id, patch) {
      const ref = recipes.doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const doc = snap.data() as RecipeDoc;
        if (doc.userId !== userId) return null;
        const next: RecipeDoc = {
          ...doc,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
          ...(patch.config !== undefined ? { config: plain(patch.config) } : {}),
          updatedAt: Timestamp.now(),
        };
        tx.set(ref, next);
        return toRecipe(id, next);
      });
    },

    async deleteRecipe(userId, id) {
      if (!(await owned<RecipeDoc>(recipes, userId, id))) return false;
      await recipes.doc(id).delete();
      return true;
    },

    // ---------- bakes ----------

    async listBakes(userId, limit) {
      const snap = await bakes.where("userId", "==", userId).orderBy("createdAt", "desc").limit(limit).get();
      return snap.docs.map((d) => toBake(d.id, d.data() as BakeDoc));
    },

    async getBake(userId, id) {
      const doc = await owned<BakeDoc>(bakes, userId, id);
      return doc ? toBake(id, doc) : null;
    },

    async createBake(userId, b) {
      const now = Timestamp.now();
      const doc: BakeDoc = {
        userId,
        recipeId: b.recipe_id,
        recipeName: b.recipe_name,
        kind: b.kind,
        starterId: b.starter_id,
        status: b.status,
        readyAt: ts(b.ready_at),
        pieces: b.pieces,
        pieceGrams: b.piece_grams,
        tempF: b.temp_f,
        levain: plain(b.levain),
        mix: plain(b.mix),
        steps: plain(b.steps),
        notes: b.notes,
        rating: b.rating,
        createdAt: now,
        updatedAt: now,
      };
      const id = randomUUID();
      await bakes.doc(id).set(doc);
      return toBake(id, doc);
    },

    async updateBake(userId, id, change) {
      const ref = bakes.doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const doc = snap.data() as BakeDoc;
        if (doc.userId !== userId) return null;
        const c = change(toBake(id, doc));
        if (!c) return toBake(id, doc);
        const next: BakeDoc = {
          ...doc,
          ...(c.status !== undefined ? { status: c.status } : {}),
          ...(c.notes !== undefined ? { notes: c.notes } : {}),
          ...(c.rating !== undefined ? { rating: c.rating } : {}),
          ...(c.ready_at !== undefined ? { readyAt: ts(c.ready_at) } : {}),
          ...(c.steps !== undefined ? { steps: plain(c.steps) } : {}),
          updatedAt: Timestamp.now(),
        };
        tx.set(ref, next);
        return toBake(id, next);
      });
    },

    async deleteBake(userId, id) {
      if (!(await owned<BakeDoc>(bakes, userId, id))) return false;
      await bakes.doc(id).delete();
      return true;
    },

    // ---------- reminders ----------

    async replaceReminders(userId, email, group, list) {
      const q = reminders.where("userId", "==", userId).where("group", "==", group);
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(q);
        existing.docs.forEach((d) => tx.delete(d.ref));
        const now = Timestamp.now();
        for (const r of list) {
          const doc: ReminderDoc = {
            userId,
            group,
            key: r.key,
            title: r.title,
            body: r.body,
            url: r.url,
            email,
            dueAt: ts(r.due_at),
            sentAt: null,
            pending: true,
            createdAt: now,
          };
          tx.set(reminders.doc(randomUUID()), doc);
        }
      });
    },

    async listReminders(userId) {
      const snap = await reminders.where("userId", "==", userId).where("pending", "==", true).get();
      return snap.docs
        .map((d) => toReminder(d.id, d.data() as ReminderDoc))
        .sort((a, b) => a.due_at.localeCompare(b.due_at) || a.key.localeCompare(b.key));
    },

    async claimDueReminders(now, limit) {
      const q = reminders
        .where("pending", "==", true)
        .where("dueAt", "<=", Timestamp.fromDate(now))
        .orderBy("dueAt")
        .limit(limit);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(q);
        const sentAt = Timestamp.fromDate(now);
        return snap.docs.map((d) => {
          const doc = d.data() as ReminderDoc;
          tx.update(d.ref, { pending: false, sentAt });
          return { ...toReminder(d.id, { ...doc, sentAt }), user_id: doc.userId, email: doc.email } satisfies DueReminder;
        });
      });
    },

    // ---------- push ----------

    async vapidKeys(generate) {
      const ref = config.doc("vapid");
      const existing = await ref.get();
      if (existing.exists) return existing.data() as VapidKeys;
      // Generated outside the transaction, which may retry; whichever write
      // lands first is kept and the other run reads it.
      const fresh = generate();
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) return snap.data() as VapidKeys;
        tx.set(ref, { publicKey: fresh.publicKey, privateKey: fresh.privateKey });
        return fresh;
      });
    },

    async savePushSubscription(userId, s) {
      const id = pushId(s.endpoint);
      const doc: PushDoc = { userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, createdAt: Timestamp.now() };
      await pushSubs.doc(id).set(doc);
      return toPush(id, doc);
    },

    async deletePushSubscription(userId, endpoint) {
      const id = pushId(endpoint);
      if (!(await owned<PushDoc>(pushSubs, userId, id))) return false;
      await pushSubs.doc(id).delete();
      return true;
    },

    async listPushSubscriptions(userId) {
      const snap = await pushSubs.where("userId", "==", userId).get();
      return snap.docs
        .map((d) => toPush(d.id, d.data() as PushDoc))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },

    async forgetPushSubscription(endpoint) {
      await pushSubs.doc(pushId(endpoint)).delete();
    },

    // ---------- settings ----------

    async getSettings(userId) {
      const snap = await settings.doc(userId).get();
      if (!snap.exists) return { ...DEFAULT_SETTINGS };
      return { email_reminders: (snap.data() as { emailReminders: SettingsRow["email_reminders"] }).emailReminders };
    },

    async saveSettings(userId, input) {
      await settings.doc(userId).set({ emailReminders: input.emailReminders, updatedAt: Timestamp.now() });
      return { email_reminders: input.emailReminders };
    },

    async close() {
      // The Firestore client is shared and owned by the caller.
    },
  };
}
