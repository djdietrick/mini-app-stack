import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Firestore } from "@google-cloud/firestore";
import type { AlbumInput } from "../domain/types.js";
import { createFirestoreCrateRepo } from "./firestore.js";
import type { CrateRepo } from "./types.js";

/**
 * Contract test for the Firestore backend. Asserts the semantics the Postgres
 * repo gets from SQL constraints and clauses that Firestore does not have:
 * the UNIQUE (user_id, album_id) dedupe, ownership scoping on every mutation,
 * added_at DESC ordering, and the genre count ordering.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set:
 *   pnpm emulators:up   (or firebase emulators:start --only firestore)
 */
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

const ALBUM: AlbumInput = {
  providerAlbumId: "1440857781",
  providerArtistId: "909253",
  title: "Kind of Blue",
  artist: "Miles Davis",
  year: 1959,
  artworkUrl: "https://example.com/a.jpg",
  appleMusicUrl: "https://music.apple.com/album/1440857781",
  genre: "Jazz",
};

const other = (over: Partial<AlbumInput>): AlbumInput => ({ ...ALBUM, ...over });

describe("firestore crate repo", { skip: EMULATOR ? false : "FIRESTORE_EMULATOR_HOST not set" }, () => {
  let repo: CrateRepo;
  let db: Firestore;
  const user = randomUUID();
  const stranger = randomUUID();

  before(() => {
    db = new Firestore({ projectId: "demo-crate", ignoreUndefinedProperties: true });
    // Each run gets its own prefix so repeats don't see stale documents.
    repo = createFirestoreCrateRepo(db, `t${Date.now()}_`);
  });

  after(async () => {
    await db.terminate();
  });

  it("dedupes on (user, album) the way UNIQUE (user_id, album_id) does", async () => {
    const first = await repo.addToQueue(user, ALBUM);
    assert.equal(first.queued, true);

    const again = await repo.addToQueue(user, ALBUM);
    assert.equal(again.queued, false);
    assert.equal(again.albumId, first.albumId, "same album doc is reused");

    // A different user queuing the same album is not a duplicate.
    const bySomeoneElse = await repo.addToQueue(stranger, ALBUM);
    assert.equal(bySomeoneElse.queued, true);
  });

  it("scopes listQueue to the user and returns the SPA's snake_case keys", async () => {
    const rows = await repo.listQueue(user);
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), [
      "added_at",
      "album_id",
      "apple_music_url",
      "artist",
      "artwork_url",
      "genre",
      "id",
      "listened_at",
      "rating",
      "release_year",
      "status",
      "title",
    ]);
    assert.equal(rows[0].title, ALBUM.title);
    assert.equal(rows[0].release_year, 1959);
    assert.equal(rows[0].listened_at, null);
    assert.ok(!Number.isNaN(Date.parse(rows[0].added_at)), "added_at is an ISO string");
  });

  it("orders listQueue by added_at DESC", async () => {
    await repo.addToQueue(user, other({ providerAlbumId: "222", title: "Second" }));
    await repo.addToQueue(user, other({ providerAlbumId: "333", title: "Third" }));

    const rows = await repo.listQueue(user);
    const times = rows.map((r) => Date.parse(r.added_at));
    assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first");
    assert.equal(rows[0].title, "Third");
  });

  it("refuses mutations on another user's row", async () => {
    const [mine] = await repo.listQueue(user);

    assert.equal(await repo.markListened(stranger, mine.id), false);
    assert.equal(await repo.setRating(stranger, mine.id, 5), false);
    assert.equal(await repo.remove(stranger, mine.id), false);

    // ...and the row is untouched.
    const rows = await repo.listQueue(user);
    const still = rows.find((r) => r.id === mine.id)!;
    assert.equal(still.status, "queued");
    assert.equal(still.rating, null);
  });

  it("returns false for an id that does not exist", async () => {
    assert.equal(await repo.markListened(user, randomUUID()), false);
    assert.equal(await repo.remove(user, randomUUID()), false);
  });

  it("round-trips status transitions and ratings", async () => {
    const [row] = await repo.listQueue(user);

    assert.equal(await repo.markListened(user, row.id), true);
    let found = (await repo.listQueue(user, "listened")).find((r) => r.id === row.id)!;
    assert.equal(found.status, "listened");
    assert.ok(found.listened_at, "listened_at is set");

    assert.equal(await repo.setRating(user, row.id, 4), true);
    found = (await repo.listQueue(user, "listened")).find((r) => r.id === row.id)!;
    assert.equal(found.rating, 4);

    assert.equal(await repo.setRating(user, row.id, null), true);
    found = (await repo.listQueue(user, "listened")).find((r) => r.id === row.id)!;
    assert.equal(found.rating, null);

    assert.equal(await repo.requeue(user, row.id), true);
    found = (await repo.listQueue(user, "queued")).find((r) => r.id === row.id)!;
    assert.equal(found.status, "queued");
    assert.equal(found.listened_at, null);

    assert.equal(await repo.skip(user, row.id), true);
    assert.equal((await repo.listQueue(user, "skipped")).some((r) => r.id === row.id), true);
  });

  it("statusFor maps provider ids and ignores unknown ones", async () => {
    const map = await repo.statusFor(user, [ALBUM.providerAlbumId, "222", "nope"]);
    assert.ok(map[ALBUM.providerAlbumId]);
    assert.ok(map["222"]);
    assert.equal(map["nope"], undefined);
    assert.deepEqual(await repo.statusFor(user, []), {});
  });

  it("statusFor chunks past Firestore's 30-value 'in' limit", async () => {
    const ids = Array.from({ length: 75 }, (_, i) => `bulk-${i}`);
    // Real ids interleaved so a broken chunk boundary would drop them.
    ids[0] = ALBUM.providerAlbumId;
    ids[40] = "222";
    ids[74] = "333";

    const map = await repo.statusFor(user, ids);
    assert.ok(map[ALBUM.providerAlbumId], "first chunk");
    assert.ok(map["222"], "middle chunk");
    assert.ok(map["333"], "last chunk");
  });

  it("genreCounts aggregates and orders by count desc then genre asc", async () => {
    const u = randomUUID();
    await repo.addToQueue(u, other({ providerAlbumId: "g1", genre: "Rock" }));
    await repo.addToQueue(u, other({ providerAlbumId: "g2", genre: "Rock" }));
    await repo.addToQueue(u, other({ providerAlbumId: "g3", genre: "Ambient" }));
    await repo.addToQueue(u, other({ providerAlbumId: "g4", genre: "Jazz" }));
    await repo.addToQueue(u, other({ providerAlbumId: "g5", genre: null }));

    assert.deepEqual(await repo.genreCounts(u), [
      { genre: "Rock", count: 2 },
      { genre: "Ambient", count: 1 },
      { genre: "Jazz", count: 1 },
    ]);
  });

  it("randomQueued honours the genre filter and returns null when empty", async () => {
    const u = randomUUID();
    assert.equal(await repo.randomQueued(u), null);

    await repo.addToQueue(u, other({ providerAlbumId: "r1", genre: "Jazz" }));
    const pick = (await repo.randomQueued(u, "Jazz"))!;
    assert.ok(pick);
    // RandomPick omits the three fields the SQL projection left out.
    assert.equal((pick as Record<string, unknown>).status, undefined);
    assert.equal((pick as Record<string, unknown>).added_at, undefined);
    assert.equal((pick as Record<string, unknown>).listened_at, undefined);

    assert.equal(await repo.randomQueued(u, "Ambient"), null);

    // A listened album is no longer a candidate.
    await repo.markListened(u, pick.id);
    assert.equal(await repo.randomQueued(u), null);
  });

  it("remove deletes the row", async () => {
    const u = randomUUID();
    await repo.addToQueue(u, other({ providerAlbumId: "d1" }));
    const [row] = await repo.listQueue(u);

    assert.equal(await repo.remove(u, row.id), true);
    assert.deepEqual(await repo.listQueue(u), []);
    assert.equal(await repo.remove(u, row.id), false);
  });
});
