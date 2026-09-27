import type { Closable } from "@stack/service-kit";
import type {
  AlbumInput,
  GenreCount,
  QueueRow,
  QueueStatus,
  QueueStatusMap,
  RandomPick,
} from "../domain/types.js";

/**
 * crate's data port. Implemented twice: postgres.ts (self-hosted) and
 * firestore.ts (cloud). Domain code depends only on this.
 *
 * Mutations return a boolean rather than throwing so the domain layer owns the
 * 404 — the repo has no opinion about HTTP. Every mutation takes userId so
 * ownership is enforced in the query itself, not by a separate read.
 */
export interface CrateRepo extends Closable {
  /**
   * Upserts artist and album into the shared catalog, then queues the album for
   * this user. `queued` is false when it was already in their queue, which the
   * route turns into a 200 instead of a 201.
   */
  addToQueue(userId: string, album: AlbumInput): Promise<{ albumId: string; queued: boolean }>;

  listQueue(userId: string, status?: QueueStatus): Promise<QueueRow[]>;

  /** Maps provider album ids to queue state, for badging search results. */
  statusFor(userId: string, providerAlbumIds: string[]): Promise<QueueStatusMap>;

  /** One random still-queued album, optionally constrained to a genre. */
  randomQueued(userId: string, genre?: string): Promise<RandomPick | null>;

  genreCounts(userId: string, status?: QueueStatus): Promise<GenreCount[]>;

  markListened(userId: string, id: string): Promise<boolean>;
  skip(userId: string, id: string): Promise<boolean>;
  setRating(userId: string, id: string, rating: number | null): Promise<boolean>;
  requeue(userId: string, id: string): Promise<boolean>;
  remove(userId: string, id: string): Promise<boolean>;
}
