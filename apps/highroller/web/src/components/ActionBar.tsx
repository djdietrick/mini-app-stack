/**
 * The player's choices mid-hand. It shows only what the hand's view says is
 * legal right now (`legal_actions` from the server), in a fixed order so a
 * button never jumps under a thumb between decisions.
 */
export interface ActionSpec {
  type: string;
  label: string;
  /** Primary actions get the gold button. */
  primary?: boolean;
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
  if (!shown.length) return null;
  return (
    <div className="grid gap-2 border-t border-line bg-surface/95 px-3 pb-3 pt-3 backdrop-blur" style={{ gridTemplateColumns: `repeat(${Math.min(shown.length, 4)}, minmax(0, 1fr))` }}>
      {shown.map((a) => (
        <button
          key={a.type}
          type="button"
          disabled={busy}
          onClick={() => onAction(a.type)}
          className={(a.primary ? "btn-primary" : "btn") + " min-h-[52px] px-2"}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
