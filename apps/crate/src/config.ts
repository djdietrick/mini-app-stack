function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.CRATE_PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  // Internal URL of apps/auth. In compose: http://auth:3000. In dev: http://localhost:3000.
  authUrl: required("AUTH_URL"),
  // Must match apps/auth's AUTH_VERIFY_SECRET so /sessions/verify calls succeed.
  authVerifySecret: required("AUTH_VERIFY_SECRET"),
  authCookieName: process.env.AUTH_COOKIE_NAME ?? "stack_session",
};
