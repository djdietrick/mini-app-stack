import type { Lease } from "@stack/service-kit";
import { pollChannels } from "./domain/poll.js";
import type { YouTubeGateway } from "./domain/youtube.js";
import type { YtdigestRepo } from "./repo/types.js";

/**
 * Self-hosted scheduling: an in-process timer for the poll. The cloud runs
 * the same function from Cloud Scheduler instead (functions/src/index.ts), so
 * only the trigger differs.
 */
export interface SchedulerDeps {
  repo: YtdigestRepo;
  youtube: YouTubeGateway;
  lease: Lease;
  pollIntervalMinutes: number;
}

export function startSchedulers(deps: SchedulerDeps): void {
  const runPoll = () => {
    pollChannels(deps).catch((err) => console.error("[poll] failed:", err));
  };
  runPoll();
  setInterval(runPoll, deps.pollIntervalMinutes * 60_000);
}
