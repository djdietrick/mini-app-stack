import { useSyncExternalStore } from "react";
import { api, type WatchProgress } from "./api";

/**
 * Where you left off in each video. The server keeps it (so it follows you
 * between devices); this module holds what the player has reported since the
 * page loaded, so the feed underneath the player shows it without a refetch,
 * and decides where to resume.
 */

/** Short of this, there is nothing worth resuming. */
const MIN_RESUME_SECONDS = 10;
/** Rewind a little on resume, to pick the thread back up. */
const REWIND_SECONDS = 3;

/** Within the credits counts as watched, so it starts again from the top. */
export function isFinished(p: WatchProgress): boolean {
  return p.duration_seconds - p.position_seconds <= 20 || p.position_seconds / p.duration_seconds >= 0.95;
}

/** The second to start playing from: 0 for new, barely started or finished. */
export function resumeFrom(p: WatchProgress | null): number {
  if (!p || p.position_seconds < MIN_RESUME_SECONDS || isFinished(p)) return 0;
  return Math.max(0, Math.floor(p.position_seconds - REWIND_SECONDS));
}

/** The more recent of two records of the same video. */
export function latest(a: WatchProgress | null, b: WatchProgress | null): WatchProgress | null {
  if (!a || !b) return a ?? b;
  return Date.parse(a.updated_at) >= Date.parse(b.updated_at) ? a : b;
}

const local = new Map<string, WatchProgress>();
const listeners = new Set<() => void>();

/** Records a position the player reported, here and on the server. */
export function recordProgress(youtubeVideoId: string, position: number, duration: number): void {
  if (!(duration > 0)) return;
  const positionSeconds = Math.min(duration, Math.max(0, Math.round(position)));
  const durationSeconds = Math.max(1, Math.round(duration));
  const prev = local.get(youtubeVideoId);
  if (prev && prev.position_seconds === positionSeconds && prev.duration_seconds === durationSeconds) return;
  local.set(youtubeVideoId, {
    position_seconds: positionSeconds,
    duration_seconds: durationSeconds,
    updated_at: new Date().toISOString(),
  });
  listeners.forEach((l) => l());
  // Best effort: the next report carries the position anyway.
  api.saveProgress(youtubeVideoId, positionSeconds, durationSeconds).catch(() => undefined);
}

/** What the player reported for this video since the page loaded, if anything. */
export function useLocalProgress(youtubeVideoId: string): WatchProgress | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => local.get(youtubeVideoId) ?? null,
  );
}

export function localProgress(youtubeVideoId: string): WatchProgress | null {
  return local.get(youtubeVideoId) ?? null;
}
