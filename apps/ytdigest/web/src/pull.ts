/**
 * Pull-to-refresh geometry, kept pure so it is node-tested. The gesture
 * itself (touch listeners, the indicator) is `components/PullToRefresh.tsx`.
 */

/** Finger travel ignored before a pull counts, so taps and jitter don't. */
export const PULL_DEAD_ZONE = 8;
/** How far the indicator has to come down before letting go refreshes. */
export const PULL_THRESHOLD = 64;
/** The indicator stops here however far the finger goes. */
export const PULL_MAX = 96;
/** The indicator moves at half the finger's speed, like a rubber band. */
const RESISTANCE = 0.5;

/**
 * How far the indicator is pulled down for a finger that has moved (dx, dy)
 * since touching the top of the page. 0 when it is not a downward pull: inside
 * the dead zone, upward, or more sideways than down (a horizontal swipe).
 */
export function pullOffset(dx: number, dy: number): number {
  if (dy <= PULL_DEAD_ZONE || Math.abs(dx) > dy) return 0;
  return Math.min(PULL_MAX, (dy - PULL_DEAD_ZONE) * RESISTANCE);
}

/** Whether letting go at this offset refreshes. */
export function pullReleases(offset: number): boolean {
  return offset >= PULL_THRESHOLD;
}
