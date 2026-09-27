import type { PostgresClient } from "@stack/db-clients";
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
 * Self-hosted implementation. The SQL here is lifted unchanged from the
 * pre-refactor apps/crate/src/index.ts so wire responses stay byte-identical;
 * unqualified table names resolve into the `crate` schema via search_path.
 */
export function createPostgresCrateRepo(pg: PostgresClient): CrateRepo {
  const { sql } = pg;

  return {
    async addToQueue(userId: string, a: AlbumInput) {
      const [{ id: artistId }] = await sql<{ id: string }[]>`
        INSERT INTO artists (name, provider, provider_artist_id)
        VALUES (${a.artist}, ${PROVIDER}, ${a.providerArtistId})
        ON CONFLICT (provider, provider_artist_id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;

      const [{ id: albumId }] = await sql<{ id: string }[]>`
        INSERT INTO albums (title, artist_id, release_year, artwork_url, apple_music_url, genre, provider, provider_album_id)
        VALUES (
          ${a.title}, ${artistId}, ${a.year ?? null}, ${a.artworkUrl ?? null},
          ${a.appleMusicUrl ?? null}, ${a.genre ?? null}, ${PROVIDER}, ${a.providerAlbumId}
        )
        ON CONFLICT (provider, provider_album_id) DO UPDATE SET
          title = EXCLUDED.title,
          artwork_url = EXCLUDED.artwork_url,
          apple_music_url = EXCLUDED.apple_music_url,
          genre = COALESCE(EXCLUDED.genre, albums.genre)
        RETURNING id
      `;

      const inserted = await sql<{ id: string }[]>`
        INSERT INTO queue (user_id, album_id) VALUES (${userId}, ${albumId})
        ON CONFLICT (user_id, album_id) DO NOTHING
        RETURNING id
      `;

      return { albumId, queued: inserted.length > 0 };
    },

    async listQueue(userId: string, status?: QueueStatus) {
      return await sql<QueueRow[]>`
        SELECT q.id, q.status, q.added_at, q.listened_at, q.rating,
               a.id AS album_id, a.title, a.release_year, a.artwork_url, a.apple_music_url, a.genre,
               ar.name AS artist
        FROM queue q
        JOIN albums a ON a.id = q.album_id
        JOIN artists ar ON ar.id = a.artist_id
        WHERE q.user_id = ${userId}
          ${status ? sql`AND q.status = ${status}` : sql``}
        ORDER BY q.added_at DESC
      `;
    },

    async statusFor(userId: string, providerAlbumIds: string[]) {
      if (providerAlbumIds.length === 0) return {};
      const rows = await sql<
        {
          provider_album_id: string;
          status: QueueStatus;
          queue_id: string;
          rating: number | null;
        }[]
      >`
        SELECT a.provider_album_id, q.status, q.id AS queue_id, q.rating
        FROM queue q
        JOIN albums a ON a.id = q.album_id
        WHERE q.user_id = ${userId}
          AND a.provider = ${PROVIDER}
          AND a.provider_album_id = ANY(${providerAlbumIds})
      `;
      const out: QueueStatusMap = {};
      for (const r of rows) {
        out[r.provider_album_id] = { status: r.status, queueId: r.queue_id, rating: r.rating };
      }
      return out;
    },

    async randomQueued(userId: string, genre?: string) {
      const rows = await sql<RandomPick[]>`
        SELECT q.id, q.rating,
               a.id AS album_id, a.title, a.release_year, a.artwork_url, a.apple_music_url, a.genre,
               ar.name AS artist
        FROM queue q
        JOIN albums a ON a.id = q.album_id
        JOIN artists ar ON ar.id = a.artist_id
        WHERE q.user_id = ${userId} AND q.status = 'queued'
          ${genre ? sql`AND a.genre = ${genre}` : sql``}
        ORDER BY random()
        LIMIT 1
      `;
      return rows[0] ?? null;
    },

    async genreCounts(userId: string, status?: QueueStatus) {
      return await sql<GenreCount[]>`
        SELECT a.genre, COUNT(*)::int AS count
        FROM queue q
        JOIN albums a ON a.id = q.album_id
        WHERE q.user_id = ${userId}
          AND a.genre IS NOT NULL
          ${status ? sql`AND q.status = ${status}` : sql``}
        GROUP BY a.genre
        ORDER BY count DESC, a.genre ASC
      `;
    },

    async markListened(userId: string, id: string) {
      const rows = await sql`
        UPDATE queue SET status = 'listened', listened_at = now()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    async skip(userId: string, id: string) {
      const rows = await sql`
        UPDATE queue SET status = 'skipped'
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    async setRating(userId: string, id: string, rating: number | null) {
      const rows = await sql`
        UPDATE queue SET rating = ${rating}
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    async requeue(userId: string, id: string) {
      const rows = await sql`
        UPDATE queue SET status = 'queued', listened_at = NULL, added_at = now()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    async remove(userId: string, id: string) {
      const rows = await sql`
        DELETE FROM queue
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    close: () => pg.close(),
  };
}
