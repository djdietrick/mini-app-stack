import type postgres from "postgres";
import { config } from "../config.js";
import { isRuleGroup, type Condition, type RuleGroup } from "./types.js";

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

interface BaselineSnapshotRow {
  view_count: number;
  like_count: number | null;
  captured_at: Date;
}

/**
 * Trailing baseline for a channel: the median views-per-hour and like-ratio
 * of its last N videos (excluding the candidate), each measured at the
 * nearest stats snapshot at-or-before the same elapsed-time-since-publish as
 * the candidate video — so a 6-hour-old video is compared to how other
 * videos looked 6 hours after *their* publish, not their current totals.
 */
export async function computeChannelBaseline(
  sql: postgres.Sql,
  video: VideoForEvaluation,
): Promise<{ viewsPerHourMedian: number | null; likeRatioMedian: number | null; sampleSize: number }> {
  const elapsedMs = video.latestCapturedAt.getTime() - video.publishedAt.getTime();

  const history = await sql<{ id: string; published_at: Date }[]>`
    SELECT id, published_at FROM videos
    WHERE channel_id = ${video.channelId} AND id != ${video.id}
    ORDER BY published_at DESC
    LIMIT ${config.baselineSampleSize}
  `;

  const viewsPerHour: number[] = [];
  const likeRatios: number[] = [];

  for (const past of history) {
    const cutoff = new Date(past.published_at.getTime() + elapsedMs);
    const [snapshot] = await sql<BaselineSnapshotRow[]>`
      SELECT view_count, like_count, captured_at FROM video_stats_snapshots
      WHERE video_id = ${past.id} AND captured_at <= ${cutoff}
      ORDER BY captured_at DESC
      LIMIT 1
    `;
    if (!snapshot) continue;

    const hoursElapsed = Math.max(
      (snapshot.captured_at.getTime() - past.published_at.getTime()) / 3_600_000,
      0.1,
    );
    viewsPerHour.push(snapshot.view_count / hoursElapsed);
    if (snapshot.like_count != null && snapshot.view_count > 0) {
      likeRatios.push(snapshot.like_count / snapshot.view_count);
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
  sql: postgres.Sql,
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
      const baseline = await computeChannelBaseline(sql, video);
      if (baseline.sampleSize < config.baselineMinHistory || !baseline.viewsPerHourMedian) return false;
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
      const baseline = await computeChannelBaseline(sql, video);
      if (baseline.sampleSize < config.baselineMinHistory || !baseline.likeRatioMedian) return false;
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
  sql: postgres.Sql,
  group: RuleGroup,
  video: VideoForEvaluation,
  reasons: string[],
): Promise<boolean> {
  const results: boolean[] = [];
  for (const node of group.conditions) {
    results.push(
      isRuleGroup(node)
        ? await evaluateGroup(sql, node, video, reasons)
        : await evaluateCondition(sql, node, video, reasons),
    );
  }
  return group.op === "AND" ? results.every(Boolean) : results.some(Boolean);
}

export async function evaluateRule(
  sql: postgres.Sql,
  rule: RuleGroup,
  video: VideoForEvaluation,
): Promise<EvaluationResult> {
  const reasons: string[] = [];
  const matched = await evaluateGroup(sql, rule, video, reasons);
  return { matched, reasons };
}
