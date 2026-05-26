function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PANTRY_PORT ?? 3002),
  databaseUrl: required("DATABASE_URL"),
  authUrl: required("AUTH_URL"),
  authVerifySecret: required("AUTH_VERIFY_SECRET"),
  authCookieName: process.env.AUTH_COOKIE_NAME ?? "stack_session",
};
