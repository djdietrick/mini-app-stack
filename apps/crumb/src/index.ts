import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresClient } from "@stack/db-clients";
import { AuthClient } from "@stack/auth-client";
import { stackVerifier } from "@stack/auth-client/verifier";
import { runMigrations } from "@stack/service-kit";
import { toFastifyPlugin } from "@stack/service-kit/fastify";
import { config } from "./config.js";
import { crumbRoutes } from "./domain/routes.js";
import { createPostgresCrumbRepo } from "./repo/postgres.js";
import { startReminderDispatch } from "./scheduler.js";
import { createWebPush, generateVapidKeys, vapidSubject } from "./webpush.js";

/**
 * Self-hosted entrypoint. Routing, planning and reminder logic live in
 * src/domain; this file only wires the Postgres/apps/auth
 * implementations into it, serves the SPA and starts the reminder timer. The
 * cloud entrypoint (functions/src/index.ts) wires Firestore and Firebase into
 * the same code.
 */
const here = dirname(fileURLToPath(import.meta.url));

const pg = createPostgresClient({ url: config.databaseUrl, schema: "crumb" });

await runMigrations(pg, join(here, "..", "migrations"));

const repo = createPostgresCrumbRepo(pg);

// Made on first use and kept in the database; see CrumbRepo.vapidKeys.
const push = createWebPush({
  keys: () => repo.vapidKeys(generateVapidKeys),
  subject: vapidSubject(config.vapidSubject, config.mailFrom),
});

const auth = new AuthClient({
  authUrl: config.authUrl,
  cookieName: config.authCookieName,
  verifySecret: config.authVerifySecret,
});

const app = Fastify({ logger: true });

await app.register(
  toFastifyPlugin(crumbRoutes({ push }), {
    repo,
    verify: stackVerifier(auth).verify,
    logger: app.log,
  }),
  { prefix: "/api" },
);

// Reverse-proxy /auth/* to apps/auth so the browser keeps a first-party
// cookie on the crumb origin.
await app.register(fastifyHttpProxy, {
  upstream: config.authUrl,
  prefix: "/auth",
  rewritePrefix: "",
});

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

const stopDispatch = startReminderDispatch({ repo, push, log: app.log }, config.dispatchEverySeconds);

const shutdown = async () => {
  stopDispatch();
  await app.close();
  await repo.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
