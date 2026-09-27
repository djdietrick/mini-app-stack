import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresClient, createRedisClient } from "@stack/db-clients";
import { AuthClient } from "@stack/auth-client";
import { stackVerifier } from "@stack/auth-client/verifier";
import { redisCache, runMigrations } from "@stack/service-kit";
import { toFastifyPlugin } from "@stack/service-kit/fastify";
import { config } from "./config.js";
import { createItunesGateway } from "./domain/itunes.js";
import { crateRoutes } from "./domain/routes.js";
import { createPostgresCrateRepo } from "./repo/postgres.js";

/**
 * Self-hosted entrypoint. All routing and business logic lives in
 * src/domain/routes.ts; this file only wires the Postgres/Redis/apps/auth
 * implementations into it and serves the SPA. The cloud entrypoint
 * (functions/src/index.ts) wires the Firestore/Firebase implementations into
 * the exact same route table.
 */
const here = dirname(fileURLToPath(import.meta.url));

const pg = createPostgresClient({ url: config.databaseUrl, schema: "crate" });
const redis = createRedisClient({ url: config.redisUrl, keyPrefix: "crate:" });

await runMigrations(pg, join(here, "..", "migrations"));

const repo = createPostgresCrateRepo(pg);
const itunes = createItunesGateway(redisCache(redis));

const auth = new AuthClient({
  authUrl: config.authUrl,
  cookieName: config.authCookieName,
  verifySecret: config.authVerifySecret,
});

const app = Fastify({ logger: true });

await app.register(
  toFastifyPlugin(crateRoutes({ itunes }), {
    repo,
    verify: stackVerifier(auth).verify,
    logger: app.log,
  }),
  { prefix: "/api" },
);

// Reverse-proxy /auth/* to apps/auth so the browser keeps a first-party
// cookie on the crate origin. The auth service sees /login, /signup, etc.
await app.register(fastifyHttpProxy, {
  upstream: config.authUrl,
  prefix: "/auth",
  rewritePrefix: "",
});

// Top-level /health kept for back-compat with infra checks.
app.get("/health", async () => ({ ok: true }));

const webDist = join(here, "..", "web", "dist");
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
  await repo.close();
  redis.disconnect();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
