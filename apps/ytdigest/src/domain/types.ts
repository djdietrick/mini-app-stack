import { z } from "zod";

/**
 * ytdigest's wire and job types.
 *
 * Wire rows are snake_case because they began as Postgres rows and
 * apps/ytdigest/web/src/api.ts reads exactly these names; the Firestore repo
 * reproduces them. Their timestamps are strings, formatted however the
 * backend returns them: Postgres text on one, ISO 8601 on the other. The SPA
 * only feeds them to `new Date()`.
 *
 * Job types (the poll and the digest) carry real Dates instead. They do
 * arithmetic on timestamps, and the Postgres client hands timestamps back as
 * strings: Drizzle, which @stack/db-clients wraps it in, replaces postgres.js's
 * date parsers. Each repo converts at its edge.
 */

export const CADENCE = z.enum(["daily", "weekly"]);
export const NOTIFY_MODE = z.enum(["all", "rules"]);
export type Cadence = z.infer<typeof CADENCE>;
export type NotifyMode = z.infer<typeof NOTIFY_MODE>;
export type RuleScope = "subscription" | "global";

// ---------- wire rows ----------

export interface ChannelRow {
  id: string;
  youtube_channel_id: string;
  title: string;
  thumbnail_url: string | null;
  last_polled_at: string | null;
  subscription_id: string | null;
}

export interface SubscriptionRow {
  id: string;
  channel_id: string;
  channel_title: string;
  thumbnail_url: string | null;
  cadence: Cadence;
  digest_day_of_week: number | null;
  notify_mode: NotifyMode;
  last_digested_at: string | null;
  created_at: string;
}

export interface RuleRow {
  id: string;
  scope: RuleScope;
  subscription_id: string | null;
  name: string;
  rule_json: unknown;
  enabled: boolean;
  created_at: string;
}

export interface DigestRunRow {
  id: string;
  cadence: Cadence;
  run_date: string;
  sent_at: string | null;
  item_count: number;
}

export interface DigestItemRow {
  video_id: string;
  /**
   * The id YouTube knows the video by. Added because `video_id` is an internal
   * UUID on Postgres, so the watch links built from it never worked there.
   */
  youtube_video_id: string;
  title: string;
  thumbnail_url: string | null;
  channel_title: string;
  matched_rule_id: string | null;
  reason_json: string[] | null;
}

export interface DigestDetail {
  id: string;
  cadence: Cadence;
  run_date: string;
  sent_at: string | null;
  items: DigestItemRow[];
}

/**
 * One video in the feed: a subscribed channel's upload that passes that
 * subscription's filters (the same test the digest applies). Built by
 * src/domain/feed.ts rather than read straight from a table, so both backends
 * produce it identically and `published_at` is always ISO 8601.
 */
export interface FeedItemRow {
  /** Internal id; a UUID on Postgres, the YouTube id on Firestore. */
  video_id: string;
  /** Link, embed and route with this. */
  youtube_video_id: string;
  title: string;
  thumbnail_url: string | null;
  published_at: string;
  duration_seconds: number | null;
  view_count: number;
  channel_id: string;
  channel_title: string;
  channel_thumbnail_url: string | null;
  matched_rule_id: string | null;
  reasons: string[];
}

export interface FeedPage {
  items: FeedItemRow[];
  /** Pass back as `?before=` for the next page; null at the end. */
  next: string | null;
}

/** GET /videos/:youtubeVideoId. `matched` is false when a filter no longer lets it through. */
export interface VideoDetailRow extends FeedItemRow {
  description: string | null;
  matched: boolean;
}

// ---------- job types ----------

export interface ResolvedChannel {
  youtubeChannelId: string;
  title: string;
  thumbnailUrl: string | null;
  uploadsPlaylistId: string;
}

export interface UploadListItem {
  youtubeVideoId: string;
  title: string;
  description: string | null;
  publishedAt: string;
  thumbnailUrl: string | null;
}

export interface VideoStats {
  youtubeVideoId: string;
  viewCount: number;
  likeCount: number | null;
  commentCount: number | null;
  durationSeconds: number;
}

export interface PollTarget {
  id: string;
  uploadsPlaylistId: string;
}

export interface TrackedVideo {
  id: string;
  youtubeVideoId: string;
}

export interface DueSubscription {
  id: string;
  channelId: string;
  channelTitle: string;
  cadence: Cadence;
  notifyMode: NotifyMode;
  lastDigestedAt: Date | null;
}

export interface CandidateVideo {
  id: string;
  youtubeVideoId: string;
  title: string;
  description: string | null;
  publishedAt: Date;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
}

/** The subscription a feed candidate comes through. */
export interface FeedSubscription {
  id: string;
  channelId: string;
  channelTitle: string;
  channelThumbnailUrl: string | null;
  notifyMode: NotifyMode;
}

export interface FeedCandidate extends CandidateVideo {
  subscription: FeedSubscription;
}

/** Position in the feed: newest published first, ties broken by id descending. */
export interface FeedCursor {
  publishedAt: Date;
  videoId: string;
}

export interface Snapshot {
  viewCount: number;
  likeCount: number | null;
  capturedAt: Date;
}

export interface PastVideo {
  id: string;
  publishedAt: Date;
}

export interface DigestRecipient {
  userId: string;
  email: string;
}

/** One line of a sent digest, as recorded for GET /digests/:id. */
export interface DigestLine {
  videoId: string;
  youtubeVideoId: string;
  title: string;
  thumbnailUrl: string | null;
  channelTitle: string;
  subscriptionId: string;
  matchedRuleId: string | null;
  reasons: string[];
}

// ---------- request bodies ----------

const conditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("keyword"),
      field: z.enum(["title", "description"]),
      match: z.enum(["any", "all", "none"]),
      terms: z.array(z.string().min(1)).min(1),
    }),
    z.object({
      type: z.literal("performance"),
      metric: z.literal("views_per_hour"),
      comparedTo: z.literal("channel_baseline"),
      threshold: z.number().positive(),
    }),
    z.object({
      type: z.literal("engagement"),
      metric: z.literal("like_ratio"),
      comparedTo: z.literal("channel_baseline"),
      threshold: z.number().positive(),
    }),
    z.object({
      type: z.literal("duration"),
      min: z.number().int().min(0).optional(),
      max: z.number().int().min(0).optional(),
    }),
    ruleGroupSchema,
  ]),
);

export const ruleGroupSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    op: z.enum(["AND", "OR"]),
    conditions: z.array(conditionSchema).min(1),
  }),
);

export const createSubscriptionBody = z
  .object({
    query: z.string().min(1).max(200),
    cadence: CADENCE,
    digestDayOfWeek: z.number().int().min(0).max(6).optional(),
    notifyMode: NOTIFY_MODE.default("rules"),
  })
  .refine((b) => b.cadence !== "weekly" || b.digestDayOfWeek !== undefined, {
    message: "digestDayOfWeek is required for weekly cadence",
    path: ["digestDayOfWeek"],
  });

export const patchSubscriptionBody = z.object({
  cadence: CADENCE.optional(),
  digestDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  notifyMode: NOTIFY_MODE.optional(),
});
export type SubscriptionPatch = z.infer<typeof patchSubscriptionBody>;

export const createRuleBody = z
  .object({
    scope: z.enum(["subscription", "global"]),
    subscriptionId: z.string().uuid().optional(),
    name: z.string().min(1).max(120),
    ruleJson: ruleGroupSchema,
    enabled: z.boolean().default(true),
  })
  .refine((b) => (b.scope === "subscription") === (b.subscriptionId !== undefined), {
    message: "subscriptionId is required for scope=subscription and forbidden for scope=global",
    path: ["subscriptionId"],
  });
export type RuleInput = z.infer<typeof createRuleBody>;

export const patchRuleBody = z.object({
  name: z.string().min(1).max(120).optional(),
  ruleJson: ruleGroupSchema.optional(),
  enabled: z.boolean().optional(),
});
export type RulePatch = z.infer<typeof patchRuleBody>;
