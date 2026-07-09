import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresClient, createRedisClient } from "@stack/db-clients";
import { createMailer } from "@stack/mailer";
import { AuthClient } from "@stack/auth-client";
import { registerAuth } from "@stack/auth-client/fastify";
import { config } from "./config.js";
import { runMigrations } from "./migrate.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerSubscriptionRoutes } from "./routes/subscriptions.js";
import { registerRuleRoutes } from "./routes/rules.js";
import { registerDigestRoutes } from "./routes/digests.js";
import { startSchedulers } from "./scheduler.js";

const pg = createPostgresClient({ url: config.databaseUrl, schema: "ytdigest" });

await runMigrations(pg);

const app = Fastify({ logger: true });
const { sql } = pg;

const redis = createRedisClient({ url: config.redisUrl, keyPrefix: "ytdigest:" });
const mailer = createMailer({
  host: config.smtp.host,
  port: config.smtp.port,
  user: config.smtp.user,
  password: config.smtp.password,
  from: config.mailFrom,
});

const auth = new AuthClient({
  authUrl: config.authUrl,
  cookieName: config.authCookieName,
  verifySecret: config.authVerifySecret,
});

const apiRoutes = async (api: FastifyInstance) => {
  registerAuth(api, { client: auth });

  api.get("/health", async () => ({ ok: true }));

  registerChannelRoutes(api, sql);
  registerSubscriptionRoutes(api, sql);
  registerRuleRoutes(api, sql);
  registerDigestRoutes(api, sql, mailer);
};

await app.register(apiRoutes, { prefix: "/api" });

await app.register(fastifyHttpProxy, {
  upstream: config.authUrl,
  prefix: "/auth",
  rewritePrefix: "",
});

app.get("/health", async () => ({ ok: true }));

const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
await app.register(fastifyStatic, { root: webDist });
app.setNotFoundHandler((req, reply) => {
  if (req.method !== "GET" || req.url.startsWith("/api") || req.url.startsWith("/auth")) {
    return reply.code(404).send({ error: "not found" });
  }
  return reply.sendFile("index.html");
});

startSchedulers(sql, redis, mailer);

const shutdown = async () => {
  await app.close();
  await mailer.close();
  redis.disconnect();
  await pg.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
