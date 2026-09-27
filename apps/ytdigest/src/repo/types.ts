import type { Closable } from "@stack/service-kit";
import type { RuleGroup } from "../domain/rules/types.js";
import type {
  CandidateVideo,
  Cadence,
  ChannelRow,
  DigestDetail,
  DigestLine,
  DigestRecipient,
  DigestRunRow,
  DueSubscription,
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
} from "../domain/types.js";

/**
 * ytdigest's data port. Implemented by postgres.ts (self-hosted) and
 * firestore.ts (cloud); src/domain depends only on this.
 *
 * Three groups of callers:
 *   - the HTTP routes: the wire-row methods, scoped by userId in the query
 *   - the poll job: channel and video bookkeeping, snapshots
 *   - the digest job and rule evaluation: due subscriptions, candidates,
 *     baselines, recording what was sent
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
  /** Also removes the subscription's rules and its lines in past digests. */
  deleteSubscription(userId: string, id: string): Promise<boolean>;

  // ---------- rules ----------

  listRules(userId: string): Promise<RuleRow[]>;
  createRule(userId: string, input: RuleInput): Promise<string>;
  /** Callers skip this for an empty patch, matching the original no-op. */
  updateRule(userId: string, id: string, patch: RulePatch): Promise<boolean>;
  deleteRule(userId: string, id: string): Promise<boolean>;

  // ---------- digests (HTTP) ----------

  listDigests(userId: string): Promise<DigestRunRow[]>;
  getDigest(userId: string, id: string): Promise<DigestDetail | null>;

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

  // ---------- digest job ----------

  /** Everyone with at least one subscription, with the address to mail. */
  digestRecipients(): Promise<DigestRecipient[]>;
  /**
   * Daily subscriptions, plus weekly ones set for `dayOfWeek` (0 = Sunday).
   * Every subscription when `force` is set, for "run now".
   */
  dueSubscriptions(userId: string, dayOfWeek: number, force: boolean): Promise<DueSubscription[]>;
  /**
   * Videos first seen since the subscription was last digested that this
   * user hasn't been sent, oldest published first.
   */
  candidateVideos(userId: string, sub: DueSubscription): Promise<CandidateVideo[]>;
  /** Enabled rules that apply to this subscription: its own plus the user's global ones. */
  enabledRules(userId: string, subscriptionId: string): Promise<{ id: string; rule: RuleGroup }[]>;
  latestSnapshot(videoId: string): Promise<Snapshot | null>;
  /** The channel's most recent videos other than `excludeVideoId`, newest first. */
  pastVideos(channelId: string, excludeVideoId: string, limit: number): Promise<PastVideo[]>;
  /** The latest snapshot taken at or before `cutoff`. */
  snapshotAtOrBefore(videoId: string, cutoff: Date): Promise<Snapshot | null>;
  /** Starts each subscription's next window at `runDate`. */
  markDigested(subscriptionIds: string[], runDate: Date): Promise<void>;
  /**
   * Records a sent digest and marks its videos as notified, atomically, so a
   * video is never sent to the same user twice.
   */
  recordDigest(
    userId: string,
    cadence: Cadence,
    runDate: string,
    lines: DigestLine[],
  ): Promise<void>;
}
