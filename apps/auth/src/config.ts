function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.AUTH_PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  // Domain the session cookie is scoped to. Use the shared parent (e.g.
  // ".stack.local") so every app on a subdomain sees it. Leave undefined
  // in local dev where everything is on localhost.
  cookieDomain: process.env.AUTH_COOKIE_DOMAIN || undefined,
  cookieName: process.env.AUTH_COOKIE_NAME ?? "stack_session",
  // Secure flag on the cookie. Off in dev, on in prod-behind-TLS.
  cookieSecure: (process.env.AUTH_COOKIE_SECURE ?? "false") === "true",
  // Session lifetime (sliding). 30 days is fine for self-hosted personal apps.
  sessionTtlSeconds: Number(process.env.AUTH_SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 30),
  // Shared secret apps include when calling /sessions/verify so a random
  // attacker on the same network cannot probe arbitrary tokens. Optional in
  // dev; required in production deploys.
  verifySecret: process.env.AUTH_VERIFY_SECRET || undefined,
};
