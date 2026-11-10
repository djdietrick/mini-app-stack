import { useSyncExternalStore } from "react";

/**
 * Light, dark, or whatever the device prefers (the default). The choice is
 * per device, in localStorage. index.html applies it before first paint with
 * the same key, so a dark page never flashes white; keep the two in step.
 */
export type Theme = "system" | "light" | "dark";

const KEY = "ytdigest:theme";
/** canvas-50 in each theme, for the browser and status bar chrome. */
const CHROME = { light: "#FAFAFC", dark: "#0F0F14" } as const;

const listeners = new Set<() => void>();
const media = window.matchMedia("(prefers-color-scheme: dark)");
let current = load();

function load(): Theme {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(): void {
  const root = document.documentElement;
  if (current === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", current);
  const dark = current === "dark" || (current === "system" && media.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? CHROME.dark : CHROME.light);
}

apply();
media.addEventListener("change", apply);

export function setTheme(theme: Theme): void {
  current = theme;
  try {
    if (theme === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, theme);
  } catch {
    // Still applies for this visit.
  }
  apply();
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
