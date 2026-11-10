import type { YtdigestRepo } from "../repo/types.js";
import type { RuleGroup } from "./rules/types.js";
import { type BaselineOptions, evaluateRule, type VideoForEvaluation } from "./rules/evaluate.js";
import type { CandidateVideo, NotifyMode, RuleScope } from "./types.js";

/** What matching reads: the latest snapshot, and the baseline's history. */
export type MatchSource = Pick<YtdigestRepo, "latestSnapshot" | "pastVideos" | "snapshotAtOrBefore">;

export interface MatchSubscription {
  channelId: string;
  notifyMode: NotifyMode;
}

export interface ScopedRule {
  id: string;
  scope: RuleScope;
  rule: RuleGroup;
}

/**
 * The rules a subscription is filtered by. A channel's own rules replace the
 * "all channels" ones rather than adding to them: once you have said what you
 * want from a channel, a global rule must not let anything else through. A
 * channel with no enabled rules of its own falls back to the global ones.
 */
export function applicableRules(rules: ScopedRule[]): ScopedRule[] {
  const own = rules.filter((r) => r.scope === "subscription");
  return own.length > 0 ? own : rules.filter((r) => r.scope === "global");
}

export interface MatchResult {
  matched: boolean;
  matchedRuleId: string | null;
  reasons: string[];
  /** From the latest snapshot; 0 before the first one. */
  viewCount: number;
}

/**
 * Whether a subscription's video passes its filters: every upload in
 * notify-mode "all", otherwise the first of `rules` that matches. The one
 * rule both the email digest and the feed apply, so they never disagree about
 * what counts as a video you care about.
 */
export async function matchVideo(
  source: MatchSource,
  sub: MatchSubscription,
  rules: { id: string; rule: RuleGroup }[],
  video: CandidateVideo,
  baseline: BaselineOptions,
): Promise<MatchResult> {
  const snapshot = await source.latestSnapshot(video.id);
  const viewCount = snapshot?.viewCount ?? 0;

  if (sub.notifyMode === "all") {
    return { matched: true, matchedRuleId: null, reasons: ["every upload from this channel"], viewCount };
  }

  const evalVideo: VideoForEvaluation = {
    id: video.id,
    channelId: sub.channelId,
    title: video.title,
    description: video.description,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
    latestViewCount: viewCount,
    latestLikeCount: snapshot?.likeCount ?? null,
    latestCapturedAt: snapshot?.capturedAt ?? video.publishedAt,
  };

  for (const { id, rule } of rules) {
    const result = await evaluateRule(source, rule, evalVideo, baseline);
    if (result.matched) return { matched: true, matchedRuleId: id, reasons: result.reasons, viewCount };
  }
  return { matched: false, matchedRuleId: null, reasons: [], viewCount };
}
