import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";
import { PULL_THRESHOLD, pullOffset, pullReleases } from "../pull";

/**
 * Pull down from the top of the page to refresh, for phones. Listens on the
 * window, so it works with the page's own scroll, and only while `target` is
 * on screen (the feed stays mounted, hidden, under the player). Renders the
 * indicator; the geometry is `pull.ts`.
 */
export function PullToRefresh({
  target,
  refreshing,
  onRefresh,
}: {
  target: RefObject<HTMLElement>;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [offset, setOffset] = useState(0);
  // True from a pull that refreshed until that refresh ends, so the spinner
  // stays up for it but not for a refresh started by the button.
  const [held, setHeld] = useState(false);
  const live = useRef({ onRefresh, refreshing });
  live.current = { onRefresh, refreshing };

  useEffect(() => {
    if (!refreshing) setHeld(false);
  }, [refreshing]);

  useEffect(() => {
    // Stop the browser's own pull-to-reload so the two don't both fire.
    const root = document.documentElement;
    const before = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "contain";

    let start: { x: number; y: number } | null = null;
    let current = 0;
    const set = (v: number) => {
      current = v;
      setOffset(v);
    };

    const onStart = (e: TouchEvent) => {
      const el = target.current;
      const visible = el != null && el.offsetParent !== null;
      start =
        e.touches.length === 1 && visible && window.scrollY <= 0 && !live.current.refreshing
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
          : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) {
        start = null;
        set(0);
        return;
      }
      set(pullOffset(e.touches[0].clientX - start.x, e.touches[0].clientY - start.y));
    };
    const onEnd = () => {
      if (start && pullReleases(current)) {
        setHeld(true);
        live.current.onRefresh();
      }
      start = null;
      set(0);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      root.style.overscrollBehaviorY = before;
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [target]);

  const spinning = held && refreshing;
  const shown = spinning ? PULL_THRESHOLD * 0.75 : offset;
  if (shown <= 0) return null;
  const ready = pullReleases(offset);
  return (
    <div
      className="pointer-events-none fixed left-1/2 top-0 z-20"
      style={{ transform: `translate(-50%, ${shown - 40}px)`, opacity: spinning ? 1 : Math.min(1, offset / PULL_THRESHOLD) }}
      role="status"
      aria-label={spinning ? "Refreshing" : ready ? "Release to refresh" : "Pull to refresh"}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-canvas-200 bg-surface text-brand-600 shadow">
        <RefreshIcon
          className={`h-5 w-5 ${spinning ? "animate-spin" : "transition-transform"}`}
          style={spinning ? undefined : { transform: `rotate(${(offset / PULL_THRESHOLD) * 270}deg)` }}
        />
      </div>
    </div>
  );
}

export function RefreshIcon({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
