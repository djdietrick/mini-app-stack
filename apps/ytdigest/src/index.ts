import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresClient, createRedisClient } from "@stack/db-clients";
import { createMailer } from "@stack/mailer";
import { AuthClient } from "@stack/auth-client";
import { stackVerifier } from "@stack/auth-client/verifier";
import { redisLease, runMigrations } from "@stack/service-kit";
import { toFastifyPlugin } from "@stack/service-kit/fastify";
import { config } from "./config.js";
import type { DigestOptions } from "./domain/digest.js";
import { ytdigestRoutes } from "./domain/routes.js";
import { createYouTubeClient } from "./domain/youtube.js";
import { createPostgresYtdigestRepo } from "./repo/postgres.js";
import { startSchedulers } from "./scheduler.js";

/**
 * Self-hosted entrypoint. Routing, polling and digest logic live in
 * src/domain; this file only wires the Postgres/Redis/SMTP/apps/auth
 * implementations into it, serves the SPA and starts the schedulers. The
 * cloud entrypoint (functions/src/index.ts) wires Firestore and Firebase into
 * the same code.
 */
const here = dirname(fileURLToPath(import.meta.url));

const pg = createPostgresClient({ url: config.databaseUrl, schema: "ytdigest" });

await runMigrations(pg, join(here, "..", "migrations"));

const repo = createPostgresYtdigestRepo(pg);
const redis = createRedisClient({ url: config.redisUrl, keyPrefix: "ytdigest:" });
const youtube = createYouTubeClient(config.youtubeApiKey);
const mailer = createMailer({
  host: config.smtp.host,
  port: config.smtp.port,
  user: config.smtp.user,
  password: config.smtp.password,
  from: config.mailFrom,
});
const digest: DigestOptions = {
  timeZone: config.digestTimeZone,
  baseline: { sampleSize: config.baselineSampleSize, minHistory: config.baselineMinHistory },
};

const auth = new AuthClient({
  authUrl: config.authUrl,
  cookieName: config.authCookieName,
  verifySecret: config.authVerifySecret,
});

const app = Fastify({ logger: true });

await app.register(
  toFastifyPlugin(ytdigestRoutes({ youtube, mailer, digest }), {
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
  mailer,
  lease: redisLease(redis),
  pollIntervalMinutes: config.pollIntervalMinutes,
  digestSendCron: config.digestSendCron,
  digest,
});

const shutdown = async () => {
  await app.close();
  await mailer.close();
  redis.disconnect();
  await repo.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
