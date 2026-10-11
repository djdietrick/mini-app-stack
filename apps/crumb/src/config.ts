function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const mailFrom = process.env.MAIL_FROM || undefined;

export const config = {
  port: Number(process.env.CRUMB_PORT ?? 3105),
  databaseUrl: required("DATABASE_URL"),
  authUrl: required("AUTH_URL"),
  authVerifySecret: required("AUTH_VERIFY_SECRET"),
  authCookieName: process.env.AUTH_COOKIE_NAME ?? "stack_session",

  /**
   * Optional: without SMTP_HOST, reminders go to devices only. The same
   * relay ytdigest uses works here.
   */
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        user: process.env.SMTP_USER ?? "",
        password: process.env.SMTP_PASSWORD ?? "",
        from: mailFrom?.replace(/^[^<]*</, "Crumb <") ?? "Crumb <crumb@localhost>",
      }
    : null,

  /** CRUMB_VAPID_SUBJECT, for vapidSubject() in webpush.ts; MAIL_FROM otherwise. */
  vapidSubject: process.env.CRUMB_VAPID_SUBJECT || undefined,
  mailFrom,

  /** This app's public origin, for links in reminder emails. Optional. */
  appUrl: process.env.CRUMB_APP_URL || undefined,

  /** How often due reminders are sent, in seconds. */
  dispatchEverySeconds: Number(process.env.CRUMB_DISPATCH_SECONDS ?? 60),
};
