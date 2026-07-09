import cron from "node-cron";
import type postgres from "postgres";
import type { RedisClient } from "@stack/db-clients";
import type { Mailer } from "@stack/mailer";
import { config } from "./config.js";
import { pollChannels } from "./poll/pollChannels.js";
import { sendDigest } from "./digest/sendDigest.js";

/** Runs the combined daily digest for every user with at least one subscription. */
export async function runDailyDigest(
  sql: postgres.Sql,
  mailer: Mailer,
  runDate: Date = new Date(),
): Promise<void> {
  const users = await sql<{ user_id: string; email: string }[]>`
    SELECT DISTINCT s.user_id, u.email
    FROM subscriptions s
    JOIN shared.users u ON u.id = s.user_id
  `;

  for (const user of users) {
    try {
      const result = await sendDigest(sql, mailer, user.user_id, user.email, runDate);
      if (result.sent) console.log(`[digest] sent ${result.itemCount} item(s) to ${user.email}`);
    } catch (err) {
      console.error(`[digest] failed for ${user.email}:`, err);
    }
  }
}

export function startSchedulers(sql: postgres.Sql, redis: RedisClient, mailer: Mailer): void {
  const runPoll = () => {
    pollChannels(sql, redis).catch((err) => console.error("[poll] failed:", err));
  };
  runPoll();
  setInterval(runPoll, config.pollIntervalMinutes * 60_000);

  cron.schedule(config.digestSendCron, () => {
    runDailyDigest(sql, mailer).catch((err) => console.error("[digest] failed:", err));
  });
}
