import { useEffect, useRef } from "react";

/**
 * Keyboard shortcuts for a practice screen, on a laptop or a tablet with a
 * keyboard: Space starts or stops listening, R restarts, N moves on. They are
 * bound only while the screen that passes them is mounted, never globally.
 *
 * A control focused from the keyboard keeps its own Space and Enter (a focused
 * button presses, the neck plays the focused fret). A control that only has
 * focus because it was clicked doesn't: after clicking Restart, Space should
 * start the mic, not restart again. Typing in a field is left alone.
 */
export interface PracticeKeys {
  /** Space. */
  toggle?: () => void;
  /** R. */
  restart?: () => void;
  /** N. */
  next?: () => void;
}

const KEY_HINTS: { key: string; label: keyof PracticeKeys; text: string }[] = [
  { key: "Space", label: "toggle", text: "mic on/off" },
  { key: "R", label: "restart", text: "restart" },
  { key: "N", label: "next", text: "next" },
];

/** Focus that came from the keyboard. Safari before 15.4 has no :focus-visible; treat all focus as the keyboard's there. */
function keyboardFocused(el: Element): boolean {
  if (el === document.body) return false;
  try {
    return el.matches(":focus-visible");
  } catch {
    return el === document.activeElement;
  }
}

export function usePracticeKeys(keys: PracticeKeys): void {
  const latest = useRef(keys);
  latest.current = keys;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target && (target.closest("input, textarea, select, [contenteditable='true']") || keyboardFocused(target))) return;
      const k = latest.current;
      const action = e.key === " " ? k.toggle : e.key === "r" || e.key === "R" ? k.restart : e.key === "n" || e.key === "N" ? k.next : undefined;
      if (!action) return;
      // Also stops a clicked button (or the neck) from handling the same key.
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) action();
    };
    // Capture, so this runs before the focused element's own handler.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

/** The shortcuts a screen offers, shown only where there is a mouse or trackpad (and so, likely, a keyboard). */
export function KeyHints({ keys, className = "" }: { keys: PracticeKeys; className?: string }) {
  const shown = KEY_HINTS.filter((h) => keys[h.label]);
  if (!shown.length) return null;
  return (
    <p className={"hidden flex-wrap gap-x-4 gap-y-1 text-[13px] text-faint fine:flex " + className} aria-hidden="true">
      {shown.map((h) => (
        <span key={h.key}>
          <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">{h.key}</kbd> {h.text}
        </span>
      ))}
    </p>
  );
}
