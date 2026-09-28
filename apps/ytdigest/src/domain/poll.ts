import type { Lease, Logger } from "@stack/service-kit";
import type { YtdigestRepo } from "../repo/types.js";
import type { PollTarget } from "./types.js";
import type { YouTubeGateway } from "./youtube.js";

const LEASE_NAME = "ytdigest:poll:lock";
const LEASE_TTL_MS = 10 * 60 * 1000;

/** Bounds how many of a channel's most recent videos get a fresh stats snapshot
 * each poll — enough margin over the baseline sample size without letting
 * snapshot volume/quota grow unbounded for prolific channels. */
const MAX_TRACKED_VIDEOS_PER_CHANNEL = 50;

export interface PollDeps {
  repo: YtdigestRepo;
  youtube: YouTubeGateway;
  /** Redis self-hosted, Firestore in the cloud. Keeps two polls from overlapping. */
  lease: Lease;
  log?: Logger;
}

/**
 * Fetches new uploads and refreshes stats snapshots for every subscribed
 * channel. Run on a timer self-hosted and by a scheduled function in the cloud.
 */
export async function pollChannels({ repo, youtube, lease, log = console }: PollDeps): Promise<void> {
  if (!(await lease.acquire(LEASE_NAME, LEASE_TTL_MS))) {
    log.info("[poll] skipped: already in progress");
    return;
  }

  try {
    for (const channel of await repo.channelsToPoll()) {
      try {
        await pollChannel(repo, youtube, channel);
      } catch (err) {
        log.error(`[poll] failed for channel ${channel.id}:`, err);
      }
    }
  } finally {
    await lease.release(LEASE_NAME);
  }
}

async function pollChannel(
  repo: YtdigestRepo,
  youtube: YouTubeGateway,
  channel: PollTarget,
): Promise<void> {
  const latest = await repo.latestVideoId(channel.id);
  const newUploads = await youtube.listNewUploads(channel.uploadsPlaylistId, latest ?? undefined);
  await repo.insertVideos(channel.id, newUploads);

  const tracked = await repo.trackedVideos(channel.id, MAX_TRACKED_VIDEOS_PER_CHANNEL);
  const stats = await youtube.batchGetVideoStats(tracked.map((v) => v.youtubeVideoId));
  const statsByVideoId = new Map(stats.map((s) => [s.youtubeVideoId, s]));

  for (const video of tracked) {
    const s = statsByVideoId.get(video.youtubeVideoId);
    if (s) await repo.recordStats(video, s);
  }

  await repo.markPolled(channel.id);
}
