import { z } from "zod";
import type { ResolvedChannel, UploadListItem, VideoStats } from "./types.js";

export type { ResolvedChannel, UploadListItem, VideoStats };

const API_BASE = "https://www.googleapis.com/youtube/v3";

/**
 * Everything ytdigest asks of YouTube. An interface so tests substitute a fake
 * and neither deployment target needs network access to run the suite.
 */
export interface YouTubeGateway {
  resolveChannel(input: string): Promise<ResolvedChannel | null>;
  listNewUploads(
    uploadsPlaylistId: string,
    sinceVideoId?: string,
    maxPages?: number,
  ): Promise<UploadListItem[]>;
  batchGetVideoStats(videoIds: string[]): Promise<VideoStats[]>;
}

/**
 * The key is passed in rather than read from config so the same code runs in
 * a Cloud Function, where it comes from Secret Manager at invocation time.
 */
export function createYouTubeClient(apiKey: string): YouTubeGateway {
  async function ytFetch(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${API_BASE}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("key", apiKey);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`YouTube API ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  return {
    resolveChannel: (input) => resolveChannel(ytFetch, input),
    listNewUploads: (playlistId, sinceVideoId, maxPages) =>
      listNewUploads(ytFetch, playlistId, sinceVideoId, maxPages),
    batchGetVideoStats: (ids) => batchGetVideoStats(ytFetch, ids),
  };
}

type YtFetch = (path: string, params: Record<string, string>) => Promise<unknown>;

/** Parses an ISO-8601 duration (e.g. "PT4M13S") into whole seconds. */
export function parseIsoDuration(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const [, h, m, s] = match;
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}

const channelListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        title: z.string(),
        thumbnails: z.object({ default: z.object({ url: z.string() }).optional() }).optional(),
      }),
      contentDetails: z.object({
        relatedPlaylists: z.object({ uploads: z.string() }),
      }),
    }),
  ),
});

function toResolvedChannel(item: z.infer<typeof channelListSchema>["items"][number]): ResolvedChannel {
  return {
    youtubeChannelId: item.id,
    title: item.snippet.title,
    thumbnailUrl: item.snippet.thumbnails?.default?.url ?? null,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
}

/** Resolves a channel by @handle, raw channel ID (UC...), or free-text search query. */
async function resolveChannel(ytFetch: YtFetch, input: string): Promise<ResolvedChannel | null> {
  const trimmed = input.trim();

  const byIdOrHandle: Record<string, string> | null = trimmed.startsWith("UC")
    ? { id: trimmed }
    : trimmed.startsWith("@")
      ? { forHandle: trimmed }
      : null;

  if (byIdOrHandle) {
    const raw = await ytFetch("channels", {
      part: "snippet,contentDetails",
      ...byIdOrHandle,
    });
    const parsed = channelListSchema.parse(raw);
    const item = parsed.items[0];
    return item ? toResolvedChannel(item) : null;
  }

  // Free-text fallback: search.list (100 quota units) then look up full details.
  const searchSchema = z.object({
    items: z.array(z.object({ id: z.object({ channelId: z.string().optional() }) })),
  });
  const searchRaw = await ytFetch("search", {
    part: "snippet",
    type: "channel",
    maxResults: "1",
    q: trimmed,
  });
  const searchResult = searchSchema.parse(searchRaw);
  const channelId = searchResult.items[0]?.id.channelId;
  if (!channelId) return null;

  const raw = await ytFetch("channels", { part: "snippet,contentDetails", id: channelId });
  const parsed = channelListSchema.parse(raw);
  const item = parsed.items[0];
  return item ? toResolvedChannel(item) : null;
}

const playlistItemsSchema = z.object({
  items: z.array(
    z.object({
      contentDetails: z.object({
        videoId: z.string(),
        videoPublishedAt: z.string().optional(),
      }),
      snippet: z.object({
        title: z.string(),
        description: z.string().optional(),
        thumbnails: z.object({ medium: z.object({ url: z.string() }).optional() }).optional(),
      }),
    }),
  ),
  nextPageToken: z.string().optional(),
});

/**
 * Lists videos in an uploads playlist, newest first, stopping once
 * `sinceVideoId` is seen (or after `maxPages` if it's never found — a fresh
 * channel with no prior history).
 */
async function listNewUploads(
  ytFetch: YtFetch,
  uploadsPlaylistId: string,
  sinceVideoId?: string,
  maxPages = 5,
): Promise<UploadListItem[]> {
  const results: UploadListItem[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const raw = await ytFetch("playlistItems", {
      part: "snippet,contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    const parsed = playlistItemsSchema.parse(raw);

    for (const item of parsed.items) {
      if (item.contentDetails.videoId === sinceVideoId) return results;
      results.push({
        youtubeVideoId: item.contentDetails.videoId,
        title: item.snippet.title,
        description: item.snippet.description ?? null,
        publishedAt: item.contentDetails.videoPublishedAt ?? new Date().toISOString(),
        thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? null,
      });
    }

    if (!parsed.nextPageToken) break;
    pageToken = parsed.nextPageToken;
  }

  return results;
}

const videoListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      statistics: z.object({
        viewCount: z.string().optional(),
        likeCount: z.string().optional(),
        commentCount: z.string().optional(),
      }),
      contentDetails: z.object({ duration: z.string() }),
    }),
  ),
});

/** Fetches current stats for up to 50 video IDs per call; batches larger inputs. */
async function batchGetVideoStats(ytFetch: YtFetch, videoIds: string[]): Promise<VideoStats[]> {
  const out: VideoStats[] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    if (batch.length === 0) continue;
    const raw = await ytFetch("videos", {
      part: "statistics,contentDetails",
      id: batch.join(","),
    });
    const parsed = videoListSchema.parse(raw);
    for (const item of parsed.items) {
      out.push({
        youtubeVideoId: item.id,
        viewCount: Number(item.statistics.viewCount ?? 0),
        likeCount: item.statistics.likeCount != null ? Number(item.statistics.likeCount) : null,
        commentCount:
          item.statistics.commentCount != null ? Number(item.statistics.commentCount) : null,
        durationSeconds: parseIsoDuration(item.contentDetails.duration),
      });
    }
  }
  return out;
}
