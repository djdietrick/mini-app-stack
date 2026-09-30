import { randomUUID } from "node:crypto";
import { FieldPath, Timestamp } from "@google-cloud/firestore";
import type { DocumentReference, Firestore, WriteBatch } from "@google-cloud/firestore";
import type { RuleGroup } from "../domain/rules/types.js";
import type {
  Cadence,
  DigestItemRow,
  FeedCandidate,
  NotifyMode,
  RuleScope,
  Snapshot,
} from "../domain/types.js";
import type { YtdigestRepo } from "./types.js";

/**
 * Cloud implementation.
 *
 * Document layout (each prefixed `ytdigest_`):
 *   channels/{youtubeChannelId}        shared catalog; the YouTube id *is* the doc id
 *   videos/{youtubeVideoId}            likewise, so "ON CONFLICT DO NOTHING" is create()
 *   snapshots/{uuid}                   one per poll per tracked video
 *   subscriptions/{uuid}
 *   rules/{uuid}                       ruleJson stored as a map
 *   digest_runs/{uuid}                 lines[] embedded, with the video and
 *                                      channel titles copied onto each line
 *   notified/{userId}_{videoId}        deterministic id = the old composite PK
 * plus the unprefixed `users/{uid}` mirror the auth function maintains, which
 * stands in for shared.users.
 *
 * Why the YouTube ids are document ids: channels and videos are unique by them
 * already (the SQL's UNIQUE constraints), so a deterministic id gets
 * uniqueness without a transaction. It also means video_id and
 * youtube_video_id coincide on this backend. Subscription, rule and digest ids
 * stay UUIDs, because routes validate those with z.string().uuid().
 *
 * Digest lines are denormalised because GET /digests/:id joined videos and
 * channels for display; copying the titles at send time is the Firestore
 * equivalent, and a digest is a record of what was sent anyway.
 */
export interface FirestoreYtdigestOptions {
  prefix?: string;
  usersCollection?: string;
}

interface ChannelDoc {
  youtubeChannelId: string;
  title: string;
  thumbnailUrl: string | null;
  uploadsPlaylistId: string;
  lastPolledAt: Timestamp | null;
  createdAt: Timestamp;
}

interface VideoDoc {
  channelId: string;
  title: string;
  description: string | null;
  publishedAt: Timestamp;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  firstSeenAt: Timestamp;
}

interface SnapshotDoc {
  videoId: string;
  capturedAt: Timestamp;
  viewCount: number;
  likeCount: number | null;
  commentCount: number | null;
}

interface SubscriptionDoc {
  userId: string;
  channelId: string;
  cadence: Cadence;
  digestDayOfWeek: number | null;
  notifyMode: NotifyMode;
  lastDigestedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface RuleDoc {
  userId: string;
  scope: RuleScope;
  subscriptionId: string | null;
  name: string;
  ruleJson: RuleGroup;
  enabled: boolean;
  createdAt: Timestamp;
}

interface DigestLineDoc {
  videoId: string;
  youtubeVideoId: string;
  title: string;
  thumbnailUrl: string | null;
  channelTitle: string;
  subscriptionId: string;
  matchedRuleId: string | null;
  reasons: string[];
}

interface DigestRunDoc {
  userId: string;
  cadence: Cadence;
  runDate: string;
  sentAt: Timestamp;
  createdAt: Timestamp;
  lines: DigestLineDoc[];
}

interface UserDoc {
  email?: string | null;
}

const iso = (t: Timestamp) => t.toDate().toISOString();
const isoOrNull = (t: Timestamp | null) => (t ? iso(t) : null);

/** ORDER BY title on a text column. */
const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);

const BATCH_LIMIT = 500;
/** An `in` filter takes at most 30 values. */
const IN_LIMIT = 30;

export function createFirestoreYtdigestRepo(
  db: Firestore,
  { prefix = "ytdigest_", usersCollection = "users" }: FirestoreYtdigestOptions = {},
): YtdigestRepo {
  const channels = db.collection(`${prefix}channels`);
  const videos = db.collection(`${prefix}videos`);
  const snapshots = db.collection(`${prefix}snapshots`);
  const subscriptions = db.collection(`${prefix}subscriptions`);
  const rules = db.collection(`${prefix}rules`);
  const runs = db.collection(`${prefix}digest_runs`);
  const notified = db.collection(`${prefix}notified`);
  const users = db.collection(usersCollection);

  async function commitInChunks(writes: ((b: WriteBatch) => void)[]): Promise<void> {
    for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const w of writes.slice(i, i + BATCH_LIMIT)) w(batch);
      await batch.commit();
    }
  }

  /** Read-check-write on one user-owned doc, like `... WHERE id = $1 AND user_id = $2`. */
  async function mutateOwned<T extends { userId: string }>(
    ref: DocumentReference,
    userId: string,
    patch: Partial<T> | null,
  ): Promise<boolean> {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || (snap.data() as T).userId !== userId) return false;
      if (patch === null) tx.delete(ref);
      else tx.update(ref, patch as Record<string, unknown>);
      return true;
    });
  }

  const toSnapshot = (d: SnapshotDoc): Snapshot => ({
    viewCount: d.viewCount,
    likeCount: d.likeCount,
    capturedAt: d.capturedAt.toDate(),
  });

  const userSubscriptions = async (userId: string) =>
    (await subscriptions.where("userId", "==", userId).get()).docs.map((d) => ({
      id: d.id,
      doc: d.data() as SubscriptionDoc,
    }));

  const channelsById = async (ids: string[]) => {
    const unique = [...new Set(ids)];
    const snaps = unique.length ? await db.getAll(...unique.map((id) => channels.doc(id))) : [];
    return new Map(
      snaps.filter((s) => s.exists).map((s) => [s.id, s.data() as ChannelDoc] as const),
    );
  };

  const toFeedCandidate = (
    id: string,
    v: VideoDoc,
    sub: { id: string; doc: SubscriptionDoc },
    c: ChannelDoc,
  ): FeedCandidate => ({
    id,
    youtubeVideoId: id,
    title: v.title,
    description: v.description,
    publishedAt: v.publishedAt.toDate(),
    durationSeconds: v.durationSeconds,
    thumbnailUrl: v.thumbnailUrl,
    subscription: {
      id: sub.id,
      channelId: sub.doc.channelId,
      channelTitle: c.title,
      channelThumbnailUrl: c.thumbnailUrl,
      notifyMode: sub.doc.notifyMode,
    },
  });

  return {
    // ---------- channels ----------

    async listChannels(userId) {
      // Every channel, as the SQL returned. The catalog is only ever the
      // channels someone has subscribed to, so it stays small.
      const [all, subs] = await Promise.all([channels.get(), userSubscriptions(userId)]);
      const subByChannel = new Map(subs.map((s) => [s.doc.channelId, s.id]));
      return all.docs
        .map((d) => ({ id: d.id, c: d.data() as ChannelDoc }))
        .sort((a, b) => byTitle(a.c, b.c))
        .map(({ id, c }) => ({
          id,
          youtube_channel_id: c.youtubeChannelId,
          title: c.title,
          thumbnail_url: c.thumbnailUrl,
          last_polled_at: isoOrNull(c.lastPolledAt),
          subscription_id: subByChannel.get(id) ?? null,
        }));
    },

    async upsertChannel(r) {
      const ref = channels.doc(r.youtubeChannelId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          // ON CONFLICT DO UPDATE SET title, thumbnail_url: nothing else changes.
          tx.update(ref, { title: r.title, thumbnailUrl: r.thumbnailUrl });
        } else {
          tx.set(ref, {
            youtubeChannelId: r.youtubeChannelId,
            title: r.title,
            thumbnailUrl: r.thumbnailUrl,
            uploadsPlaylistId: r.uploadsPlaylistId,
            lastPolledAt: null,
            createdAt: Timestamp.now(),
          } satisfies ChannelDoc);
        }
      });
      return ref.id;
    },

    // ---------- subscriptions ----------

    async listSubscriptions(userId) {
      const subs = await userSubscriptions(userId);
      const byId = await channelsById(subs.map((s) => s.doc.channelId));
      return subs
        .filter((s) => byId.has(s.doc.channelId)) // the JOIN on channels
        .map((s) => ({ s, c: byId.get(s.doc.channelId)! }))
        .sort((a, b) => byTitle(a.c, b.c))
        .map(({ s, c }) => ({
          id: s.id,
          channel_id: s.doc.channelId,
          channel_title: c.title,
          thumbnail_url: c.thumbnailUrl,
          cadence: s.doc.cadence,
          digest_day_of_week: s.doc.digestDayOfWeek,
          notify_mode: s.doc.notifyMode,
          last_digested_at: isoOrNull(s.doc.lastDigestedAt),
          created_at: iso(s.doc.createdAt),
        }));
    },

    async createSubscription(userId, channelId, cadence, digestDayOfWeek, notifyMode) {
      const dupe = subscriptions
        .where("userId", "==", userId)
        .where("channelId", "==", channelId)
        .limit(1);
      // UNIQUE (user_id, channel_id): the check and the write share a transaction.
      return db.runTransaction(async (tx) => {
        if (!(await tx.get(dupe)).empty) return null;
        const id = randomUUID();
        tx.set(subscriptions.doc(id), {
          userId,
          channelId,
          cadence,
          digestDayOfWeek,
          notifyMode,
          lastDigestedAt: null,
          createdAt: Timestamp.now(),
        } satisfies SubscriptionDoc);
        return id;
      });
    },

    async subscriptionExists(userId, id) {
      const snap = await subscriptions.doc(id).get();
      return snap.exists && (snap.data() as SubscriptionDoc).userId === userId;
    },

    async updateSubscription(userId, id, a) {
      const patch: Partial<SubscriptionDoc> = {};
      if (a.cadence !== undefined) patch.cadence = a.cadence;
      if (a.digestDayOfWeek !== undefined) patch.digestDayOfWeek = a.digestDayOfWeek;
      if (a.notifyMode !== undefined) patch.notifyMode = a.notifyMode;
      return mutateOwned<SubscriptionDoc>(subscriptions.doc(id), userId, patch);
    },

    async deleteSubscription(userId, id) {
      if (!(await mutateOwned<SubscriptionDoc>(subscriptions.doc(id), userId, null))) return false;

      // ON DELETE CASCADE: the subscription's rules, and its lines in past
      // digests. Neither needs to be atomic with the delete; a rule for a
      // subscription that no longer exists never matches anything.
      const [ownRules, pastRuns] = await Promise.all([
        rules.where("subscriptionId", "==", id).get(),
        runs.where("userId", "==", userId).get(),
      ]);
      await commitInChunks([
        ...ownRules.docs.map((d) => (b: WriteBatch) => b.delete(d.ref)),
        ...pastRuns.docs
          .filter((d) => (d.data() as DigestRunDoc).lines.some((l) => l.subscriptionId === id))
          .map((d) => (b: WriteBatch) =>
            b.update(d.ref, {
              lines: (d.data() as DigestRunDoc).lines.filter((l) => l.subscriptionId !== id),
            }),
          ),
      ]);
      return true;
    },

    // ---------- rules ----------

    async listRules(userId) {
      const snap = await rules.where("userId", "==", userId).get();
      return snap.docs
        .map((d) => ({ id: d.id, r: d.data() as RuleDoc }))
        .sort((a, b) => b.r.createdAt.toMillis() - a.r.createdAt.toMillis())
        .map(({ id, r }) => ({
          id,
          scope: r.scope,
          subscription_id: r.subscriptionId,
          name: r.name,
          rule_json: r.ruleJson,
          enabled: r.enabled,
          created_at: iso(r.createdAt),
        }));
    },

    async createRule(userId, a) {
      const id = randomUUID();
      await rules.doc(id).set({
        userId,
        scope: a.scope,
        subscriptionId: a.subscriptionId ?? null,
        name: a.name,
        ruleJson: a.ruleJson as RuleGroup,
        enabled: a.enabled,
        createdAt: Timestamp.now(),
      } satisfies RuleDoc);
      return id;
    },

    async updateRule(userId, id, a) {
      const patch: Partial<RuleDoc> = {};
      if (a.name !== undefined) patch.name = a.name;
      if (a.ruleJson !== undefined) patch.ruleJson = a.ruleJson as RuleGroup;
      if (a.enabled !== undefined) patch.enabled = a.enabled;
      return mutateOwned<RuleDoc>(rules.doc(id), userId, patch);
    },

    deleteRule: (userId, id) => mutateOwned<RuleDoc>(rules.doc(id), userId, null),

    // ---------- digests (HTTP) ----------

    async listDigests(userId) {
      const snap = await runs
        .where("userId", "==", userId)
        .orderBy("runDate", "desc")
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();
      return snap.docs.map((d) => {
        const r = d.data() as DigestRunDoc;
        return {
          id: d.id,
          cadence: r.cadence,
          run_date: r.runDate,
          sent_at: iso(r.sentAt),
          item_count: r.lines.length,
        };
      });
    },

    async getDigest(userId, id) {
      const snap = await runs.doc(id).get();
      if (!snap.exists) return null;
      const r = snap.data() as DigestRunDoc;
      if (r.userId !== userId) return null;
      const items: DigestItemRow[] = [...r.lines]
        .sort((a, b) => a.channelTitle.localeCompare(b.channelTitle))
        .map((l) => ({
          video_id: l.videoId,
          youtube_video_id: l.youtubeVideoId,
          title: l.title,
          thumbnail_url: l.thumbnailUrl,
          channel_title: l.channelTitle,
          matched_rule_id: l.matchedRuleId,
          reason_json: l.reasons,
        }));
      return { id: snap.id, cadence: r.cadence, run_date: r.runDate, sent_at: iso(r.sentAt), items };
    },

    // ---------- feed ----------

    async feedCandidates(userId, after, limit) {
      const subs = await userSubscriptions(userId);
      const byId = await channelsById(subs.map((s) => s.doc.channelId));
      const subByChannel = new Map(
        subs.filter((s) => byId.has(s.doc.channelId)).map((s) => [s.doc.channelId, s] as const),
      );
      const channelIds = [...subByChannel.keys()];

      // One query per 30 channels, each already in feed order, merged here.
      // The document id is the tie-break, as v.id is in the SQL, so the
      // cursor is a real startAfter and a tie can't be skipped.
      const chunks: string[][] = [];
      for (let i = 0; i < channelIds.length; i += IN_LIMIT) chunks.push(channelIds.slice(i, i + IN_LIMIT));
      const pages = await Promise.all(
        chunks.map(async (ids) => {
          let q = videos
            .where("channelId", "in", ids)
            .orderBy("publishedAt", "desc")
            .orderBy(FieldPath.documentId(), "desc");
          if (after) q = q.startAfter(Timestamp.fromDate(after.publishedAt), after.videoId);
          return (await q.limit(limit).get()).docs;
        }),
      );

      return pages
        .flat()
        .map((d) => ({ id: d.id, v: d.data() as VideoDoc }))
        .sort(
          (a, b) =>
            b.v.publishedAt.toMillis() - a.v.publishedAt.toMillis() ||
            (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
        )
        .slice(0, limit)
        .map(({ id, v }) => toFeedCandidate(id, v, subByChannel.get(v.channelId)!, byId.get(v.channelId)!));
    },

    async feedVideo(userId, youtubeVideoId) {
      const snap = await videos.doc(youtubeVideoId).get();
      if (!snap.exists) return null;
      const v = snap.data() as VideoDoc;
      const [sub, channel] = await Promise.all([
        subscriptions.where("userId", "==", userId).where("channelId", "==", v.channelId).limit(1).get(),
        channels.doc(v.channelId).get(),
      ]);
      if (sub.empty || !channel.exists) return null;
      return toFeedCandidate(
        snap.id,
        v,
        { id: sub.docs[0].id, doc: sub.docs[0].data() as SubscriptionDoc },
        channel.data() as ChannelDoc,
      );
    },

    // ---------- poll job ----------

    async channelsToPoll() {
      // SELECT DISTINCT over the subscriptions join. A full read of
      // subscriptions, which is fine at personal scale.
      const subs = await subscriptions.get();
      const byId = await channelsById(subs.docs.map((d) => (d.data() as SubscriptionDoc).channelId));
      return [...byId].map(([id, c]) => ({ id, uploadsPlaylistId: c.uploadsPlaylistId }));
    },

    async latestVideoId(channelId) {
      const snap = await videos
        .where("channelId", "==", channelId)
        .orderBy("publishedAt", "desc")
        .limit(1)
        .get();
      return snap.empty ? null : snap.docs[0].id;
    },

    async insertVideos(channelId, uploads) {
      const now = Timestamp.now();
      // create() fails on an existing doc, which is exactly ON CONFLICT DO
      // NOTHING. Each is its own write so one known video can't sink the rest.
      await Promise.all(
        uploads.map(async (u) => {
          try {
            await videos.doc(u.youtubeVideoId).create({
              channelId,
              title: u.title,
              description: u.description,
              publishedAt: Timestamp.fromDate(new Date(u.publishedAt)),
              durationSeconds: null,
              thumbnailUrl: u.thumbnailUrl,
              firstSeenAt: now,
            } satisfies VideoDoc);
          } catch (e) {
            if ((e as { code?: number }).code !== 6) throw e; // 6 = ALREADY_EXISTS
          }
        }),
      );
    },

    async trackedVideos(channelId, limit) {
      const snap = await videos
        .where("channelId", "==", channelId)
        .orderBy("publishedAt", "desc")
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, youtubeVideoId: d.id }));
    },

    async recordStats(video, s) {
      const ref = videos.doc(video.id);
      await db.runTransaction(async (tx) => {
        const v = await tx.get(ref);
        // UPDATE ... WHERE duration_seconds IS NULL
        if (v.exists && (v.data() as VideoDoc).durationSeconds == null) {
          tx.update(ref, { durationSeconds: s.durationSeconds });
        }
        tx.set(snapshots.doc(randomUUID()), {
          videoId: video.id,
          capturedAt: Timestamp.now(),
          viewCount: s.viewCount,
          likeCount: s.likeCount,
          commentCount: s.commentCount,
        } satisfies SnapshotDoc);
      });
    },

    async markPolled(channelId) {
      await channels.doc(channelId).update({ lastPolledAt: Timestamp.now() });
    },

    // ---------- digest job ----------

    async digestRecipients() {
      const subs = await subscriptions.get();
      const userIds = [...new Set(subs.docs.map((d) => (d.data() as SubscriptionDoc).userId))];
      if (userIds.length === 0) return [];
      const snaps = await db.getAll(...userIds.map((id) => users.doc(id)));
      // The JOIN on shared.users: no mirror doc, or no address, means no mail.
      return snaps.flatMap((s) => {
        const email = s.exists ? (s.data() as UserDoc).email : null;
        return email ? [{ userId: s.id, email }] : [];
      });
    },

    async dueSubscriptions(userId, dayOfWeek, force) {
      const subs = await userSubscriptions(userId);
      const due = subs.filter(
        ({ doc }) =>
          force ||
          doc.cadence === "daily" ||
          (doc.cadence === "weekly" && doc.digestDayOfWeek === dayOfWeek),
      );
      const byId = await channelsById(due.map((s) => s.doc.channelId));
      return due
        .filter((s) => byId.has(s.doc.channelId))
        .map(({ id, doc }) => ({
          id,
          channelId: doc.channelId,
          channelTitle: byId.get(doc.channelId)!.title,
          cadence: doc.cadence,
          notifyMode: doc.notifyMode,
          lastDigestedAt: doc.lastDigestedAt?.toDate() ?? null,
        }));
    },

    async candidateVideos(userId, sub) {
      const since = Timestamp.fromDate(sub.lastDigestedAt ?? new Date(0));
      const snap = await videos
        .where("channelId", "==", sub.channelId)
        .where("firstSeenAt", ">", since)
        .get();
      if (snap.empty) return [];

      // NOT EXISTS (notified_videos): one batched read of the would-be ids.
      const sent = await db.getAll(...snap.docs.map((d) => notified.doc(`${userId}_${d.id}`)));
      const alreadySent = new Set(sent.filter((s) => s.exists).map((s) => s.id));

      return snap.docs
        .filter((d) => !alreadySent.has(`${userId}_${d.id}`))
        .map((d) => ({ id: d.id, v: d.data() as VideoDoc }))
        .sort((a, b) => a.v.publishedAt.toMillis() - b.v.publishedAt.toMillis())
        .map(({ id, v }) => ({
          id,
          youtubeVideoId: id,
          title: v.title,
          description: v.description,
          publishedAt: v.publishedAt.toDate(),
          durationSeconds: v.durationSeconds,
          thumbnailUrl: v.thumbnailUrl,
        }));
    },

    async enabledRules(userId, subscriptionId) {
      const snap = await rules.where("userId", "==", userId).get();
      return snap.docs
        .map((d) => ({ id: d.id, r: d.data() as RuleDoc }))
        .filter(
          ({ r }) =>
            r.enabled &&
            ((r.scope === "subscription" && r.subscriptionId === subscriptionId) ||
              r.scope === "global"),
        )
        .map(({ id, r }) => ({ id, rule: r.ruleJson }));
    },

    async latestSnapshot(videoId) {
      const snap = await snapshots
        .where("videoId", "==", videoId)
        .orderBy("capturedAt", "desc")
        .limit(1)
        .get();
      return snap.empty ? null : toSnapshot(snap.docs[0].data() as SnapshotDoc);
    },

    async pastVideos(channelId, excludeVideoId, limit) {
      // One extra, so dropping the excluded video still leaves `limit`.
      const snap = await videos
        .where("channelId", "==", channelId)
        .orderBy("publishedAt", "desc")
        .limit(limit + 1)
        .get();
      return snap.docs
        .filter((d) => d.id !== excludeVideoId)
        .slice(0, limit)
        .map((d) => ({ id: d.id, publishedAt: (d.data() as VideoDoc).publishedAt.toDate() }));
    },

    async snapshotAtOrBefore(videoId, cutoff) {
      const snap = await snapshots
        .where("videoId", "==", videoId)
        .where("capturedAt", "<=", Timestamp.fromDate(cutoff))
        .orderBy("capturedAt", "desc")
        .limit(1)
        .get();
      return snap.empty ? null : toSnapshot(snap.docs[0].data() as SnapshotDoc);
    },

    async markDigested(subscriptionIds, runDate) {
      const at = Timestamp.fromDate(runDate);
      await commitInChunks(
        subscriptionIds.map((id) => (b: WriteBatch) =>
          b.update(subscriptions.doc(id), { lastDigestedAt: at }),
        ),
      );
    },

    async recordDigest(userId, cadence, runDate, lines) {
      // ON CONFLICT (digest_run_id, video_id) DO NOTHING: one line per video.
      const seen = new Set<string>();
      const unique = lines.filter((l) => !seen.has(l.videoId) && seen.add(l.videoId));

      const now = Timestamp.now();
      // The run plus one notified doc per video in a single batch, so a
      // recorded digest and "don't send these again" can't come apart. A
      // batch caps at 500 writes; a digest of 499 videos is far past what
      // anyone reads in one email.
      const batch = db.batch();
      batch.set(runs.doc(randomUUID()), {
        userId,
        cadence,
        runDate,
        sentAt: now,
        createdAt: now,
        lines: unique,
      } satisfies DigestRunDoc);
      for (const l of unique) {
        batch.set(notified.doc(`${userId}_${l.videoId}`), { userId, videoId: l.videoId, notifiedAt: now });
      }
      await batch.commit();
    },

    async close() {
      // No-op by design. The Firestore client is shared across warm
      // invocations of a Function instance; terminating it here would break
      // the next request served by the same instance.
    },
  };
}
