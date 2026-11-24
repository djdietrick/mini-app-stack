import type { Closable } from "@stack/service-kit";
import type { ScopedRule } from "../domain/match.js";
import type {
  Cadence,
  ChannelRow,
  FeedCandidate,
  FeedCursor,
  NotifyMode,
  PastVideo,
  PollTarget,
  ResolvedChannel,
  RuleInput,
  RulePatch,
  RuleRow,
  Snapshot,
  SubscriptionPatch,
  SubscriptionRow,
  TrackedVideo,
  UploadListItem,
  VideoStats,
  WatchProgress,
} from "../domain/types.js";

/**
 * ytdigest's data port. Implemented by postgres.ts (self-hosted) and
 * firestore.ts (cloud); src/domain depends only on this.
 *
 * Four groups of callers:
 *   - the HTTP routes: the wire-row methods, scoped by userId in the query
 *   - the feed: candidate videos from the user's subscriptions, filtered in
 *     src/domain/feed.ts with the rule matcher
 *   - the poll job: channel and video bookkeeping, snapshots
 *   - rule evaluation: enabled rules, snapshots and baselines
 *
 * Mutations report "did it match" rather than throwing, so the route owns the
 * 404.
 */
export interface YtdigestRepo extends Closable {
  // ---------- channels ----------

  /** Every known channel, with this user's subscription id where they have one. */
  listChannels(userId: string): Promise<ChannelRow[]>;
  /** Insert or refresh by YouTube channel id; returns the channel's id. */
  upsertChannel(channel: ResolvedChannel): Promise<string>;

  // ---------- subscriptions ----------

  listSubscriptions(userId: string): Promise<SubscriptionRow[]>;
  /** Null when the user already subscribes to this channel. */
  createSubscription(
    userId: string,
    channelId: string,
    cadence: Cadence,
    digestDayOfWeek: number | null,
    notifyMode: NotifyMode,
  ): Promise<string | null>;
  subscriptionExists(userId: string, id: string): Promise<boolean>;
  /** Callers skip this for an empty patch, matching the original no-op. */
  updateSubscription(userId: string, id: string, patch: SubscriptionPatch): Promise<boolean>;
  /** Also removes the subscription's rules. */
  deleteSubscription(userId: string, id: string): Promise<boolean>;

  // ---------- rules ----------

  listRules(userId: string): Promise<RuleRow[]>;
  createRule(userId: string, input: RuleInput): Promise<string>;
  /** Callers skip this for an empty patch, matching the original no-op. */
  updateRule(userId: string, id: string, patch: RulePatch): Promise<boolean>;
  deleteRule(userId: string, id: string): Promise<boolean>;

  // ---------- feed ----------

  /**
   * Videos from channels this user subscribes to, newest published first
   * (ties by id, descending), strictly after `after` in that order. The
   * feed is a view, not a queue. With `subscriptionId`, only that one of the
   * user's subscriptions (a channel's own page).
   */
  feedCandidates(
    userId: string,
    after: FeedCursor | null,
    limit: number,
    subscriptionId?: string,
  ): Promise<FeedCandidate[]>;
  /** One video by its YouTube id, only if this user subscribes to its channel. */
  feedVideo(userId: string, youtubeVideoId: string): Promise<FeedCandidate | null>;

  // ---------- watch progress ----------

  /** This user's progress in each of these videos (internal ids); a video never played is absent. */
  watchProgress(userId: string, videoIds: string[]): Promise<Map<string, WatchProgress>>;
  /** Inserts or overwrites this user's position in one video (internal id). */
  saveWatchProgress(
    userId: string,
    videoId: string,
    progress: { positionSeconds: number; durationSeconds: number },
  ): Promise<void>;

  // ---------- poll job ----------

  /** Channels with at least one subscriber. */
  channelsToPoll(): Promise<PollTarget[]>;
  /** The channel's most recently published video, to stop paging uploads at. */
  latestVideoId(channelId: string): Promise<string | null>;
  /** Inserts uploads not already known; existing ones are left untouched. */
  insertVideos(channelId: string, uploads: UploadListItem[]): Promise<void>;
  /** The channel's most recent videos, newest first. */
  trackedVideos(channelId: string, limit: number): Promise<TrackedVideo[]>;
  /** Appends a stats snapshot, and records the duration the first time it is seen. */
  recordStats(video: TrackedVideo, stats: VideoStats): Promise<void>;
  markPolled(channelId: string): Promise<void>;

  // ---------- rule evaluation ----------

  /**
   * Enabled rules that could apply to this subscription: its own plus the
   * user's global ones, each with its scope. Which of them actually apply is
   * `applicableRules` (domain), not the repo's call.
   */
  enabledRules(userId: string, subscriptionId: string): Promise<ScopedRule[]>;
  latestSnapshot(videoId: string): Promise<Snapshot | null>;
  /** The channel's most recent videos other than `excludeVideoId`, newest first. */
  pastVideos(channelId: string, excludeVideoId: string, limit: number): Promise<PastVideo[]>;
  /** The latest snapshot taken at or before `cutoff`. */
  snapshotAtOrBefore(videoId: string, cutoff: Date): Promise<Snapshot | null>;
}
