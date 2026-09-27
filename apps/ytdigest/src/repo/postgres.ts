import type { PostgresClient } from "@stack/db-clients";
import type { RuleGroup } from "../domain/rules/types.js";
import type {
  Cadence,
  ChannelRow,
  DigestDetail,
  DigestItemRow,
  DigestRunRow,
  NotifyMode,
  RuleRow,
  SubscriptionRow,
} from "../domain/types.js";
import type { YtdigestRepo } from "./types.js";

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === "23505";

/**
 * Timestamps come back from this client as strings, not Dates: Drizzle, which
 * createPostgresClient wraps the connection in, replaces postgres.js's date
 * parsers and serializers. The job code does arithmetic on them, so convert
 * on the way out and send ISO strings on the way in. Before this layer
 * existed, the rule baseline called .getTime() on those strings.
 */
const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));
const toDateOrNull = (v: string | Date | null) => (v == null ? null : toDate(v));

/**
 * Self-hosted implementation. The SQL is lifted from the pre-refactor route,
 * poll and digest modules; unqualified table names resolve into the
 * `ytdigest` schema via search_path.
 */
export function createPostgresYtdigestRepo(pg: PostgresClient): YtdigestRepo {
  const { sql } = pg;

  /** Folds optional SET fragments into one clause, as the original handlers did. */
  const joinSet = (updates: ReturnType<typeof sql>[]) => {
    let setClause = updates[0];
    for (let i = 1; i < updates.length; i++) setClause = sql`${setClause}, ${updates[i]}`;
    return setClause;
  };

  return {
    // ---------- channels ----------

    async listChannels(userId) {
      return sql<ChannelRow[]>`
        SELECT c.id, c.youtube_channel_id, c.title, c.thumbnail_url, c.last_polled_at,
               s.id AS subscription_id
        FROM channels c
        LEFT JOIN subscriptions s ON s.channel_id = c.id AND s.user_id = ${userId}
        ORDER BY c.title ASC
      `;
    },

    async upsertChannel(resolved) {
      const [channel] = await sql<{ id: string }[]>`
        INSERT INTO channels (youtube_channel_id, title, thumbnail_url, uploads_playlist_id)
        VALUES (${resolved.youtubeChannelId}, ${resolved.title}, ${resolved.thumbnailUrl}, ${resolved.uploadsPlaylistId})
        ON CONFLICT (youtube_channel_id) DO UPDATE SET title = EXCLUDED.title, thumbnail_url = EXCLUDED.thumbnail_url
        RETURNING id
      `;
      return channel.id;
    },

    // ---------- subscriptions ----------

    async listSubscriptions(userId) {
      return sql<SubscriptionRow[]>`
        SELECT s.id, s.channel_id, c.title AS channel_title, c.thumbnail_url,
               s.cadence, s.digest_day_of_week, s.notify_mode, s.last_digested_at, s.created_at
        FROM subscriptions s
        JOIN channels c ON c.id = s.channel_id
        WHERE s.user_id = ${userId}
        ORDER BY c.title ASC
      `;
    },

    async createSubscription(userId, channelId, cadence, digestDayOfWeek, notifyMode) {
      try {
        const [sub] = await sql<{ id: string }[]>`
          INSERT INTO subscriptions (user_id, channel_id, cadence, digest_day_of_week, notify_mode)
          VALUES (${userId}, ${channelId}, ${cadence}, ${digestDayOfWeek}, ${notifyMode})
          RETURNING id
        `;
        return sub.id;
      } catch (e) {
        if (isUniqueViolation(e)) return null;
        throw e;
      }
    },

    async subscriptionExists(userId, id) {
      const [row] = await sql`
        SELECT 1 FROM subscriptions WHERE id = ${id} AND user_id = ${userId}
      `;
      return Boolean(row);
    },

    async updateSubscription(userId, id, a) {
      const updates: ReturnType<typeof sql>[] = [];
      if (a.cadence !== undefined) updates.push(sql`cadence = ${a.cadence}`);
      if (a.digestDayOfWeek !== undefined) updates.push(sql`digest_day_of_week = ${a.digestDayOfWeek}`);
      if (a.notifyMode !== undefined) updates.push(sql`notify_mode = ${a.notifyMode}`);

      const rows = await sql`
        UPDATE subscriptions SET ${joinSet(updates)}
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    async deleteSubscription(userId, id) {
      // ON DELETE CASCADE takes its rules and digest_items with it.
      const rows = await sql`
        DELETE FROM subscriptions WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    // ---------- rules ----------

    async listRules(userId) {
      return sql<RuleRow[]>`
        SELECT id, scope, subscription_id, name, rule_json, enabled, created_at
        FROM criteria_rules
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
    },

    async createRule(userId, a) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO criteria_rules (user_id, scope, subscription_id, name, rule_json, enabled)
        VALUES (${userId}, ${a.scope}, ${a.subscriptionId ?? null}, ${a.name},
                ${JSON.stringify(a.ruleJson)}, ${a.enabled})
        RETURNING id
      `;
      return row.id;
    },

    async updateRule(userId, id, a) {
      const updates: ReturnType<typeof sql>[] = [];
      if (a.name !== undefined) updates.push(sql`name = ${a.name}`);
      if (a.ruleJson !== undefined) updates.push(sql`rule_json = ${JSON.stringify(a.ruleJson)}`);
      if (a.enabled !== undefined) updates.push(sql`enabled = ${a.enabled}`);

      const rows = await sql`
        UPDATE criteria_rules SET ${joinSet(updates)}
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    async deleteRule(userId, id) {
      const rows = await sql`
        DELETE FROM criteria_rules WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    // ---------- digests (HTTP) ----------

    async listDigests(userId) {
      return sql<DigestRunRow[]>`
        SELECT r.id, r.cadence, r.run_date, r.sent_at,
               (SELECT COUNT(*)::int FROM digest_items di WHERE di.digest_run_id = r.id) AS item_count
        FROM digest_runs r
        WHERE r.user_id = ${userId}
        ORDER BY r.run_date DESC, r.created_at DESC
        LIMIT 50
      `;
    },

    async getDigest(userId, id) {
      const [run] = await sql<Omit<DigestDetail, "items">[]>`
        SELECT id, cadence, run_date, sent_at FROM digest_runs
        WHERE id = ${id} AND user_id = ${userId}
      `;
      if (!run) return null;
      // youtube_video_id is new: video_id is this table's UUID, so the SPA's
      // watch links built from it never opened a video.
      const items = await sql<DigestItemRow[]>`
        SELECT di.video_id, v.youtube_video_id, v.title, v.thumbnail_url, c.title AS channel_title, di.matched_rule_id, di.reason_json
        FROM digest_items di
        JOIN videos v ON v.id = di.video_id
        JOIN channels c ON c.id = v.channel_id
        WHERE di.digest_run_id = ${run.id}
        ORDER BY c.title ASC
      `;
      return { ...run, items };
    },

    // ---------- poll job ----------

    async channelsToPoll() {
      const rows = await sql<{ id: string; uploads_playlist_id: string }[]>`
        SELECT DISTINCT c.id, c.uploads_playlist_id
        FROM channels c
        JOIN subscriptions s ON s.channel_id = c.id
      `;
      return rows.map((r) => ({ id: r.id, uploadsPlaylistId: r.uploads_playlist_id }));
    },

    async latestVideoId(channelId) {
      const [latest] = await sql<{ youtube_video_id: string }[]>`
        SELECT youtube_video_id FROM videos
        WHERE channel_id = ${channelId}
        ORDER BY published_at DESC
        LIMIT 1
      `;
      return latest?.youtube_video_id ?? null;
    },

    async insertVideos(channelId, uploads) {
      for (const upload of uploads) {
        await sql`
          INSERT INTO videos (channel_id, youtube_video_id, title, description, published_at, thumbnail_url)
          VALUES (${channelId}, ${upload.youtubeVideoId}, ${upload.title}, ${upload.description},
                  ${upload.publishedAt}, ${upload.thumbnailUrl})
          ON CONFLICT (youtube_video_id) DO NOTHING
        `;
      }
    },

    async trackedVideos(channelId, limit) {
      const rows = await sql<{ id: string; youtube_video_id: string }[]>`
        SELECT id, youtube_video_id FROM videos
        WHERE channel_id = ${channelId}
        ORDER BY published_at DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ id: r.id, youtubeVideoId: r.youtube_video_id }));
    },

    async recordStats(video, s) {
      await sql`
        UPDATE videos SET duration_seconds = ${s.durationSeconds}
        WHERE id = ${video.id} AND duration_seconds IS NULL
      `;
      await sql`
        INSERT INTO video_stats_snapshots (video_id, view_count, like_count, comment_count)
        VALUES (${video.id}, ${s.viewCount}, ${s.likeCount}, ${s.commentCount})
      `;
    },

    async markPolled(channelId) {
      await sql`UPDATE channels SET last_polled_at = now() WHERE id = ${channelId}`;
    },

    // ---------- digest job ----------

    async digestRecipients() {
      const rows = await sql<{ user_id: string; email: string }[]>`
        SELECT DISTINCT s.user_id, u.email
        FROM subscriptions s
        JOIN shared.users u ON u.id = s.user_id
      `;
      return rows.map((r) => ({ userId: r.user_id, email: r.email }));
    },

    async dueSubscriptions(userId, dayOfWeek, force) {
      const rows = await sql<
        {
          id: string;
          channel_id: string;
          channel_title: string;
          cadence: Cadence;
          notify_mode: NotifyMode;
          last_digested_at: string | null;
        }[]
      >`
        SELECT s.id, s.channel_id, c.title AS channel_title, s.cadence, s.notify_mode, s.last_digested_at
        FROM subscriptions s
        JOIN channels c ON c.id = s.channel_id
        WHERE s.user_id = ${userId}
          AND (${force} OR s.cadence = 'daily' OR (s.cadence = 'weekly' AND s.digest_day_of_week = ${dayOfWeek}))
      `;
      return rows.map((r) => ({
        id: r.id,
        channelId: r.channel_id,
        channelTitle: r.channel_title,
        cadence: r.cadence,
        notifyMode: r.notify_mode,
        lastDigestedAt: toDateOrNull(r.last_digested_at),
      }));
    },

    async candidateVideos(userId, sub) {
      const since = (sub.lastDigestedAt ?? new Date(0)).toISOString();
      const rows = await sql<
        {
          id: string;
          youtube_video_id: string;
          title: string;
          description: string | null;
          published_at: string;
          duration_seconds: number | null;
          thumbnail_url: string | null;
        }[]
      >`
        SELECT v.id, v.youtube_video_id, v.title, v.description, v.published_at, v.duration_seconds, v.thumbnail_url
        FROM videos v
        WHERE v.channel_id = ${sub.channelId}
          AND v.first_seen_at > ${since}
          AND NOT EXISTS (
            SELECT 1 FROM notified_videos nv WHERE nv.user_id = ${userId} AND nv.video_id = v.id
          )
        ORDER BY v.published_at ASC
      `;
      return rows.map((r) => ({
        id: r.id,
        youtubeVideoId: r.youtube_video_id,
        title: r.title,
        description: r.description,
        publishedAt: toDate(r.published_at),
        durationSeconds: r.duration_seconds,
        thumbnailUrl: r.thumbnail_url,
      }));
    },

    async enabledRules(userId, subscriptionId) {
      const rows = await sql<{ id: string; rule_json: RuleGroup }[]>`
        SELECT id, rule_json FROM criteria_rules
        WHERE enabled = true
          AND user_id = ${userId}
          AND ((scope = 'subscription' AND subscription_id = ${subscriptionId}) OR scope = 'global')
      `;
      return rows.map((r) => ({ id: r.id, rule: r.rule_json }));
    },

    async latestSnapshot(videoId) {
      const [s] = await sql<{ view_count: string | number; like_count: string | number | null; captured_at: string }[]>`
        SELECT view_count, like_count, captured_at FROM video_stats_snapshots
        WHERE video_id = ${videoId}
        ORDER BY captured_at DESC
        LIMIT 1
      `;
      return s
        ? {
            viewCount: Number(s.view_count),
            likeCount: s.like_count == null ? null : Number(s.like_count),
            capturedAt: toDate(s.captured_at),
          }
        : null;
    },

    async pastVideos(channelId, excludeVideoId, limit) {
      const rows = await sql<{ id: string; published_at: string }[]>`
        SELECT id, published_at FROM videos
        WHERE channel_id = ${channelId} AND id != ${excludeVideoId}
        ORDER BY published_at DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ id: r.id, publishedAt: toDate(r.published_at) }));
    },

    async snapshotAtOrBefore(videoId, cutoff) {
      const [s] = await sql<{ view_count: string | number; like_count: string | number | null; captured_at: string }[]>`
        SELECT view_count, like_count, captured_at FROM video_stats_snapshots
        WHERE video_id = ${videoId} AND captured_at <= ${cutoff.toISOString()}
        ORDER BY captured_at DESC
        LIMIT 1
      `;
      return s
        ? {
            viewCount: Number(s.view_count),
            likeCount: s.like_count == null ? null : Number(s.like_count),
            capturedAt: toDate(s.captured_at),
          }
        : null;
    },

    async markDigested(subscriptionIds, runDate) {
      for (const id of subscriptionIds) {
        await sql`UPDATE subscriptions SET last_digested_at = ${runDate.toISOString()} WHERE id = ${id}`;
      }
    },

    async recordDigest(userId, cadence, runDate, lines) {
      await sql.begin(async (tx) => {
        const [run] = await tx<{ id: string }[]>`
          INSERT INTO digest_runs (user_id, cadence, run_date, sent_at)
          VALUES (${userId}, ${cadence}, ${runDate}, now())
          RETURNING id
        `;
        for (const line of lines) {
          await tx`
            INSERT INTO digest_items (digest_run_id, video_id, subscription_id, matched_rule_id, reason_json)
            VALUES (${run.id}, ${line.videoId}, ${line.subscriptionId}, ${line.matchedRuleId}, ${JSON.stringify(line.reasons)})
            ON CONFLICT (digest_run_id, video_id) DO NOTHING
          `;
          await tx`
            INSERT INTO notified_videos (user_id, video_id)
            VALUES (${userId}, ${line.videoId})
            ON CONFLICT (user_id, video_id) DO NOTHING
          `;
        }
      });
    },

    async close() {
      await pg.close();
    },
  };
}
