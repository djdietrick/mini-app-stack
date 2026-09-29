/**
 * The app's one AudioContext, shared by the mic (noteStream.ts) and
 * everything that makes sound (output.ts). One context means one audio
 * clock, one sample rate and one thing for iOS to unlock.
 *
 * iOS Safari only starts audio inside a user gesture, so `unlockAudio` must
 * be called from a tap handler, before any await. The context is never
 * closed: the mic stops its own tracks when it is released, and a suspended
 * context costs nothing.
 */

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

export function audioContextCtor(): AudioContextCtor | undefined {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
}

/** Creates the context on first use and resumes it. Call it from a tap. Null where Web Audio is missing. */
export function unlockAudio(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  if (!ctx || ctx.state === "closed") ctx = new Ctor({ latencyHint: "interactive" });
  if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** The context if something has already unlocked it. Never creates one. */
export function currentAudio(): AudioContext | null {
  return ctx;
}

/** Whether sound can play now without a tap first. */
export function audioRunning(): boolean {
  return ctx?.state === "running";
}

/**
 * Safari's Audio Session API (iOS 17+): "playback" lets tones sound with the
 * ring/silent switch on; "play-and-record" is what the mic needs. Elsewhere
 * this is a no-op.
 */
export function setAudioSession(kind: "playback" | "play-and-record"): void {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (!session) return;
  try {
    session.type = kind;
  } catch {
    // Unsupported value on this version: keep the default.
  }
}

// iOS suspends the context when the page is hidden; pick it back up on return.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && ctx && ctx.state !== "running" && ctx.state !== "closed") {
    void ctx.resume().catch(() => undefined);
  }
});
