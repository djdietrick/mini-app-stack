import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import { z } from "zod";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresClient, createRedisClient } from "@stack/db-clients";
import { AuthClient } from "@stack/auth-client";
import { registerAuth } from "@stack/auth-client/fastify";
import { config } from "./config.js";
import { runMigrations } from "./migrate.js";
import { search, getArtistAlbums } from "./itunes.js";

const pg = createPostgresClient({ url: config.databaseUrl, schema: "crate" });
const redis = createRedisClient({ url: config.redisUrl, keyPrefix: "crate:" });

await runMigrations(pg);

const app = Fastify({ logger: true });
const { sql } = pg;

const auth = new AuthClient({
  authUrl: config.authUrl,
  cookieName: config.authCookieName,
  verifySecret: config.authVerifySecret,
});

const PROVIDER = "itunes";

const apiRoutes = async (api: FastifyInstance) => {
  registerAuth(api, { client: auth });

  api.get("/health", async () => ({ ok: true }));

  api.get("/search", async (req, reply) => {
    const q = z.object({ q: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "missing q" });
    return await search(q.data.q, redis);
  });

  const artistParam = z.object({ artistId: z.string().regex(/^\d+$/) });

  api.get("/artists/:artistId/albums", async (req, reply) => {
    const parsed = artistParam.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return await getArtistAlbums(parsed.data.artistId, redis);
  });

  const queueBody = z.object({
    providerAlbumId: z.string().min(1),
    providerArtistId: z.string().min(1),
    title: z.string().min(1),
    artist: z.string().min(1),
    year: z.number().int().nullable().optional(),
    artworkUrl: z.string().url().nullable().optional(),
    appleMusicUrl: z.string().url().nullable().optional(),
    genre: z.string().nullable().optional(),
  });

  api.post("/queue", async (req, reply) => {
    const parsed = queueBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const a = parsed.data;
    const userId = req.user!.userId;

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

    return reply.code(inserted.length ? 201 : 200).send({ albumId, queued: inserted.length > 0 });
  });

  const queueListQuery = z.object({
    status: z.enum(["queued", "listened", "skipped"]).optional(),
  });

  api.get("/queue", async (req, reply) => {
    const parsed = queueListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const status = parsed.data.status;
    const userId = req.user!.userId;

    return await sql`
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
  });

  const statusBody = z.object({
    providerAlbumIds: z.array(z.string().min(1)).max(500),
  });

  api.post("/queue/status", async (req, reply) => {
    const parsed = statusBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const ids = parsed.data.providerAlbumIds;
    if (ids.length === 0) return {};
    const userId = req.user!.userId;
    const rows = await sql<
      {
        provider_album_id: string;
        status: "queued" | "listened" | "skipped";
        queue_id: string;
        rating: number | null;
      }[]
    >`
      SELECT a.provider_album_id, q.status, q.id AS queue_id, q.rating
      FROM queue q
      JOIN albums a ON a.id = q.album_id
      WHERE q.user_id = ${userId}
        AND a.provider = ${PROVIDER}
        AND a.provider_album_id = ANY(${ids})
    `;
    const out: Record<string, { status: string; queueId: string; rating: number | null }> = {};
    for (const r of rows) {
      out[r.provider_album_id] = { status: r.status, queueId: r.queue_id, rating: r.rating };
    }
    return out;
  });

  const randomQuery = z.object({ genre: z.string().min(1).optional() });

  api.get("/queue/random", async (req, reply) => {
    const parsed = randomQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.user!.userId;
    const genre = parsed.data.genre;
    const rows = await sql`
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
    if (rows.length === 0) return reply.code(404).send({ error: "queue is empty" });
    return rows[0];
  });

  const genresQuery = z.object({
    status: z.enum(["queued", "listened", "skipped"]).optional(),
  });

  api.get("/queue/genres", async (req, reply) => {
    const parsed = genresQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const status = parsed.data.status;
    const userId = req.user!.userId;
    return await sql`
      SELECT a.genre, COUNT(*)::int AS count
      FROM queue q
      JOIN albums a ON a.id = q.album_id
      WHERE q.user_id = ${userId}
        AND a.genre IS NOT NULL
        ${status ? sql`AND q.status = ${status}` : sql``}
      GROUP BY a.genre
      ORDER BY count DESC, a.genre ASC
    `;
  });

  const idParam = z.object({ id: z.string().uuid() });

  api.post("/queue/:id/listened", async (req, reply) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.user!.userId;
    const rows = await sql`
      UPDATE queue SET status = 'listened', listened_at = now()
      WHERE id = ${parsed.data.id} AND user_id = ${userId}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  api.post("/queue/:id/skip", async (req, reply) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.user!.userId;
    const rows = await sql`
      UPDATE queue SET status = 'skipped'
      WHERE id = ${parsed.data.id} AND user_id = ${userId}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  const ratingBody = z.object({
    rating: z.number().int().min(1).max(5).nullable(),
  });

  api.post("/queue/:id/rating", async (req, reply) => {
    const parsedId = idParam.safeParse(req.params);
    if (!parsedId.success) return reply.code(400).send({ error: parsedId.error.flatten() });
    const parsedBody = ratingBody.safeParse(req.body);
    if (!parsedBody.success) return reply.code(400).send({ error: parsedBody.error.flatten() });
    const userId = req.user!.userId;
    const rows = await sql`
      UPDATE queue SET rating = ${parsedBody.data.rating}
      WHERE id = ${parsedId.data.id} AND user_id = ${userId}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  api.post("/queue/:id/requeue", async (req, reply) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.user!.userId;
    const rows = await sql`
      UPDATE queue SET status = 'queued', listened_at = NULL, added_at = now()
      WHERE id = ${parsed.data.id} AND user_id = ${userId}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  api.delete("/queue/:id", async (req, reply) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.user!.userId;
    const rows = await sql`
      DELETE FROM queue
      WHERE id = ${parsed.data.id} AND user_id = ${userId}
      RETURNING id
    `;
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
};

await app.register(apiRoutes, { prefix: "/api" });

// Reverse-proxy /auth/* to apps/auth so the browser keeps a first-party
// cookie on the crate origin. The auth service sees /login, /signup, etc.
await app.register(fastifyHttpProxy, {
  upstream: config.authUrl,
  prefix: "/auth",
  rewritePrefix: "",
});

// Top-level /health kept for back-compat with infra checks.
app.get("/health", async () => ({ ok: true }));

const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
await app.register(fastifyStatic, { root: webDist });
// SPA fallback: any non-/api GET serves index.html so the client router handles it.
app.setNotFoundHandler((req, reply) => {
  if (req.method !== "GET" || req.url.startsWith("/api") || req.url.startsWith("/auth")) {
    return reply.code(404).send({ error: "not found" });
  }
  return reply.sendFile("index.html");
});

const shutdown = async () => {
  await app.close();
  await pg.close();
  redis.disconnect();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
