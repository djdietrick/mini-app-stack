/**
 * Layout breakpoints, in one place. tailwind.config.js builds its `screens`
 * from these, and code that has to ask the same question at runtime (the
 * neck's tap-target size) uses the media queries here, so the CSS and the JS
 * never disagree about which layout is showing.
 *
 * - below `md`: phone. One column, bottom tab bar.
 * - `md` (768): tablet portrait. A wider single column; the full 0–12 neck.
 * - `lg` (1024): tablet landscape and laptops. Icon rail on the left, and the
 *   practice screens' wide layouts (cards in a row, a side panel).
 * - `xl` (1280): desktop. The rail shows its labels; the library has 3 columns.
 * - `fine`: a mouse or trackpad, whatever the width. Keyboard hints show, and
 *   the neck's cells can be smaller than a thumb.
 */
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;

/** A precise pointer that can hover: a mouse or a trackpad, not a finger. */
export const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/** Tailwind `screens`: the widths above, plus `fine:` for FINE_POINTER. */
export const TAILWIND_SCREENS: Record<string, string | { raw: string }> = {
  ...Object.fromEntries(Object.entries(BREAKPOINTS).map(([k, v]) => [k, `${v}px`])),
  fine: { raw: FINE_POINTER },
};

export function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}
