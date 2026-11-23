import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresClient, createRedisClient } from "@stack/db-clients";
import { AuthClient } from "@stack/auth-client";
import { stackVerifier } from "@stack/auth-client/verifier";
import { redisLease, runMigrations } from "@stack/service-kit";
import { toFastifyPlugin } from "@stack/service-kit/fastify";
import { config } from "./config.js";
import type { BaselineOptions } from "./domain/rules/evaluate.js";
import { ytdigestRoutes } from "./domain/routes.js";
import { createYouTubeClient } from "./domain/youtube.js";
import { createPostgresYtdigestRepo } from "./repo/postgres.js";
import { startSchedulers } from "./scheduler.js";

/**
 * Self-hosted entrypoint. Routing, polling and the feed live in src/domain;
 * this file only wires the Postgres/Redis/apps/auth implementations into it,
 * serves the SPA and starts the poll timer. The
 * cloud entrypoint (functions/src/index.ts) wires Firestore and Firebase into
 * the same code.
 */
const here = dirname(fileURLToPath(import.meta.url));

const pg = createPostgresClient({ url: config.databaseUrl, schema: "ytdigest" });

await runMigrations(pg, join(here, "..", "migrations"));

const repo = createPostgresYtdigestRepo(pg);
const redis = createRedisClient({ url: config.redisUrl, keyPrefix: "ytdigest:" });
const youtube = createYouTubeClient(config.youtubeApiKey);
const baseline: BaselineOptions = {
  sampleSize: config.baselineSampleSize,
  minHistory: config.baselineMinHistory,
};

const auth = new AuthClient({
  authUrl: config.authUrl,
  cookieName: config.authCookieName,
  verifySecret: config.authVerifySecret,
});

const app = Fastify({ logger: true });

await app.register(
  toFastifyPlugin(ytdigestRoutes({ youtube, baseline }), {
    repo,
    verify: stackVerifier(auth).verify,
    logger: app.log,
  }),
  { prefix: "/api" },
);

await app.register(fastifyHttpProxy, {
  upstream: config.authUrl,
  prefix: "/auth",
  rewritePrefix: "",
});

app.get("/health", async () => ({ ok: true }));

const webDist = join(here, "..", "web", "dist");
await app.register(fastifyStatic, { root: webDist });
app.setNotFoundHandler((req, reply) => {
  if (req.method !== "GET" || req.url.startsWith("/api") || req.url.startsWith("/auth")) {
    return reply.code(404).send({ error: "not found" });
  }
  return reply.sendFile("index.html");
});

startSchedulers({
  repo,
  youtube,
  lease: redisLease(redis),
  pollIntervalMinutes: config.pollIntervalMinutes,
});

const shutdown = async () => {
  await app.close();
  redis.disconnect();
  await repo.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
