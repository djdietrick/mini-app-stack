import { randomUUID } from "node:crypto";
import { Timestamp } from "@google-cloud/firestore";
import type { Firestore, Transaction } from "@google-cloud/firestore";
import type {
  AlbumInput,
  GenreCount,
  QueueRow,
  QueueStatus,
  QueueStatusMap,
  RandomPick,
} from "../domain/types.js";
import type { CrateRepo } from "./types.js";

const PROVIDER = "itunes";

/**
 * Cloud implementation.
 *
 * Document layout:
 *   crate_albums/{itunes_<providerAlbumId>}   shared catalog, one per album
 *   crate_queue/{uuid}                        one per user+album
 *
 * Two modelling decisions worth knowing about:
 *
 * 1. Album and artist metadata is DENORMALISED onto the queue document.
 *    Postgres served /queue with `queue JOIN albums JOIN artists`; Firestore
 *    cannot join, and fetching each album per row would be N+1. The cost is
 *    that editing an album in the catalog does not retro-update queue rows
 *    already created from it. Acceptable here: iTunes is the source of truth
 *    and the fields are a snapshot of what the user queued.
 *
 * 2. Document ids are app-generated UUIDs rather than Firestore auto-ids, so
 *    `z.string().uuid()` on the route params keeps working and ids look the
 *    same on both backends.
 */
export function createFirestoreCrateRepo(db: Firestore, prefix = "crate_"): CrateRepo {
  const albums = db.collection(`${prefix}albums`);
  const queue = db.collection(`${prefix}queue`);

  const albumDocId = (providerAlbumId: string) => `${PROVIDER}_${providerAlbumId}`;

  interface QueueDoc {
    userId: string;
    albumId: string;
    providerAlbumId: string;
    status: QueueStatus;
    rating: number | null;
    addedAt: Timestamp;
    listenedAt: Timestamp | null;
    // denormalised album snapshot
    title: string;
    artist: string;
    releaseYear: number | null;
    artworkUrl: string | null;
    appleMusicUrl: string | null;
    genre: string | null;
  }

  const toRow = (id: string, d: QueueDoc): QueueRow => ({
    id,
    status: d.status,
    added_at: d.addedAt.toDate().toISOString(),
    listened_at: d.listenedAt ? d.listenedAt.toDate().toISOString() : null,
    rating: d.rating,
    album_id: d.albumId,
    title: d.title,
    release_year: d.releaseYear,
    artwork_url: d.artworkUrl,
    apple_music_url: d.appleMusicUrl,
    genre: d.genre,
    artist: d.artist,
  });

  /** Ownership is enforced in the read, mirroring `WHERE ... AND user_id = $1`. */
  async function mutate(
    userId: string,
    id: string,
    patch: (d: QueueDoc) => Partial<QueueDoc> | null,
  ): Promise<boolean> {
    const ref = queue.doc(id);
    return db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const doc = snap.data() as QueueDoc;
      if (doc.userId !== userId) return false;
      const update = patch(doc);
      if (update === null) tx.delete(ref);
      else tx.update(ref, update);
      return true;
    });
  }

  return {
    async addToQueue(userId, a: AlbumInput) {
      const albumRef = albums.doc(albumDocId(a.providerAlbumId));

      // Matches the SQL's ON CONFLICT DO UPDATE: refresh the catalog entry but
      // keep an existing genre when the incoming payload has none.
      await albumRef.set(
        {
          provider: PROVIDER,
          providerAlbumId: a.providerAlbumId,
          providerArtistId: a.providerArtistId,
          title: a.title,
          artist: a.artist,
          releaseYear: a.year ?? null,
          artworkUrl: a.artworkUrl ?? null,
          appleMusicUrl: a.appleMusicUrl ?? null,
          ...(a.genre != null ? { genre: a.genre } : {}),
        },
        { merge: true },
      );

      // Stands in for UNIQUE (user_id, album_id): Firestore has no unique
      // constraints, so the duplicate check and the insert must share a
      // transaction. The callback is safe to retry — a fresh id is minted per
      // attempt and only the committing attempt writes.
      const dupe = queue
        .where("userId", "==", userId)
        .where("providerAlbumId", "==", a.providerAlbumId)
        .limit(1);

      const queued = await db.runTransaction(async (tx) => {
        const existing = await tx.get(dupe);
        if (!existing.empty) return false;

        const doc: QueueDoc = {
          userId,
          albumId: albumRef.id,
          providerAlbumId: a.providerAlbumId,
          status: "queued",
          rating: null,
          addedAt: Timestamp.now(),
          listenedAt: null,
          title: a.title,
          artist: a.artist,
          releaseYear: a.year ?? null,
          artworkUrl: a.artworkUrl ?? null,
          appleMusicUrl: a.appleMusicUrl ?? null,
          genre: a.genre ?? null,
        };
        tx.set(queue.doc(randomUUID()), doc);
        return true;
      });

      return { albumId: albumRef.id, queued };
    },

    async listQueue(userId, status) {
      let q = queue.where("userId", "==", userId);
      if (status) q = q.where("status", "==", status);
      const snap = await q.orderBy("addedAt", "desc").get();
      return snap.docs.map((d) => toRow(d.id, d.data() as QueueDoc));
    },

    async statusFor(userId, providerAlbumIds) {
      if (providerAlbumIds.length === 0) return {};

      // Firestore caps an `in` filter at 30 values; the route allows up to 500,
      // so chunk and run the reads in parallel.
      const chunks: string[][] = [];
      for (let i = 0; i < providerAlbumIds.length; i += 30) {
        chunks.push(providerAlbumIds.slice(i, i + 30));
      }

      const results = await Promise.all(
        chunks.map((chunk) =>
          queue.where("userId", "==", userId).where("providerAlbumId", "in", chunk).get(),
        ),
      );

      const out: QueueStatusMap = {};
      for (const snap of results) {
        for (const d of snap.docs) {
          const doc = d.data() as QueueDoc;
          out[doc.providerAlbumId] = { status: doc.status, queueId: d.id, rating: doc.rating };
        }
      }
      return out;
    },

    async randomQueued(userId, genre) {
      // No ORDER BY random() in Firestore. Queues are per-user and small, so
      // reading the candidate set and picking in memory is cheaper and simpler
      // than maintaining a random-float column and querying around it.
      let q = queue.where("userId", "==", userId).where("status", "==", "queued");
      if (genre) q = q.where("genre", "==", genre);
      const snap = await q.get();
      if (snap.empty) return null;

      const chosen = snap.docs[Math.floor(Math.random() * snap.docs.length)];
      const { status: _s, added_at: _a, listened_at: _l, ...pick } = toRow(
        chosen.id,
        chosen.data() as QueueDoc,
      );
      return pick as RandomPick;
    },

    async genreCounts(userId, status) {
      // Firestore has no GROUP BY. Aggregating in memory over one user's queue
      // is fine at this size and avoids maintaining counter documents.
      let q = queue.where("userId", "==", userId);
      if (status) q = q.where("status", "==", status);
      const snap = await q.get();

      const counts = new Map<string, number>();
      for (const d of snap.docs) {
        const { genre } = d.data() as QueueDoc;
        if (!genre) continue;
        counts.set(genre, (counts.get(genre) ?? 0) + 1);
      }

      // Same ordering the SQL produced: count desc, then genre asc.
      return [...counts.entries()]
        .map(([genre, count]): GenreCount => ({ genre, count }))
        .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
    },

    markListened: (userId, id) =>
      mutate(userId, id, () => ({ status: "listened", listenedAt: Timestamp.now() })),

    skip: (userId, id) => mutate(userId, id, () => ({ status: "skipped" })),

    setRating: (userId, id, rating) => mutate(userId, id, () => ({ rating })),

    requeue: (userId, id) =>
      mutate(userId, id, () => ({
        status: "queued",
        listenedAt: null,
        addedAt: Timestamp.now(),
      })),

    remove: (userId, id) => mutate(userId, id, () => null),

    async close() {
      // No-op by design. The Firestore client is shared across warm
      // invocations of a Function instance; terminating it here would break
      // the next request served by the same instance.
    },
  };
}
