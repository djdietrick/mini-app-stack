import { useSyncExternalStore } from "react";
import { A4_HZ } from "../../src/theory/index.js";

/**
 * Per-device preferences, kept in localStorage. They describe this player on
 * this phone (which hand they fret with, where their A is), so they don't go
 * to the server. Anything read here must tolerate storage being unavailable
 * (private windows) and old or hand-edited values.
 */

export type LabelMode = "names" | "degrees" | "none";

export interface Settings {
  /** Mirror the neck: nut on the right, or low E on the right when vertical. */
  leftHanded: boolean;
  /** What the dots on the neck say. "none" is for memorising. */
  labels: LabelMode;
  /** Reference pitch for A4, Hz. */
  a4: number;
  /** Microphone gate: RMS a note must reach before it counts. */
  gate: number;
}

export const DEFAULT_SETTINGS: Settings = { leftHanded: false, labels: "names", a4: A4_HZ, gate: 0.01 };

export const A4_RANGE = { min: 415, max: 466 } as const;
export const GATE_RANGE = { min: 0.002, max: 0.08 } as const;

const KEY = "fretwork:settings";
const listeners = new Set<() => void>();
let current = load();

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function load(): Settings {
  let raw: Partial<Settings> = {};
  try {
    raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    // Unavailable or corrupt storage: defaults.
  }
  return {
    leftHanded: raw.leftHanded === true,
    labels: raw.labels === "degrees" || raw.labels === "none" ? raw.labels : "names",
    a4: clamp(raw.a4, A4_RANGE.min, A4_RANGE.max, DEFAULT_SETTINGS.a4),
    gate: clamp(raw.gate, GATE_RANGE.min, GATE_RANGE.max, DEFAULT_SETTINGS.gate),
  };
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Still applies for this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another tab changed them.
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  current = load();
  listeners.forEach((l) => l());
});

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
