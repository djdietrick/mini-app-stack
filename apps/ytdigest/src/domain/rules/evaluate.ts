import type { YtdigestRepo } from "../../repo/types.js";
import { isRuleGroup, type Condition, type RuleGroup } from "./types.js";

/** What evaluation reads: past videos and their snapshots, for baselines. */
export type BaselineSource = Pick<YtdigestRepo, "pastVideos" | "snapshotAtOrBefore">;

export interface BaselineOptions {
  /** Trailing videos considered when computing a channel's performance baseline. */
  sampleSize: number;
  /** Minimum videos of history required before a performance/engagement rule can match. */
  minHistory: number;
}

export const DEFAULT_BASELINE: BaselineOptions = { sampleSize: 10, minHistory: 5 };

export interface VideoForEvaluation {
  id: string;
  channelId: string;
  title: string;
  description: string | null;
  publishedAt: Date;
  durationSeconds: number | null;
  latestViewCount: number;
  latestLikeCount: number | null;
  latestCapturedAt: Date;
}

export interface EvaluationResult {
  matched: boolean;
  reasons: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Trailing baseline for a channel: the median views-per-hour and like-ratio
 * of its last N videos (excluding the candidate), each measured at the
 * nearest stats snapshot at-or-before the same elapsed-time-since-publish as
 * the candidate video — so a 6-hour-old video is compared to how other
 * videos looked 6 hours after *their* publish, not their current totals.
 */
export async function computeChannelBaseline(
  source: BaselineSource,
  video: VideoForEvaluation,
  opts: BaselineOptions,
): Promise<{ viewsPerHourMedian: number | null; likeRatioMedian: number | null; sampleSize: number }> {
  const elapsedMs = video.latestCapturedAt.getTime() - video.publishedAt.getTime();

  const history = await source.pastVideos(video.channelId, video.id, opts.sampleSize);

  const viewsPerHour: number[] = [];
  const likeRatios: number[] = [];

  for (const past of history) {
    const cutoff = new Date(past.publishedAt.getTime() + elapsedMs);
    const snapshot = await source.snapshotAtOrBefore(past.id, cutoff);
    if (!snapshot) continue;

    const hoursElapsed = Math.max(
      (snapshot.capturedAt.getTime() - past.publishedAt.getTime()) / 3_600_000,
      0.1,
    );
    viewsPerHour.push(snapshot.viewCount / hoursElapsed);
    if (snapshot.likeCount != null && snapshot.viewCount > 0) {
      likeRatios.push(snapshot.likeCount / snapshot.viewCount);
    }
  }

  return {
    viewsPerHourMedian: median(viewsPerHour),
    likeRatioMedian: median(likeRatios),
    sampleSize: viewsPerHour.length,
  };
}

function evaluateKeyword(condition: Extract<Condition, { type: "keyword" }>, video: VideoForEvaluation): boolean {
  const haystack = (condition.field === "title" ? video.title : video.description ?? "").toLowerCase();
  const terms = condition.terms.map((t) => t.toLowerCase());
  if (condition.match === "any") return terms.some((t) => haystack.includes(t));
  if (condition.match === "all") return terms.every((t) => haystack.includes(t));
  return terms.every((t) => !haystack.includes(t));
}

function evaluateDuration(condition: Extract<Condition, { type: "duration" }>, video: VideoForEvaluation): boolean {
  if (video.durationSeconds == null) return false;
  if (condition.min != null && video.durationSeconds < condition.min) return false;
  if (condition.max != null && video.durationSeconds > condition.max) return false;
  return true;
}

async function evaluateCondition(
  source: BaselineSource,
  opts: BaselineOptions,
  condition: Condition,
  video: VideoForEvaluation,
  reasons: string[],
): Promise<boolean> {
  switch (condition.type) {
    case "keyword": {
      const matched = evaluateKeyword(condition, video);
      if (matched) reasons.push(`title/description ${condition.match} of: ${condition.terms.join(", ")}`);
      return matched;
    }
    case "duration":
      return evaluateDuration(condition, video);
    case "performance": {
      const baseline = await computeChannelBaseline(source, video, opts);
      if (baseline.sampleSize < opts.minHistory || !baseline.viewsPerHourMedian) return false;
      const hoursElapsed = Math.max(
        (video.latestCapturedAt.getTime() - video.publishedAt.getTime()) / 3_600_000,
        0.1,
      );
      const viewsPerHour = video.latestViewCount / hoursElapsed;
      const ratio = viewsPerHour / baseline.viewsPerHourMedian;
      const matched = ratio >= condition.threshold;
      if (matched) reasons.push(`${ratio.toFixed(1)}x this channel's usual pace`);
      return matched;
    }
    case "engagement": {
      const baseline = await computeChannelBaseline(source, video, opts);
      if (baseline.sampleSize < opts.minHistory || !baseline.likeRatioMedian) return false;
      if (video.latestViewCount === 0) return false;
      const likeRatio = (video.latestLikeCount ?? 0) / video.latestViewCount;
      const ratio = likeRatio / baseline.likeRatioMedian;
      const matched = ratio >= condition.threshold;
      if (matched) reasons.push(`${ratio.toFixed(1)}x this channel's usual engagement`);
      return matched;
    }
  }
}

async function evaluateGroup(
  source: BaselineSource,
  opts: BaselineOptions,
  group: RuleGroup,
  video: VideoForEvaluation,
  reasons: string[],
): Promise<boolean> {
  const results: boolean[] = [];
  for (const node of group.conditions) {
    results.push(
      isRuleGroup(node)
        ? await evaluateGroup(source, opts, node, video, reasons)
        : await evaluateCondition(source, opts, node, video, reasons),
    );
  }
  return group.op === "AND" ? results.every(Boolean) : results.some(Boolean);
}

export async function evaluateRule(
  source: BaselineSource,
  rule: RuleGroup,
  video: VideoForEvaluation,
  opts: BaselineOptions = DEFAULT_BASELINE,
): Promise<EvaluationResult> {
  const reasons: string[] = [];
  const matched = await evaluateGroup(source, opts, rule, video, reasons);
  return { matched, reasons };
}
