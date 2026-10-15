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
import { cryptoRng } from "./cryptoRng.js";
import { highrollerRoutes, resolveHighrollerScope } from "./domain/routes.js";
import { createPostgresHighrollerRepo, purgeSettledHands } from "./repo/postgres.js";

/**
 * Self-hosted entrypoint. Game rules, the hand lifecycle and the economy live
 * in src/games and src/domain; this file only wires Postgres, apps/auth and
 * the crypto Rng into them and serves the SPA. The cloud entrypoint
 * (functions/src/index.ts) wires Firestore and Firebase into the same code.
 */
const here = dirname(fileURLToPath(import.meta.url));

const pg = createPostgresClient({ url: config.databaseUrl, schema: "highroller" });

await runMigrations(pg, join(here, "..", "migrations"));

const app = Fastify({ logger: true });

// Settled hands keep their full state for 90 days, for replay; then they go.
// Firestore does the same with a TTL policy on purgeAt.
const purged = await purgeSettledHands(pg);
if (purged) app.log.info({ purged }, "purged settled hands past retention");

const repo = createPostgresHighrollerRepo(pg);

const auth = new AuthClient({
  authUrl: config.authUrl,
  cookieName: config.authCookieName,
  verifySecret: config.authVerifySecret,
});

await app.register(
  toFastifyPlugin(highrollerRoutes({ rng: cryptoRng }), {
    repo,
    verify: stackVerifier(auth).verify,
    resolveScope: resolveHighrollerScope,
    logger: app.log,
  }),
  { prefix: "/api" },
);

// Reverse-proxy /auth/* to apps/auth so the browser keeps a first-party
// cookie on the highroller origin.
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

const shutdown = async () => {
  await app.close();
  await repo.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
