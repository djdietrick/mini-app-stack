import type postgres from "postgres";
import type { RedisClient } from "@stack/db-clients";
import { listNewUploads, batchGetVideoStats } from "../youtube/client.js";

const LOCK_KEY = "ytdigest:poll:lock";
const LOCK_TTL_MS = 10 * 60 * 1000;

/** Bounds how many of a channel's most recent videos get a fresh stats snapshot
 * each poll — enough margin over the baseline sample size without letting
 * snapshot volume/quota grow unbounded for prolific channels. */
const MAX_TRACKED_VIDEOS_PER_CHANNEL = 50;

interface ChannelRow {
  id: string;
  uploads_playlist_id: string;
}

/** Fetches new uploads and refreshes stats snapshots for every subscribed channel. */
export async function pollChannels(sql: postgres.Sql, redis: RedisClient): Promise<void> {
  const acquired = await redis.set(LOCK_KEY, "1", "PX", LOCK_TTL_MS, "NX");
  if (!acquired) {
    console.log("[poll] skipped: already in progress");
    return;
  }

  try {
    const channels = await sql<ChannelRow[]>`
      SELECT DISTINCT c.id, c.uploads_playlist_id
      FROM channels c
      JOIN subscriptions s ON s.channel_id = c.id
    `;

    for (const channel of channels) {
      try {
        await pollChannel(sql, channel);
      } catch (err) {
        console.error(`[poll] failed for channel ${channel.id}:`, err);
      }
    }
  } finally {
    await redis.del(LOCK_KEY);
  }
}

async function pollChannel(sql: postgres.Sql, channel: ChannelRow): Promise<void> {
  const [latest] = await sql<{ youtube_video_id: string }[]>`
    SELECT youtube_video_id FROM videos
    WHERE channel_id = ${channel.id}
    ORDER BY published_at DESC
    LIMIT 1
  `;

  const newUploads = await listNewUploads(channel.uploads_playlist_id, latest?.youtube_video_id);

  for (const upload of newUploads) {
    await sql`
      INSERT INTO videos (channel_id, youtube_video_id, title, description, published_at, thumbnail_url)
      VALUES (${channel.id}, ${upload.youtubeVideoId}, ${upload.title}, ${upload.description},
              ${upload.publishedAt}, ${upload.thumbnailUrl})
      ON CONFLICT (youtube_video_id) DO NOTHING
    `;
  }

  const tracked = await sql<{ id: string; youtube_video_id: string }[]>`
    SELECT id, youtube_video_id FROM videos
    WHERE channel_id = ${channel.id}
    ORDER BY published_at DESC
    LIMIT ${MAX_TRACKED_VIDEOS_PER_CHANNEL}
  `;

  const stats = await batchGetVideoStats(tracked.map((v) => v.youtube_video_id));
  const statsByVideoId = new Map(stats.map((s) => [s.youtubeVideoId, s]));

  for (const video of tracked) {
    const s = statsByVideoId.get(video.youtube_video_id);
    if (!s) continue;
    await sql`
      UPDATE videos SET duration_seconds = ${s.durationSeconds}
      WHERE id = ${video.id} AND duration_seconds IS NULL
    `;
    await sql`
      INSERT INTO video_stats_snapshots (video_id, view_count, like_count, comment_count)
      VALUES (${video.id}, ${s.viewCount}, ${s.likeCount}, ${s.commentCount})
    `;
  }

  await sql`UPDATE channels SET last_polled_at = now() WHERE id = ${channel.id}`;
}
