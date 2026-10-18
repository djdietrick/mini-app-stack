import { useKeys } from "../keys";

/**
 * The player's choices mid-hand. It shows only what the hand's view says is
 * legal right now (`legal_actions` from the server), in a fixed order so a
 * button never jumps under a thumb between decisions. Each action may have a
 * key (H/S/D/P at blackjack), shown on devices with a keyboard and pointer.
 */
export interface ActionSpec {
  type: string;
  label: string;
  /** Primary actions get the gold button. */
  primary?: boolean;
  /** Its keyboard shortcut, one character, lower case. */
  key?: string;
}

export function ActionBar({
  actions,
  legal,
  onAction,
  busy = false,
}: {
  /** Every action the game has, in display order. */
  actions: ActionSpec[];
  legal: readonly string[];
  onAction: (type: string) => void;
  busy?: boolean;
}) {
  const shown = actions.filter((a) => legal.includes(a.type));
  useKeys(Object.fromEntries(shown.flatMap((a) => (a.key ? [[a.key, () => onAction(a.type)]] : []))), !busy);
  if (!shown.length) return null;
  return (
    <div
      // Two a row in the wide layout's side column.
      className="grid gap-2 border-t border-line bg-surface/95 px-3 pb-3 pt-3 backdrop-blur lg:![grid-template-columns:repeat(2,minmax(0,1fr))]"
      // Up to four in a row; five or more split over two rows, so none is left alone.
      style={{ gridTemplateColumns: `repeat(${shown.length > 4 ? Math.ceil(shown.length / 2) : shown.length}, minmax(0, 1fr))` }}
    >
      {shown.map((a) => (
        <button
          key={a.type}
          type="button"
          disabled={busy}
          onClick={() => onAction(a.type)}
          aria-keyshortcuts={a.key?.toUpperCase()}
          className={(a.primary ? "btn-primary" : "btn") + " min-h-[52px] px-2"}
        >
          {a.label}
          {a.key && <Kbd k={a.key} />}
        </button>
      ))}
    </div>
  );
}

/** A key hint, only where there is a keyboard to press it. */
export function Kbd({ k }: { k: string }) {
  return (
    <kbd aria-hidden="true" className="hidden rounded border border-current px-1 font-mono text-[11px] opacity-70 fine:inline">
      {k === " " ? "Space" : k.toUpperCase()}
    </kbd>
  );
}
