import type { YtdigestRepo } from "../repo/types.js";
import { type MatchResult, matchVideo } from "./match.js";
import type { RuleGroup } from "./rules/types.js";
import { type BaselineOptions, DEFAULT_BASELINE } from "./rules/evaluate.js";
import type {
  FeedCandidate,
  FeedCursor,
  FeedItemRow,
  FeedPage,
  VideoDetailRow,
} from "./types.js";

/**
 * The feed: every upload from the user's subscriptions that passes its
 * filters, newest first. Nothing is stored for it. It is the digest's match
 * applied on read, so editing or disabling a rule changes the feed at once,
 * and a video that has since broken out (a performance rule) shows up without
 * waiting for anything.
 *
 * Filtering happens after the query, so a page is found by scanning
 * candidates in batches until it is full. The scan is capped per request; a
 * page can come back short with a `next` cursor, which just means "keep
 * going".
 */

/** Candidates read per repo call. */
const SCAN_BATCH = 50;
/** Candidates examined per request at most, however few of them match. */
const MAX_SCAN = 200;
/** Matches evaluated at once; each costs a few repo reads. */
const CONCURRENCY = 8;

export const FEED_DEFAULT_LIMIT = 24;
export const FEED_MAX_LIMIT = 50;

/** Opaque to the SPA: `<ISO published_at>|<video id>`. */
export function encodeCursor(c: FeedCursor): string {
  return `${c.publishedAt.toISOString()}|${c.videoId}`;
}

export function decodeCursor(s: string): FeedCursor | null {
  const bar = s.indexOf("|");
  if (bar < 0) return null;
  const publishedAt = new Date(s.slice(0, bar));
  const videoId = s.slice(bar + 1);
  if (Number.isNaN(publishedAt.getTime()) || !videoId) return null;
  return { publishedAt, videoId };
}

const cursorOf = (c: FeedCandidate): FeedCursor => ({ publishedAt: c.publishedAt, videoId: c.id });

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function toRow(c: FeedCandidate, m: MatchResult): FeedItemRow {
  return {
    video_id: c.id,
    youtube_video_id: c.youtubeVideoId,
    title: c.title,
    thumbnail_url: c.thumbnailUrl,
    published_at: c.publishedAt.toISOString(),
    duration_seconds: c.durationSeconds,
    view_count: m.viewCount,
    channel_id: c.subscription.channelId,
    channel_title: c.subscription.channelTitle,
    channel_thumbnail_url: c.subscription.channelThumbnailUrl,
    matched_rule_id: m.matchedRuleId,
    reasons: m.reasons,
  };
}

/** Enabled rules per subscription, read once per request. */
function rulesLoader(repo: YtdigestRepo, userId: string) {
  const cache = new Map<string, Promise<{ id: string; rule: RuleGroup }[]>>();
  return (c: FeedCandidate) => {
    if (c.subscription.notifyMode === "all") return Promise.resolve([]);
    let rules = cache.get(c.subscription.id);
    if (!rules) {
      rules = repo.enabledRules(userId, c.subscription.id);
      cache.set(c.subscription.id, rules);
    }
    return rules;
  };
}

export async function buildFeed(
  repo: YtdigestRepo,
  userId: string,
  { before, limit }: { before: FeedCursor | null; limit: number },
  baseline: BaselineOptions = DEFAULT_BASELINE,
): Promise<FeedPage> {
  const rulesFor = rulesLoader(repo, userId);
  const items: FeedItemRow[] = [];
  let cursor = before;
  let scanned = 0;

  while (scanned < MAX_SCAN) {
    const batch = await repo.feedCandidates(userId, cursor, SCAN_BATCH);
    const matches = await mapConcurrent(batch, CONCURRENCY, async (c) =>
      matchVideo(repo, c.subscription, await rulesFor(c), c, baseline),
    );
    const exhausted = batch.length < SCAN_BATCH;

    for (let i = 0; i < batch.length; i++) {
      if (!matches[i].matched) continue;
      items.push(toRow(batch[i], matches[i]));
      if (items.length === limit) {
        const last = exhausted && i === batch.length - 1;
        return { items, next: last ? null : encodeCursor(cursorOf(batch[i])) };
      }
    }

    if (exhausted) return { items, next: null };
    scanned += batch.length;
    cursor = cursorOf(batch[batch.length - 1]);
  }

  return { items, next: cursor ? encodeCursor(cursor) : null };
}

/** One video for the player, or null when it isn't from one of the user's channels. */
export async function videoDetail(
  repo: YtdigestRepo,
  userId: string,
  youtubeVideoId: string,
  baseline: BaselineOptions = DEFAULT_BASELINE,
): Promise<VideoDetailRow | null> {
  const c = await repo.feedVideo(userId, youtubeVideoId);
  if (!c) return null;
  const m = await matchVideo(repo, c.subscription, await rulesLoader(repo, userId)(c), c, baseline);
  return { ...toRow(c, m), description: c.description, matched: m.matched };
}
