import type postgres from "postgres";
import type { Mailer } from "@stack/mailer";
import { buildDigest } from "./buildDigest.js";
import { renderDigestEmail } from "./renderEmail.js";

export interface SendDigestResult {
  sent: boolean;
  itemCount: number;
}

export async function sendDigest(
  sql: postgres.Sql,
  mailer: Mailer,
  userId: string,
  userEmail: string,
  runDate: Date = new Date(),
  force = false,
): Promise<SendDigestResult> {
  const digest = await buildDigest(sql, userId, runDate, force);
  if (digest.dueSubscriptions.length === 0) return { sent: false, itemCount: 0 };

  // Reset each due subscription's window regardless of match count, so
  // "candidate since last digest" doesn't grow unbounded on quiet weeks.
  for (const sub of digest.dueSubscriptions) {
    await sql`UPDATE subscriptions SET last_digested_at = ${runDate} WHERE id = ${sub.id}`;
  }

  const itemCount = digest.channels.reduce((n, c) => n + c.videos.length, 0);
  if (itemCount === 0) return { sent: false, itemCount: 0 };

  const cadenceForRun = digest.dueSubscriptions.some((s) => s.cadence === "weekly") ? "weekly" : "daily";
  const { subject, html, text } = renderDigestEmail(digest, runDate);

  await mailer.send({ to: userEmail, subject, html, text });

  await sql.begin(async (tx) => {
    const [run] = await tx<{ id: string }[]>`
      INSERT INTO digest_runs (user_id, cadence, run_date, sent_at)
      VALUES (${userId}, ${cadenceForRun}, ${runDate.toISOString().slice(0, 10)}, now())
      RETURNING id
    `;
    for (const group of digest.channels) {
      for (const video of group.videos) {
        await tx`
          INSERT INTO digest_items (digest_run_id, video_id, subscription_id, matched_rule_id, reason_json)
          VALUES (${run.id}, ${video.videoId}, ${video.subscriptionId}, ${video.matchedRuleId}, ${JSON.stringify(video.reasons)})
          ON CONFLICT (digest_run_id, video_id) DO NOTHING
        `;
        await tx`
          INSERT INTO notified_videos (user_id, video_id)
          VALUES (${userId}, ${video.videoId})
          ON CONFLICT (user_id, video_id) DO NOTHING
        `;
      }
    }
  });

  return { sent: true, itemCount };
}
