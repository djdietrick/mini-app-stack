import type postgres from "postgres";
import { evaluateRule, type VideoForEvaluation } from "../rules/evaluate.js";
import type { RuleGroup } from "../rules/types.js";

export interface DueSubscription {
  id: string;
  channel_id: string;
  channel_title: string;
  cadence: "daily" | "weekly";
  notify_mode: "all" | "rules";
  last_digested_at: Date | null;
}

export interface DigestVideoItem {
  videoId: string;
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

/** Subscriptions due for today's combined send: daily always, weekly only on their configured
 * day (or every subscription, when `force` is set — used by the manual "run now" trigger). */
export async function findDueSubscriptions(
  sql: postgres.Sql,
  userId: string,
  runDate: Date,
  force = false,
): Promise<DueSubscription[]> {
  const dayOfWeek = runDate.getDay();
  return sql<DueSubscription[]>`
    SELECT s.id, s.channel_id, c.title AS channel_title, s.cadence, s.notify_mode, s.last_digested_at
    FROM subscriptions s
    JOIN channels c ON c.id = s.channel_id
    WHERE s.user_id = ${userId}
      AND (${force} OR s.cadence = 'daily' OR (s.cadence = 'weekly' AND s.digest_day_of_week = ${dayOfWeek}))
  `;
}

interface CandidateVideoRow {
  id: string;
  title: string;
  description: string | null;
  published_at: Date;
  duration_seconds: number | null;
  thumbnail_url: string | null;
}

interface LatestSnapshotRow {
  view_count: number;
  like_count: number | null;
  captured_at: Date;
}

async function candidateVideos(
  sql: postgres.Sql,
  userId: string,
  sub: DueSubscription,
): Promise<CandidateVideoRow[]> {
  const since = sub.last_digested_at ?? new Date(0);
  return sql<CandidateVideoRow[]>`
    SELECT v.id, v.title, v.description, v.published_at, v.duration_seconds, v.thumbnail_url
    FROM videos v
    WHERE v.channel_id = ${sub.channel_id}
      AND v.first_seen_at > ${since}
      AND NOT EXISTS (
        SELECT 1 FROM notified_videos nv WHERE nv.user_id = ${userId} AND nv.video_id = v.id
      )
    ORDER BY v.published_at ASC
  `;
}

async function loadRules(sql: postgres.Sql, userId: string, subscriptionId: string) {
  return sql<{ id: string; rule_json: RuleGroup }[]>`
    SELECT id, rule_json FROM criteria_rules
    WHERE enabled = true
      AND user_id = ${userId}
      AND ((scope = 'subscription' AND subscription_id = ${subscriptionId}) OR scope = 'global')
  `;
}

export async function buildDigest(
  sql: postgres.Sql,
  userId: string,
  runDate: Date,
  force = false,
): Promise<DigestResult> {
  const dueSubscriptions = await findDueSubscriptions(sql, userId, runDate, force);
  const groupsByChannel = new Map<string, DigestChannelGroup>();

  for (const sub of dueSubscriptions) {
    const candidates = await candidateVideos(sql, userId, sub);
    if (candidates.length === 0) continue;

    const rules = sub.notify_mode === "rules" ? await loadRules(sql, userId, sub.id) : [];

    for (const video of candidates) {
      const [snapshot] = await sql<LatestSnapshotRow[]>`
        SELECT view_count, like_count, captured_at FROM video_stats_snapshots
        WHERE video_id = ${video.id}
        ORDER BY captured_at DESC
        LIMIT 1
      `;

      const evalVideo: VideoForEvaluation = {
        id: video.id,
        channelId: sub.channel_id,
        title: video.title,
        description: video.description,
        publishedAt: video.published_at,
        durationSeconds: video.duration_seconds,
        latestViewCount: snapshot?.view_count ?? 0,
        latestLikeCount: snapshot?.like_count ?? null,
        latestCapturedAt: snapshot?.captured_at ?? video.published_at,
      };

      let matchedRuleId: string | null = null;
      let reasons: string[] = [];

      if (sub.notify_mode === "all") {
        reasons = ["every upload from this channel"];
      } else {
        for (const rule of rules) {
          const result = await evaluateRule(sql, rule.rule_json, evalVideo);
          if (result.matched) {
            matchedRuleId = rule.id;
            reasons = result.reasons;
            break;
          }
        }
        if (!matchedRuleId && reasons.length === 0) continue;
      }

      const group = groupsByChannel.get(sub.channel_id) ?? {
        channelId: sub.channel_id,
        channelTitle: sub.channel_title,
        videos: [],
      };
      group.videos.push({
        videoId: video.id,
        title: video.title,
        thumbnailUrl: video.thumbnail_url,
        publishedAt: video.published_at,
        viewCount: evalVideo.latestViewCount,
        subscriptionId: sub.id,
        matchedRuleId,
        reasons,
      });
      groupsByChannel.set(sub.channel_id, group);
    }
  }

  return { dueSubscriptions, channels: [...groupsByChannel.values()] };
}
