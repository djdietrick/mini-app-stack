import { useEffect } from "react";

/**
 * Keeps the screen on while a practice screen, a session or the tuner is
 * open: the phone sits on a music stand with both hands on the guitar, and a
 * screen that dims mid-exercise also stops the mic on iOS.
 *
 * One lock for the whole app, held while any screen asks for it. The browser
 * drops the lock whenever the page is hidden, so it is requested again when
 * the page comes back. Where the Screen Wake Lock API is missing (Safari
 * before 16.4, insecure origins) or refuses (low battery), nothing happens:
 * the screen dims as it always did.
 */

let holders = 0;
let sentinel: WakeLockSentinel | null = null;
let requesting = false;

function supported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator && window.isSecureContext;
}

async function acquire(): Promise<void> {
  if (!supported() || sentinel || requesting || holders === 0 || document.visibilityState !== "visible") return;
  requesting = true;
  try {
    const s = await navigator.wakeLock.request("screen");
    // Every screen let go while the request was in flight.
    if (holders === 0) {
      void s.release();
      return;
    }
    sentinel = s;
    s.addEventListener("release", () => {
      if (sentinel === s) sentinel = null;
    });
  } catch {
    // Refused (battery saver, no user activation yet, a hidden page): carry on without.
  } finally {
    requesting = false;
  }
}

function release(): void {
  const s = sentinel;
  sentinel = null;
  void s?.release().catch(() => undefined);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void acquire();
  });
  // Some browsers refuse a lock without a user gesture; the next tap tries again.
  document.addEventListener("pointerdown", () => void acquire(), { passive: true });
}

/** Holds the screen awake while `active` and the component is mounted. */
export function useWakeLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    holders++;
    void acquire();
    return () => {
      holders--;
      if (holders === 0) release();
    };
  }, [active]);
}
