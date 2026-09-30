import type { Logger } from "@stack/service-kit";
import type { YtdigestRepo } from "../repo/types.js";
import { renderDigestEmail } from "./renderEmail.js";
import { matchVideo } from "./match.js";
import { type BaselineOptions, DEFAULT_BASELINE } from "./rules/evaluate.js";
import type { DigestLine, DueSubscription } from "./types.js";

export interface DigestVideoItem {
  videoId: string;
  youtubeVideoId: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: Date;
  viewCount: number;
  subscriptionId: string;
  matchedRuleId: string | null;
  reasons: string[];
}

export interface DigestChannelGroup {
  channelId: string;
  channelTitle: string;
  videos: DigestVideoItem[];
}

export interface DigestResult {
  dueSubscriptions: DueSubscription[];
  channels: DigestChannelGroup[];
}

/** The slice of @stack/mailer the digest needs. */
export interface DigestMailer {
  send(mail: { to: string; subject: string; html: string; text?: string }): Promise<void>;
}

export interface DigestOptions {
  baseline?: BaselineOptions;
  /**
   * IANA zone that decides which weekday a weekly digest goes out on, the
   * run's calendar date, and the date shown in the email. Unset means the
   * process's local zone, which is how the self-hosted stack has always
   * behaved. The cloud sets it, because Cloud Functions run in UTC.
   */
  timeZone?: string;
}

export interface SendDigestResult {
  sent: boolean;
  itemCount: number;
}

/** 0 = Sunday, like Date#getDay, but in `timeZone` when one is given. */
export function dayOfWeek(runDate: Date, timeZone?: string): number {
  if (!timeZone) return runDate.getDay();
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(runDate);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** YYYY-MM-DD. The UTC date when no zone is given, which is what it always was. */
export function runDateString(runDate: Date, timeZone?: string): string {
  if (!timeZone) return runDate.toISOString().slice(0, 10);
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(runDate);
}

export async function buildDigest(
  repo: YtdigestRepo,
  userId: string,
  runDate: Date,
  force = false,
  opts: DigestOptions = {},
): Promise<DigestResult> {
  const dueSubscriptions = await repo.dueSubscriptions(
    userId,
    dayOfWeek(runDate, opts.timeZone),
    force,
  );
  const groupsByChannel = new Map<string, DigestChannelGroup>();

  for (const sub of dueSubscriptions) {
    const candidates = await repo.candidateVideos(userId, sub);
    if (candidates.length === 0) continue;

    const rules = sub.notifyMode === "rules" ? await repo.enabledRules(userId, sub.id) : [];

    for (const video of candidates) {
      const match = await matchVideo(repo, sub, rules, video, opts.baseline ?? DEFAULT_BASELINE);
      if (!match.matched) continue;

      const group = groupsByChannel.get(sub.channelId) ?? {
        channelId: sub.channelId,
        channelTitle: sub.channelTitle,
        videos: [],
      };
      group.videos.push({
        videoId: video.id,
        youtubeVideoId: video.youtubeVideoId,
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
        publishedAt: video.publishedAt,
        viewCount: match.viewCount,
        subscriptionId: sub.id,
        matchedRuleId: match.matchedRuleId,
        reasons: match.reasons,
      });
      groupsByChannel.set(sub.channelId, group);
    }
  }

  return { dueSubscriptions, channels: [...groupsByChannel.values()] };
}

export async function sendDigest(
  repo: YtdigestRepo,
  mailer: DigestMailer,
  userId: string,
  userEmail: string,
  runDate: Date = new Date(),
  force = false,
  opts: DigestOptions = {},
): Promise<SendDigestResult> {
  const digest = await buildDigest(repo, userId, runDate, force, opts);
  if (digest.dueSubscriptions.length === 0) return { sent: false, itemCount: 0 };

  // Reset each due subscription's window regardless of match count, so
  // "candidate since last digest" doesn't grow unbounded on quiet weeks.
  await repo.markDigested(
    digest.dueSubscriptions.map((s) => s.id),
    runDate,
  );

  const itemCount = digest.channels.reduce((n, c) => n + c.videos.length, 0);
  if (itemCount === 0) return { sent: false, itemCount: 0 };

  const cadenceForRun = digest.dueSubscriptions.some((s) => s.cadence === "weekly")
    ? "weekly"
    : "daily";
  const { subject, html, text } = renderDigestEmail(digest, runDate, opts.timeZone);

  await mailer.send({ to: userEmail, subject, html, text });

  const lines: DigestLine[] = digest.channels.flatMap((group) =>
    group.videos.map((v) => ({
      videoId: v.videoId,
      youtubeVideoId: v.youtubeVideoId,
      title: v.title,
      thumbnailUrl: v.thumbnailUrl,
      channelTitle: group.channelTitle,
      subscriptionId: v.subscriptionId,
      matchedRuleId: v.matchedRuleId,
      reasons: v.reasons,
    })),
  );
  await repo.recordDigest(userId, cadenceForRun, runDateString(runDate, opts.timeZone), lines);

  return { sent: true, itemCount };
}

/** Runs the combined daily digest for every user with at least one subscription. */
export async function runDailyDigest(
  repo: YtdigestRepo,
  mailer: DigestMailer,
  runDate: Date = new Date(),
  opts: DigestOptions = {},
  log: Logger = console,
): Promise<void> {
  for (const user of await repo.digestRecipients()) {
    try {
      const result = await sendDigest(repo, mailer, user.userId, user.email, runDate, false, opts);
      if (result.sent) log.info(`[digest] sent ${result.itemCount} item(s) to ${user.email}`);
    } catch (err) {
      log.error(`[digest] failed for ${user.email}:`, err);
    }
  }
}
