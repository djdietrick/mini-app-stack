import { useCallback, useEffect, useRef, useState } from "react";
import { api, type RunInput } from "../api";

/** Pieces every practice screen shares: a ticking clock, and saving the run. */

/** performance.now(), re-rendering every `every` ms while `active`. */
export function useNow(active: boolean, every = 200): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    setNow(performance.now());
    const id = window.setInterval(() => setNow(performance.now()), every);
    return () => window.clearInterval(id);
  }, [active, every]);
  return now;
}

/** The wall-clock time of a performance.now() timestamp, for `startedAt`. */
export function wallClock(perfAt: number): string {
  return new Date(Date.now() - (performance.now() - perfAt)).toISOString();
}

/** "4.2 s" under a minute, "1:05" above. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const whole = Math.floor(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * POSTs a finished run once. Pass null until the run ends; each new run
 * object is saved exactly once, and `retry` re-sends one that failed.
 */
export function useSaveRun(run: RunInput | null): { status: SaveStatus; retry: () => void } {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const sent = useRef<RunInput | null>(null);

  const send = useCallback((r: RunInput) => {
    sent.current = r;
    setStatus("saving");
    api.recordRun(r).then(
      () => sent.current === r && setStatus("saved"),
      () => sent.current === r && setStatus("error"),
    );
  }, []);

  useEffect(() => {
    if (!run) {
      sent.current = null;
      setStatus("idle");
    } else if (sent.current !== run) {
      send(run);
    }
  }, [run, send]);

  return { status, retry: () => run && send(run) };
}
