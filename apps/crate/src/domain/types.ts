import { z } from "zod";

export const QUEUE_STATUS = z.enum(["queued", "listened", "skipped"]);
export type QueueStatus = z.infer<typeof QUEUE_STATUS>;

export const albumInput = z.object({
  providerAlbumId: z.string().min(1),
  providerArtistId: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().min(1),
  year: z.number().int().nullable().optional(),
  artworkUrl: z.string().url().nullable().optional(),
  appleMusicUrl: z.string().url().nullable().optional(),
  genre: z.string().nullable().optional(),
});
export type AlbumInput = z.infer<typeof albumInput>;

/**
 * Wire shapes are snake_case because they started life as raw Postgres rows and
 * apps/crate/web/src/api.ts reads those keys directly. The Firestore repo has to
 * produce the same keys — the field naming is part of the API contract now, not
 * an artifact of the query.
 */
export interface QueueRow {
  id: string;
  status: QueueStatus;
  added_at: string;
  listened_at: string | null;
  rating: number | null;
  album_id: string;
  title: string;
  release_year: number | null;
  artwork_url: string | null;
  apple_music_url: string | null;
  genre: string | null;
  artist: string;
}

export type RandomPick = Omit<QueueRow, "status" | "added_at" | "listened_at">;

export interface GenreCount {
  genre: string;
  count: number;
}

export type QueueStatusMap = Record<
  string,
  { status: QueueStatus; queueId: string; rating: number | null }
>;
