import { z } from "zod";
import { config } from "../config.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";

async function ytFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", config.youtubeApiKey);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`YouTube API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

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

export interface ResolvedChannel {
  youtubeChannelId: string;
  title: string;
  thumbnailUrl: string | null;
  uploadsPlaylistId: string;
}

function toResolvedChannel(item: z.infer<typeof channelListSchema>["items"][number]): ResolvedChannel {
  return {
    youtubeChannelId: item.id,
    title: item.snippet.title,
    thumbnailUrl: item.snippet.thumbnails?.default?.url ?? null,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
}

/** Resolves a channel by @handle, raw channel ID (UC...), or free-text search query. */
export async function resolveChannel(input: string): Promise<ResolvedChannel | null> {
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

export interface UploadListItem {
  youtubeVideoId: string;
  title: string;
  description: string | null;
  publishedAt: string;
  thumbnailUrl: string | null;
}

/**
 * Lists videos in an uploads playlist, newest first, stopping once
 * `sinceVideoId` is seen (or after `maxPages` if it's never found — a fresh
 * channel with no prior history).
 */
export async function listNewUploads(
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

export interface VideoStats {
  youtubeVideoId: string;
  viewCount: number;
  likeCount: number | null;
  commentCount: number | null;
  durationSeconds: number;
}

/** Fetches current stats for up to 50 video IDs per call; batches larger inputs. */
export async function batchGetVideoStats(videoIds: string[]): Promise<VideoStats[]> {
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
