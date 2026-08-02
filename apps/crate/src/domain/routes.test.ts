import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import Fastify from "fastify";
import { toExpressApp } from "@stack/service-kit/express";
import { toFastifyPlugin } from "@stack/service-kit/fastify";
import type { AlbumInput, QueueRow, QueueStatus } from "./types.js";
import type { CrateRepo } from "../repo/types.js";
import { crateRoutes } from "./routes.js";
import type { ItunesGateway, NormalizedAlbum } from "./itunes.js";

/**
 * Pins crate's HTTP contract as it behaved before the routes moved out of
 * Fastify handlers: same status codes, same error bodies, same snake_case
 * wire shape that apps/crate/web/src/api.ts reads. Runs the one route table
 * through both adapters, because both must serve it identically.
 */

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

interface Entry {
  id: string;
  albumId: string;
  status: QueueStatus;
  rating: number | null;
  album: AlbumInput;
}

/** In-memory stand-in with the same observable semantics as the SQL. */
function fakeRepo(): CrateRepo & { entries: Map<string, Entry> } {
  const entries = new Map<string, Entry>();
  const owned = (userId: string, id: string) =>
    userId === USER.userId ? entries.get(id) : undefined;

  const toRow = (e: Entry): QueueRow => ({
    id: e.id,
    status: e.status,
    added_at: "2026-01-01T00:00:00.000Z",
    listened_at: null,
    rating: e.rating,
    album_id: e.albumId,
    title: e.album.title,
    release_year: e.album.year ?? null,
    artwork_url: e.album.artworkUrl ?? null,
    apple_music_url: e.album.appleMusicUrl ?? null,
    genre: e.album.genre ?? null,
    artist: e.album.artist,
  });

  return {
    entries,
    async addToQueue(_userId, album) {
      const existing = [...entries.values()].find(
        (e) => e.album.providerAlbumId === album.providerAlbumId,
      );
      if (existing) return { albumId: existing.albumId, queued: false };
      const id = randomUUID();
      const albumId = randomUUID();
      entries.set(id, { id, albumId, status: "queued", rating: null, album });
      return { albumId, queued: true };
    },
    async listQueue(_userId, status) {
      return [...entries.values()].filter((e) => !status || e.status === status).map(toRow);
    },
    async statusFor(_userId, ids) {
      const out: Record<string, { status: QueueStatus; queueId: string; rating: number | null }> =
        {};
      for (const e of entries.values()) {
        if (ids.includes(e.album.providerAlbumId)) {
          out[e.album.providerAlbumId] = { status: e.status, queueId: e.id, rating: e.rating };
        }
      }
      return out;
    },
    async randomQueued(_userId, genre) {
      const pool = [...entries.values()].filter(
        (e) => e.status === "queued" && (!genre || e.album.genre === genre),
      );
      if (pool.length === 0) return null;
      const { status: _s, added_at: _a, listened_at: _l, ...pick } = toRow(pool[0]);
      return pick;
    },
    async genreCounts(_userId, status) {
      const counts = new Map<string, number>();
      for (const e of entries.values()) {
        if (status && e.status !== status) continue;
        if (!e.album.genre) continue;
        counts.set(e.album.genre, (counts.get(e.album.genre) ?? 0) + 1);
      }
      return [...counts].map(([genre, count]) => ({ genre, count }));
    },
    async markListened(userId, id) {
      const e = owned(userId, id);
      if (e) e.status = "listened";
      return Boolean(e);
    },
    async skip(userId, id) {
      const e = owned(userId, id);
      if (e) e.status = "skipped";
      return Boolean(e);
    },
    async setRating(userId, id, rating) {
      const e = owned(userId, id);
      if (e) e.rating = rating;
      return Boolean(e);
    },
    async requeue(userId, id) {
      const e = owned(userId, id);
      if (e) e.status = "queued";
      return Boolean(e);
    },
    async remove(userId, id) {
      return Boolean(owned(userId, id)) && entries.delete(id);
    },
    async close() {},
  };
}

// iTunes results are NormalizedAlbum (every field present, nullable), which is
// deliberately not the same type as AlbumInput (fields optional) — the gateway
// normalises before anything reaches the queue.
const NORMALIZED: NormalizedAlbum = {
  providerAlbumId: ALBUM.providerAlbumId,
  providerArtistId: ALBUM.providerArtistId,
  title: ALBUM.title,
  artist: ALBUM.artist,
  year: ALBUM.year ?? null,
  artworkUrl: ALBUM.artworkUrl ?? null,
  appleMusicUrl: ALBUM.appleMusicUrl ?? null,
  genre: ALBUM.genre ?? null,
};

const itunes: ItunesGateway = {
  async search(q) {
    return { artists: [], albums: [{ ...NORMALIZED, title: `result for ${q}` }] };
  },
  async artistAlbums(artistId) {
    return { artist: null, albums: [{ ...NORMALIZED, providerArtistId: artistId }] };
  },
};

const USER = { userId: randomUUID(), email: "me@example.com", displayName: null };

type Call = (
  method: string,
  path: string,
  opts?: { auth?: boolean; body?: unknown },
) => Promise<{ status: number; body: any }>;

function makeCall(base: string): Call {
  return async (method, path, opts = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.auth === false ? {} : { cookie: "stack_session=valid" }),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

// The verifier is the seam that differs between deployments; here it just
// accepts the sentinel cookie so the tests exercise the routes, not auth.
const verify = async (headers: Record<string, string | string[] | undefined>) =>
  String(headers["cookie"] ?? "").includes("stack_session=valid") ? USER : null;

for (const adapter of ["fastify", "express"] as const) {
  describe(`crate routes (${adapter})`, () => {
    let repo: ReturnType<typeof fakeRepo>;
    let call: Call;
    let stop: () => Promise<void>;

    before(async () => {
      repo = fakeRepo();
      const routes = crateRoutes({ itunes });

      if (adapter === "fastify") {
        const app = Fastify();
        await app.register(toFastifyPlugin(routes, { repo, verify }), { prefix: "/api" });
        await app.listen({ port: 0, host: "127.0.0.1" });
        const { port } = app.server.address() as { port: number };
        call = makeCall(`http://127.0.0.1:${port}`);
        stop = () => app.close();
      } else {
        const outer = (await import("express")).default();
        outer.use("/api", toExpressApp(routes, { repo, verify }));
        const server = outer.listen(0, "127.0.0.1");
        await new Promise((r) => server.once("listening", r));
        const { port } = server.address() as { port: number };
        call = makeCall(`http://127.0.0.1:${port}`);
        stop = () => new Promise<void>((r) => server.close(() => r()));
      }
    });

    after(async () => {
      await stop();
    });

    it("GET /health is public", async () => {
      const res = await call("GET", "/health", { auth: false });
      assert.deepEqual(res, { status: 200, body: { ok: true } });
    });

    it("401s every data route without a session", async () => {
      for (const [method, path] of [
        ["GET", "/queue"],
        ["POST", "/queue"],
        ["GET", "/queue/random"],
        ["GET", "/search?q=miles"],
      ] as const) {
        const res = await call(method, path, { auth: false });
        assert.equal(res.status, 401, `${method} ${path}`);
        assert.deepEqual(res.body, { error: "not signed in" });
      }
    });

    it("GET /search requires q and keeps its bespoke 400 message", async () => {
      const bad = await call("GET", "/search");
      assert.equal(bad.status, 400);
      assert.deepEqual(bad.body, { error: "missing q" });

      const good = await call("GET", "/search?q=miles");
      assert.equal(good.status, 200);
      assert.equal(good.body.albums[0].title, "result for miles");
    });

    it("GET /artists/:artistId/albums rejects a non-numeric id", async () => {
      const bad = await call("GET", "/artists/abc/albums");
      assert.equal(bad.status, 400);
      assert.ok(bad.body.error.fieldErrors.artistId);

      const good = await call("GET", "/artists/909253/albums");
      assert.equal(good.status, 200);
      assert.equal(good.body.albums[0].providerArtistId, "909253");
    });

    it("POST /queue returns 201 first time and 200 on a repeat", async () => {
      const first = await call("POST", "/queue", { body: ALBUM });
      assert.equal(first.status, 201);
      assert.equal(first.body.queued, true);
      assert.ok(first.body.albumId);

      const again = await call("POST", "/queue", { body: ALBUM });
      assert.equal(again.status, 200);
      assert.equal(again.body.queued, false);
      assert.equal(again.body.albumId, first.body.albumId);
    });

    it("POST /queue rejects a malformed body", async () => {
      const res = await call("POST", "/queue", { body: { title: "no ids" } });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.fieldErrors.providerAlbumId);
    });

    it("GET /queue returns snake_case rows the SPA expects", async () => {
      const res = await call("GET", "/queue");
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 1);
      assert.deepEqual(Object.keys(res.body[0]).sort(), [
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
    });

    it("GET /queue rejects an unknown status filter", async () => {
      const res = await call("GET", "/queue?status=bogus");
      assert.equal(res.status, 400);
      assert.ok(res.body.error.fieldErrors.status);
    });

    it("POST /queue/status maps provider ids to queue state", async () => {
      const res = await call("POST", "/queue/status", {
        body: { providerAlbumIds: [ALBUM.providerAlbumId, "does-not-exist"] },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body[ALBUM.providerAlbumId].status, "queued");
      assert.equal(res.body["does-not-exist"], undefined);

      const empty = await call("POST", "/queue/status", { body: { providerAlbumIds: [] } });
      assert.deepEqual(empty.body, {});
    });

    it("GET /queue/genres counts by genre", async () => {
      const res = await call("GET", "/queue/genres");
      assert.deepEqual(res.body, [{ genre: "Jazz", count: 1 }]);
    });

    it("mutations 404 on an id the user does not own", async () => {
      const stranger = randomUUID();
      for (const [method, path] of [
        ["POST", `/queue/${stranger}/listened`],
        ["POST", `/queue/${stranger}/skip`],
        ["POST", `/queue/${stranger}/requeue`],
        ["DELETE", `/queue/${stranger}`],
      ] as const) {
        const res = await call(method, path);
        assert.equal(res.status, 404, `${method} ${path}`);
        assert.deepEqual(res.body, { error: "not found" });
      }
    });

    it("mutations reject a non-uuid id", async () => {
      const res = await call("POST", "/queue/not-a-uuid/listened");
      assert.equal(res.status, 400);
      assert.ok(res.body.error.fieldErrors.id);
    });

    it("POST /queue/:id/rating validates range and accepts null", async () => {
      const id = [...repo.entries.keys()][0];

      const tooHigh = await call("POST", `/queue/${id}/rating`, { body: { rating: 6 } });
      assert.equal(tooHigh.status, 400);

      const ok = await call("POST", `/queue/${id}/rating`, { body: { rating: 4 } });
      assert.deepEqual(ok, { status: 200, body: { ok: true } });
      assert.equal(repo.entries.get(id)!.rating, 4);

      const cleared = await call("POST", `/queue/${id}/rating`, { body: { rating: null } });
      assert.equal(cleared.status, 200);
      assert.equal(repo.entries.get(id)!.rating, null);
    });

    it("GET /queue/random 404s with 'queue is empty' once nothing is queued", async () => {
      const id = [...repo.entries.keys()][0];

      const pick = await call("GET", "/queue/random");
      assert.equal(pick.status, 200);
      assert.equal(pick.body.id, id);
      // random picks omit status/added_at/listened_at
      assert.equal(pick.body.status, undefined);

      const byGenre = await call("GET", "/queue/random?genre=Ambient");
      assert.equal(byGenre.status, 404);

      assert.equal((await call("POST", `/queue/${id}/listened`)).status, 200);

      const empty = await call("GET", "/queue/random");
      assert.equal(empty.status, 404);
      assert.deepEqual(empty.body, { error: "queue is empty" });
    });

    it("DELETE /queue/:id removes the entry", async () => {
      const id = [...repo.entries.keys()][0];
      assert.deepEqual(await call("DELETE", `/queue/${id}`), { status: 200, body: { ok: true } });
      assert.equal(repo.entries.size, 0);
      assert.equal((await call("DELETE", `/queue/${id}`)).status, 404);
    });
  });
}
