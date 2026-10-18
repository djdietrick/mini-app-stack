import { useSyncExternalStore } from "react";

/**
 * Per-device settings, kept in localStorage. Every read and write is guarded:
 * private browsing and a full quota fall back to the defaults instead of
 * breaking the table.
 */
export interface Settings {
  /** Off by default: a phone at a table is often somewhere quiet. */
  sound: boolean;
  /** 0 to 1, for every sound effect. */
  volume: number;
  /** A short buzz on wins and on your turn, where the device can. */
  haptics: boolean;
  /** "fast" halves every deal and payout animation. */
  speed: "normal" | "fast";
  /** "system" follows prefers-reduced-motion; "on" always snaps animations. */
  reducedMotion: "system" | "on" | "off";
  /**
   * For low-end phones and long sessions: tables render at one device pixel
   * per CSS pixel, at most 30 frames a second, without antialiasing, and
   * celebrations drop their particles.
   */
  batterySaver: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: false,
  volume: 0.6,
  haptics: true,
  speed: "normal",
  reducedMotion: "system",
  batterySaver: false,
};

const KEY = "highroller:settings";
const listeners = new Set<() => void>();
let current: Settings = load();

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      sound: typeof parsed.sound === "boolean" ? parsed.sound : DEFAULT_SETTINGS.sound,
      volume:
        typeof parsed.volume === "number" && parsed.volume >= 0 && parsed.volume <= 1 ? parsed.volume : DEFAULT_SETTINGS.volume,
      haptics: typeof parsed.haptics === "boolean" ? parsed.haptics : DEFAULT_SETTINGS.haptics,
      speed: parsed.speed === "fast" ? "fast" : "normal",
      reducedMotion: parsed.reducedMotion === "on" || parsed.reducedMotion === "off" ? parsed.reducedMotion : "system",
      batterySaver: parsed.batterySaver === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not persisted; still applies for this visit.
  }
  for (const l of listeners) l();
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSettings,
  );
}

/** Whether animations should snap to their end: the setting, or the system's preference. */
export function reducedMotion(s: Settings = current): boolean {
  if (s.reducedMotion !== "system") return s.reducedMotion === "on";
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Multiplier for animation durations: 0 snaps, 0.5 is "fast". */
export function motionScale(s: Settings = current): number {
  if (reducedMotion(s)) return 0;
  return s.speed === "fast" ? 0.5 : 1;
}

/** A short vibration when haptics are on and the device has them (not iOS Safari). */
export function buzz(pattern: number | number[] = 15): void {
  if (!current.haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw when called without a user gesture.
  }
}
