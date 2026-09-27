import cron from "node-cron";
import type { Lease } from "@stack/service-kit";
import { type DigestMailer, type DigestOptions, runDailyDigest } from "./domain/digest.js";
import { pollChannels } from "./domain/poll.js";
import type { YouTubeGateway } from "./domain/youtube.js";
import type { YtdigestRepo } from "./repo/types.js";

/**
 * Self-hosted scheduling: an in-process timer for the poll and node-cron for
 * the daily send. The cloud runs the same two functions from Cloud Scheduler
 * instead (functions/src/index.ts), so only the trigger differs.
 */
export interface SchedulerDeps {
  repo: YtdigestRepo;
  youtube: YouTubeGateway;
  mailer: DigestMailer;
  lease: Lease;
  pollIntervalMinutes: number;
  digestSendCron: string;
  digest: DigestOptions;
}

export function startSchedulers(deps: SchedulerDeps): void {
  const runPoll = () => {
    pollChannels(deps).catch((err) => console.error("[poll] failed:", err));
  };
  runPoll();
  setInterval(runPoll, deps.pollIntervalMinutes * 60_000);

  cron.schedule(
    deps.digestSendCron,
    () => {
      runDailyDigest(deps.repo, deps.mailer, new Date(), deps.digest).catch((err) =>
        console.error("[digest] failed:", err),
      );
    },
    deps.digest.timeZone ? { timezone: deps.digest.timeZone } : undefined,
  );
}
