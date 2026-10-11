import { useSyncExternalStore } from "react";
import { cToF, fToC } from "../../src/fermentation/index.js";

/**
 * Per-device preferences, kept in localStorage: how this baker likes numbers
 * shown. The API is always °F; conversion happens only at the edges of the
 * UI. Anything read here must tolerate storage being unavailable.
 */

export type TempUnit = "F" | "C";

export interface Prefs {
  tempUnit: TempUnit;
  /** The last kitchen temperature entered, °F, as the default for the next. */
  kitchenF: number;
}

const DEFAULT_PREFS: Prefs = { tempUnit: "F", kitchenF: 72 };

const KEY = "crumb:prefs";
const listeners = new Set<() => void>();
let current = load();

function load(): Prefs {
  let raw: Partial<Prefs> = {};
  try {
    raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    // Unavailable or corrupt storage: defaults.
  }
  return {
    tempUnit: raw.tempUnit === "C" ? "C" : "F",
    kitchenF:
      typeof raw.kitchenF === "number" && raw.kitchenF >= 40 && raw.kitchenF <= 100 ? raw.kitchenF : DEFAULT_PREFS.kitchenF,
  };
}

export function getPrefs(): Prefs {
  return current;
}

export function updatePrefs(patch: Partial<Prefs>): void {
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

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs);
}

/** °F to the display unit, rounded for an input. */
export function toUnit(f: number, unit: TempUnit): number {
  return unit === "F" ? Math.round(f) : Math.round(fToC(f) * 2) / 2;
}

/** The display unit back to °F for the API. */
export function fromUnit(value: number, unit: TempUnit): number {
  return unit === "F" ? value : Math.round(cToF(value) * 10) / 10;
}

export function formatTemp(f: number, unit: TempUnit): string {
  return `${toUnit(f, unit)}°${unit}`;
}
