/**
 * Layout breakpoints, in one place, as in fretwork. tailwind.config.js builds
 * its `screens` from these, and code that has to ask the same question at
 * runtime (a table scene choosing its layout) uses the media queries here, so
 * the CSS and the canvas never disagree about which layout is showing.
 *
 * - below `md`: phone, portrait first. One column, bottom tab bar, the table
 *   on top and the bet bar at thumb height.
 * - `md` (768): tablet portrait. A wider column.
 * - `lg` (1024): tablet landscape and laptops. The tabs become a left rail.
 * - `xl` (1280): desktop. The rail shows its labels.
 * - `fine`: a mouse or trackpad, whatever the width.
 *
 * Wider table layouts for tablet and desktop are #58.
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
