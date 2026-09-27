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
import { pantryRoutes, resolvePantryScope } from "./domain/routes.js";
import { createPostgresPantryRepo } from "./repo/postgres.js";

/**
 * Self-hosted entrypoint. All routing and business logic lives in
 * src/domain/routes.ts; this file only wires the Postgres/apps/auth
 * implementations into it and serves the SPA. The cloud entrypoint
 * (functions/src/index.ts) wires the Firestore/Firebase implementations into
 * the exact same route table.
 */
const here = dirname(fileURLToPath(import.meta.url));

const pg = createPostgresClient({ url: config.databaseUrl, schema: "pantry" });

await runMigrations(pg, join(here, "..", "migrations"));

const repo = createPostgresPantryRepo(pg);

const auth = new AuthClient({
  authUrl: config.authUrl,
  cookieName: config.authCookieName,
  verifySecret: config.authVerifySecret,
});

const app = Fastify({ logger: true });

await app.register(
  toFastifyPlugin(pantryRoutes(), {
    repo,
    verify: stackVerifier(auth).verify,
    // What used to be the preHandler: resolves the caller's active household.
    resolveScope: resolvePantryScope,
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

const shutdown = async () => {
  await app.close();
  await repo.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
