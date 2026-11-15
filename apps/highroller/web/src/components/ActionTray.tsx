import { type ReactNode, useEffect, useRef } from "react";
import { useKeys } from "../keys";
import { type ActionSpec, Kbd } from "./ActionBar";

/**
 * The player's choices mid-hand, in the bet bar's footprint: two rows the
 * same height as the chip row and the Undo/Clear/Deal row, so swapping from
 * betting to playing never resizes the table. Every slot is always drawn and
 * an action that isn't legal right now is shown disabled, so a button never
 * moves under a thumb. `main` is the bottom row, where Deal sits while
 * betting (blackjack's Hit and Stand); `top` is the row where the chips sit,
 * or, for tables with nothing more to offer, `note`: a line of guidance that
 * would otherwise be a bar of its own above the tray.
 *
 * The bottom row takes the place of Deal, so a quick second tap on Deal would
 * land on whatever is there now: taps (not keys) are ignored for a moment
 * after the tray appears.
 */
export const TAP_GUARD_MS = 400;

export function ActionTray({
  top = [],
  note,
  main,
  legal,
  onAction,
  busy = false,
}: {
  top?: ActionSpec[];
  /** Shown in the top row when `top` is empty: two short lines at most. */
  note?: ReactNode;
  main: ActionSpec[];
  legal: readonly string[];
  onAction: (type: string) => void;
  busy?: boolean;
}) {
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = performance.now();
  }, []);

  const can = (a: ActionSpec) => !busy && legal.includes(a.type);
  useKeys(Object.fromEntries([...top, ...main].flatMap((a) => (a.key && can(a) ? [[a.key, () => onAction(a.type)]] : []))), !busy);

  const button = (a: ActionSpec, height: string) => (
    <button
      key={a.type}
      type="button"
      disabled={!can(a)}
      onClick={() => performance.now() - shownAt.current >= TAP_GUARD_MS && onAction(a.type)}
      aria-keyshortcuts={a.key?.toUpperCase()}
      className={(a.primary ? "btn-primary" : "btn") + ` ${height} min-w-0 px-2`}
    >
      <span className="truncate">{a.label}</span>
      {a.key && <Kbd k={a.key} />}
    </button>
  );

  return (
    // The bet bar's padding and gap, with its rows' heights: 48 px (the chips) and 44 px.
    <div className="flex flex-col gap-2 border-t border-line bg-surface/95 px-3 pb-3 pt-2 backdrop-blur">
      {top.length ? (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${top.length}, minmax(0, 1fr))` }}>
          {top.map((a) => button(a, "h-12"))}
        </div>
      ) : (
        <div className="flex h-12 items-center justify-center px-2">
          <p className="line-clamp-2 text-center text-[14px] leading-tight text-ink/90">{note}</p>
        </div>
      )}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${main.length}, minmax(0, 1fr))` }}>
        {main.map((a) => button(a, main.length > 2 ? "h-11" : "h-11 text-[16px]"))}
      </div>
    </div>
  );
}
