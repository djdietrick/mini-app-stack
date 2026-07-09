function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.YTDIGEST_PORT ?? 3103),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL,
  authUrl: required("AUTH_URL"),
  authVerifySecret: required("AUTH_VERIFY_SECRET"),
  authCookieName: process.env.AUTH_COOKIE_NAME ?? "stack_session",

  youtubeApiKey: required("YOUTUBE_API_KEY"),

  smtp: {
    host: required("SMTP_HOST"),
    port: Number(process.env.SMTP_PORT ?? 587),
    user: required("SMTP_USER"),
    password: required("SMTP_PASSWORD"),
  },
  mailFrom: required("MAIL_FROM"),

  /** How often the poller checks subscribed channels for new uploads. */
  pollIntervalMinutes: Number(process.env.POLL_INTERVAL_MINUTES ?? 180),
  /** Cron expression for the daily combined digest send. */
  digestSendCron: process.env.DIGEST_SEND_CRON ?? "0 8 * * *",

  /** Trailing videos considered when computing a channel's performance baseline. */
  baselineSampleSize: Number(process.env.BASELINE_SAMPLE_SIZE ?? 10),
  /** Minimum videos of history required before a performance/engagement rule can match. */
  baselineMinHistory: Number(process.env.BASELINE_MIN_HISTORY ?? 5),
};
