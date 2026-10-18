import { useEffect, useRef } from "react";

/**
 * Table shortcuts: H/S/D/P at blackjack, Space to deal or spin, digits for
 * chips and holds. A key is ignored while typing in a field, with a modifier
 * held, while a dialog is open over the table, and (for Space and Enter)
 * when a button has focus, so the button's own press never fires twice.
 *
 * `bindings` maps a key (`event.key`, lower-cased; " " is Space) to its
 * action. The latest map is used on every press, so callers can pass a fresh
 * object each render.
 */
export function useKeys(bindings: Record<string, (() => void) | undefined | false>, enabled = true): void {
  const latest = useRef(bindings);
  latest.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if ((e.key === " " || e.key === "Enter") && t && /^(BUTTON|A)$/.test(t.tagName)) return;
      if (document.querySelector("[role=dialog][aria-modal=true]")) return;
      const fn = latest.current[e.key.toLowerCase()];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
