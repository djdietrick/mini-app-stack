function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.CRUMB_PORT ?? 3105),
  databaseUrl: required("DATABASE_URL"),
  authUrl: required("AUTH_URL"),
  authVerifySecret: required("AUTH_VERIFY_SECRET"),
  authCookieName: process.env.AUTH_COOKIE_NAME ?? "stack_session",

  /** CRUMB_VAPID_SUBJECT, for vapidSubject() in webpush.ts; MAIL_FROM otherwise. */
  vapidSubject: process.env.CRUMB_VAPID_SUBJECT || undefined,
  mailFrom: process.env.MAIL_FROM || undefined,

  /** How often due reminders are sent, in seconds. */
  dispatchEverySeconds: Number(process.env.CRUMB_DISPATCH_SECONDS ?? 60),
};
