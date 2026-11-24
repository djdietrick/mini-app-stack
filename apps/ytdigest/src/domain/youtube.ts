import { z } from "zod";
import type { ChannelSearchResult, ResolvedChannel, UploadListItem, VideoStats } from "./types.js";

export type { ChannelSearchResult, ResolvedChannel, UploadListItem, VideoStats };

const API_BASE = "https://www.googleapis.com/youtube/v3";

/**
 * Everything ytdigest asks of YouTube. An interface so tests substitute a fake
 * and neither deployment target needs network access to run the suite.
 */
export interface YouTubeGateway {
  resolveChannel(input: string): Promise<ResolvedChannel | null>;
  /**
   * Channels for what someone typed: a name, an @handle, a channel id or a
   * channel URL. A name costs a search (100 quota units); the rest are direct
   * lookups (1 unit) and give at most one result.
   */
  searchChannels(input: string): Promise<ChannelSearchResult[]>;
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

  // A search costs 100 of the default 10,000 daily quota units, so the same
  // query (typed again, or by another user) is answered from here for a while.
  const searches = new Map<string, { at: number; results: ChannelSearchResult[] }>();

  return {
    resolveChannel: (input) => resolveChannel(ytFetch, input),
    async searchChannels(input) {
      const key = input.trim().toLowerCase();
      const hit = searches.get(key);
      if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.results;
      const results = await searchChannels(ytFetch, input);
      if (searches.size >= SEARCH_CACHE_SIZE) searches.delete(searches.keys().next().value!);
      searches.set(key, { at: Date.now(), results });
      return results;
    },
    listNewUploads: (playlistId, sinceVideoId, maxPages) =>
      listNewUploads(ytFetch, playlistId, sinceVideoId, maxPages),
    batchGetVideoStats: (ids) => batchGetVideoStats(ytFetch, ids),
  };
}

type YtFetch = (path: string, params: Record<string, string>) => Promise<unknown>;

const SEARCH_CACHE_MS = 10 * 60 * 1000;
const SEARCH_CACHE_SIZE = 200;
/** Results per name search. search.list costs the same for 1 or 50. */
export const CHANNEL_SEARCH_LIMIT = 8;

/** What someone typed to find a channel, once it is clear which kind it is. */
export type ChannelInput =
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "username"; value: string }
  | { kind: "query"; value: string };

const CHANNEL_ID = /^UC[\w-]{22}$/;

/**
 * Sorts a channel reference into a direct lookup or a name search. Takes
 * `@handle`, a `UC…` channel id, or a youtube.com URL (`/@handle`,
 * `/channel/UC…`, `/user/name`, `/c/name`); anything else is a name to search
 * for. A legacy `/c/` name has no lookup of its own, so it is searched.
 */
export function parseChannelInput(input: string): ChannelInput {
  const trimmed = input.trim();
  if (CHANNEL_ID.test(trimmed)) return { kind: "id", value: trimmed };
  if (/^@[\w.-]+$/.test(trimmed)) return { kind: "handle", value: trimmed };

  const url = /^(?:https?:\/\/)?(?:[\w-]+\.)*youtube\.com\/(\S*)$/i.exec(trimmed);
  if (url) {
    const [first = "", second = ""] = url[1].split(/[?#]/)[0].split("/").map(safeDecode);
    if (/^@[\w.-]+$/.test(first)) return { kind: "handle", value: first };
    if (first === "channel" && CHANNEL_ID.test(second)) return { kind: "id", value: second };
    if (first === "user" && second) return { kind: "username", value: second };
    if (first === "c" && second) return { kind: "query", value: second };
  }
  return { kind: "query", value: trimmed };
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** channels.list's filter for a direct lookup. */
function lookupParams(input: ChannelInput): Record<string, string> | null {
  switch (input.kind) {
    case "id":
      return { id: input.value };
    case "handle":
      return { forHandle: input.value };
    case "username":
      return { forUsername: input.value };
    case "query":
      return null;
  }
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
  )
    // channels.list leaves `items` out when nothing matches.
    .default([]),
});

function toResolvedChannel(item: z.infer<typeof channelListSchema>["items"][number]): ResolvedChannel {
  return {
    youtubeChannelId: item.id,
    title: item.snippet.title,
    thumbnailUrl: item.snippet.thumbnails?.default?.url ?? null,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
}

/** Resolves a channel by @handle, channel id, channel URL, or the top result of a name search. */
async function resolveChannel(ytFetch: YtFetch, input: string): Promise<ResolvedChannel | null> {
  const parsed = parseChannelInput(input);
  let filter = lookupParams(parsed);

  if (!filter) {
    // A name: search.list (100 quota units), then look up full details.
    const channelId = (await searchChannelIds(ytFetch, parsed.value, 1))[0];
    if (!channelId) return null;
    filter = { id: channelId };
  }

  const raw = await ytFetch("channels", { part: "snippet,contentDetails", ...filter });
  const item = channelListSchema.parse(raw).items[0];
  return item ? toResolvedChannel(item) : null;
}

const searchSchema = z.object({
  items: z.array(z.object({ id: z.object({ channelId: z.string().optional() }) })),
});

async function searchChannelIds(ytFetch: YtFetch, q: string, max: number): Promise<string[]> {
  const raw = await ytFetch("search", {
    part: "snippet",
    type: "channel",
    maxResults: String(max),
    q,
  });
  return searchSchema.parse(raw).items.flatMap((i) => (i.id.channelId ? [i.id.channelId] : []));
}

const channelDetailsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({
          title: z.string(),
          description: z.string().optional(),
          customUrl: z.string().optional(),
          thumbnails: z
            .object({
              default: z.object({ url: z.string() }).optional(),
              medium: z.object({ url: z.string() }).optional(),
            })
            .optional(),
        }),
        statistics: z
          .object({
            subscriberCount: z.string().optional(),
            hiddenSubscriberCount: z.boolean().optional(),
            videoCount: z.string().optional(),
          })
          .optional(),
      }),
    )
    // channels.list leaves `items` out when nothing matches.
    .default([]),
});

/** Channels for a name, @handle, id or URL, best match first. */
async function searchChannels(ytFetch: YtFetch, input: string): Promise<ChannelSearchResult[]> {
  const parsed = parseChannelInput(input);
  let filter = lookupParams(parsed);
  let order: string[] | null = null;

  if (!filter) {
    order = await searchChannelIds(ytFetch, parsed.value, CHANNEL_SEARCH_LIMIT);
    if (order.length === 0) return [];
    // search.list's own snippets have no handle or counts; one channels.list
    // (1 unit) gets them for every result.
    filter = { id: order.join(",") };
  }

  const raw = await ytFetch("channels", { part: "snippet,statistics", ...filter });
  const items = channelDetailsSchema.parse(raw).items;
  const rank = (id: string) => (order ? order.indexOf(id) : 0);
  return items
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((item) => {
      const stats = item.statistics;
      const handle = item.snippet.customUrl ?? null;
      return {
        youtubeChannelId: item.id,
        title: item.snippet.title,
        handle: handle && !handle.startsWith("@") ? `@${handle}` : handle,
        description: item.snippet.description?.trim() || null,
        thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? null,
        subscriberCount:
          stats?.subscriberCount != null && !stats.hiddenSubscriberCount ? Number(stats.subscriberCount) : null,
        videoCount: stats?.videoCount != null ? Number(stats.videoCount) : null,
      };
    });
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
