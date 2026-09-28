import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PastVideo, Snapshot } from "../types.js";
import { dayOfWeek, runDateString } from "../digest.js";
import { type BaselineSource, evaluateRule, type VideoForEvaluation } from "./evaluate.js";

/**
 * The baseline arithmetic, with the storage replaced by a fixed history. The
 * repos' own queries (pastVideos, snapshotAtOrBefore) are covered by the
 * contract suite; this pins the comparison they feed.
 */

const HOUR = 3_600_000;
const T0 = Date.parse("2026-09-01T00:00:00Z");

/** Six past videos, each at 100 views/hour and a 5% like ratio six hours in. */
function history(): BaselineSource {
  const past: PastVideo[] = Array.from({ length: 6 }, (_, i) => ({
    id: `past${i}`,
    publishedAt: new Date(T0 - (i + 1) * 24 * HOUR),
  }));
  return {
    async pastVideos(_channelId, excludeVideoId, limit) {
      return past.filter((p) => p.id !== excludeVideoId).slice(0, limit);
    },
    async snapshotAtOrBefore(videoId, cutoff): Promise<Snapshot | null> {
      const p = past.find((v) => v.id === videoId)!;
      const capturedAt = new Date(p.publishedAt.getTime() + 6 * HOUR);
      if (capturedAt > cutoff) return null;
      return { viewCount: 600, likeCount: 30, capturedAt };
    },
  };
}

const candidate = (views: number, likes: number): VideoForEvaluation => ({
  id: "new",
  channelId: "c",
  title: "A new video",
  description: null,
  publishedAt: new Date(T0),
  durationSeconds: 300,
  latestViewCount: views,
  latestLikeCount: likes,
  latestCapturedAt: new Date(T0 + 6 * HOUR),
});

const perf = (threshold: number) => ({
  op: "AND" as const,
  conditions: [
    {
      type: "performance" as const,
      metric: "views_per_hour" as const,
      comparedTo: "channel_baseline" as const,
      threshold,
    },
  ],
});

describe("rule evaluation", () => {
  it("matches a video running ahead of the channel's pace at the same age", async () => {
    // 1,200 views in 6h = 200/h, twice the baseline's 100/h.
    const result = await evaluateRule(history(), perf(1.5), candidate(1200, 60));
    assert.deepEqual(result, { matched: true, reasons: ["2.0x this channel's usual pace"] });
    assert.equal((await evaluateRule(history(), perf(2.5), candidate(1200, 60))).matched, false);
  });

  it("needs minHistory comparable videos before a baseline rule can match", async () => {
    const result = await evaluateRule(history(), perf(1.5), candidate(1200, 60), {
      sampleSize: 10,
      minHistory: 7,
    });
    assert.equal(result.matched, false);
  });

  it("compares engagement against the median like ratio", async () => {
    const rule = {
      op: "AND" as const,
      conditions: [
        {
          type: "engagement" as const,
          metric: "like_ratio" as const,
          comparedTo: "channel_baseline" as const,
          threshold: 1.5,
        },
      ],
    };
    // 10% likes against a 5% baseline.
    assert.deepEqual(await evaluateRule(history(), rule, candidate(600, 60)), {
      matched: true,
      reasons: ["2.0x this channel's usual engagement"],
    });
  });

  it("evaluates nested groups with AND/OR", async () => {
    const rule = {
      op: "AND" as const,
      conditions: [
        { type: "duration" as const, min: 60, max: 600 },
        {
          op: "OR" as const,
          conditions: [
            { type: "keyword" as const, field: "title" as const, match: "any" as const, terms: ["nope"] },
            { type: "keyword" as const, field: "title" as const, match: "all" as const, terms: ["new", "VIDEO"] },
          ],
        },
      ],
    };
    assert.equal((await evaluateRule(history(), rule, candidate(1, 0))).matched, true);
  });
});

describe("digest calendar", () => {
  const lateSundayInNewYork = new Date("2026-09-28T02:00:00Z");

  it("takes the weekday and date in the configured zone", () => {
    assert.equal(dayOfWeek(lateSundayInNewYork, "America/New_York"), 0);
    assert.equal(dayOfWeek(lateSundayInNewYork, "UTC"), 1);
    assert.equal(runDateString(lateSundayInNewYork, "America/New_York"), "2026-09-27");
  });

  it("keeps the old behaviour when no zone is set", () => {
    assert.equal(dayOfWeek(lateSundayInNewYork), lateSundayInNewYork.getDay());
    assert.equal(runDateString(lateSundayInNewYork), "2026-09-28", "the UTC date, as before");
  });
});
