import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import argon2 from "argon2";
import { z } from "zod";
import { createPostgresClient } from "@stack/db-clients";
import { config } from "./config.js";
import {
  FLOW_COOKIE,
  FLOW_TTL_SECONDS,
  beginFlow,
  decodeFlow,
  encodeFlow,
  exchangeCode,
  parseReturnTo,
  stateMatches,
  withAuthError,
} from "./google.js";
import { createSession, deleteSession, lookupSession } from "./sessions.js";
import { upsertGoogleUser } from "./users.js";

const pg = createPostgresClient({ url: config.databaseUrl, schema: "shared" });

const app = Fastify({ logger: true });
await app.register(cookie);
await app.register(rateLimit, {
  global: false,
  max: 20,
  timeWindow: "1 minute",
});

const { sql } = pg;

function setSessionCookie(reply: Parameters<typeof app.post>[1] extends never ? never : any, token: string, expiresAt: Date) {
  reply.setCookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    domain: config.cookieDomain,
    expires: expiresAt,
  });
}

function clearSessionCookie(reply: any) {
  reply.clearCookie(config.cookieName, {
    path: "/",
    domain: config.cookieDomain,
  });
}

app.get("/health", async () => ({ ok: true }));

const credentialsBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(120).optional(),
});

app.post("/signup", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
  const parsed = credentialsBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const { email, password, displayName } = parsed.data;

  const existing = await sql<{ id: string }[]>`SELECT id FROM shared.users WHERE email = ${email}`;
  if (existing.length > 0) return reply.code(409).send({ error: "email already registered" });

  const hash = await argon2.hash(password, { type: argon2.argon2id });

  const [user] = await sql<{ id: string; email: string; display_name: string | null }[]>`
    WITH new_user AS (
      INSERT INTO shared.users (email, display_name) VALUES (${email}, ${displayName ?? null})
      RETURNING id, email, display_name
    ),
    new_cred AS (
      INSERT INTO shared.user_credentials (user_id, password_hash)
      SELECT id, ${hash} FROM new_user
    )
    SELECT id, email, display_name FROM new_user
  `;

  const { token, expiresAt } = await createSession(pg, user.id, config.sessionTtlSeconds);
  setSessionCookie(reply, token, expiresAt);
  return reply.code(201).send({ userId: user.id, email: user.email, displayName: user.display_name });
});

app.post("/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  const parsed = credentialsBody.pick({ email: true, password: true }).safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const rows = await sql<
    { id: string; email: string; display_name: string | null; password_hash: string }[]
  >`
    SELECT u.id, u.email, u.display_name, c.password_hash
    FROM shared.users u
    JOIN shared.user_credentials c ON c.user_id = u.id
    WHERE u.email = ${email}
  `;
  const row = rows[0];

  // Verify a hash even on miss to keep timing roughly constant.
  const dummy = "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const ok = await argon2.verify(row?.password_hash ?? dummy, password).catch(() => false);
  if (!row || !ok) return reply.code(401).send({ error: "invalid credentials" });

  const { token, expiresAt } = await createSession(pg, row.id, config.sessionTtlSeconds);
  setSessionCookie(reply, token, expiresAt);
  return { userId: row.id, email: row.email, displayName: row.display_name };
});

app.post("/logout", async (req, reply) => {
  const token = req.cookies[config.cookieName];
  if (token) await deleteSession(pg, token);
  clearSessionCookie(reply);
  return { ok: true };
});

app.get("/me", async (req, reply) => {
  const token = req.cookies[config.cookieName];
  if (!token) return reply.code(401).send({ error: "not signed in" });
  const session = await lookupSession(pg, token);
  if (!session) {
    clearSessionCookie(reply);
    return reply.code(401).send({ error: "not signed in" });
  }
  return session;
});

// ---------- Google sign-in ----------

// Lets the shared login form decide whether to offer the Google button.
app.get("/providers", async () => ({ google: config.google !== undefined }));

const flowCookieOptions = {
  httpOnly: true,
  secure: config.cookieSecure,
  // Lax, not Strict: the callback is a top-level navigation from Google, and
  // Strict would withhold the cookie on exactly that request.
  sameSite: "lax" as const,
  path: "/",
  maxAge: FLOW_TTL_SECONDS,
};

app.get("/google/start", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
  const google = config.google;
  if (!google) return reply.code(404).send({ error: "Google sign-in is not configured" });
  const returnTo = parseReturnTo((req.query as { returnTo?: unknown }).returnTo, google);
  if (!returnTo) return reply.code(400).send({ error: "returnTo is not an allowed origin" });

  const { flow, location } = beginFlow(returnTo, google);
  reply.setCookie(FLOW_COOKIE, encodeFlow(flow), flowCookieOptions);
  return reply.redirect(location);
});

app.get("/google/callback", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
  const google = config.google;
  if (!google) return reply.code(404).send({ error: "Google sign-in is not configured" });

  const flow = decodeFlow(req.cookies[FLOW_COOKIE]);
  reply.clearCookie(FLOW_COOKIE, { path: "/" });
  // Re-checked here as well as at /start: the cookie is only as trustworthy
  // as the browser that sent it.
  const returnTo = flow ? parseReturnTo(flow.returnTo, google) : null;
  if (!flow || !returnTo) return reply.code(400).send({ error: "sign-in expired, start again" });

  const query = req.query as { code?: unknown; state?: unknown; error?: unknown };
  if (!stateMatches(flow.state, query.state)) {
    return reply.redirect(withAuthError(flow.returnTo, "sign-in expired, try again"));
  }
  if (typeof query.code !== "string" || !query.code) {
    // e.g. error=access_denied when the user cancels on Google's screen.
    return reply.redirect(withAuthError(flow.returnTo, "sign-in cancelled"));
  }

  try {
    const identity = await exchangeCode(query.code, flow, google);
    const user = await upsertGoogleUser(pg, identity.email, identity.name);
    const { token, expiresAt } = await createSession(pg, user.id, config.sessionTtlSeconds);
    setSessionCookie(reply, token, expiresAt);
    return reply.redirect(flow.returnTo);
  } catch (err) {
    req.log.warn({ err }, "google sign-in failed");
    return reply.redirect(withAuthError(flow.returnTo, "Google sign-in failed"));
  }
});

// Service-to-service: an app's backend calls this with the user's cookie
// value to confirm a session is valid. Guarded by AUTH_VERIFY_SECRET when set.
const verifyBody = z.object({ token: z.string().min(1) });

app.post("/sessions/verify", async (req, reply) => {
  if (config.verifySecret) {
    const provided = req.headers["x-auth-verify-secret"];
    if (provided !== config.verifySecret) return reply.code(401).send({ error: "unauthorized" });
  }
  const parsed = verifyBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const session = await lookupSession(pg, parsed.data.token);
  if (!session) return reply.code(401).send({ error: "invalid session" });
  return session;
});

const shutdown = async () => {
  await app.close();
  await pg.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
