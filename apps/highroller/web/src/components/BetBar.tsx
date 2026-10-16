import { chipsShort } from "../format";
import { useEquipped } from "../player";
import { DENOMINATIONS, chipColors } from "../table/cosmetics";

/**
 * The chip selector and bet controls, at thumb height under the table. Tap a
 * chip to select it, then tap a bet spot on the table to add it. Every
 * target is at least 44 px, and the bar clears the home indicator.
 */
export function BetBar({
  chip,
  onChip,
  total,
  balance,
  canRebet,
  onUndo,
  onClear,
  onRebet,
  onDouble,
  onDeal,
  dealLabel = "Deal",
  busy = false,
}: {
  chip: number;
  onChip: (value: number) => void;
  total: number;
  balance: number;
  canRebet: boolean;
  onUndo: () => void;
  onClear: () => void;
  onRebet: () => void;
  onDouble: () => void;
  onDeal: () => void;
  dealLabel?: string;
  busy?: boolean;
}) {
  const set = useEquipped().chips;
  return (
    <div className="flex flex-col gap-2 border-t border-line bg-surface/95 px-3 pb-3 pt-2 backdrop-blur">
      <div role="radiogroup" aria-label="Chip value" className="flex justify-between gap-1">
        {DENOMINATIONS.map((d) => {
          const c = chipColors(set, d);
          const selected = d === chip;
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${d} chip`}
              disabled={d > balance}
              onClick={() => onChip(d)}
              className={
                "focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[3px] border-dashed font-mono text-[12px] font-extrabold shadow transition disabled:opacity-30 " +
                (selected ? "-translate-y-1 ring-2 ring-gold ring-offset-2 ring-offset-surface" : "")
              }
              style={{ background: c.base, borderColor: c.stripe, color: c.text }}
            >
              {chipsShort(d).replace(",000", "K")}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn px-3" onClick={onUndo} disabled={busy || total === 0} aria-label="Undo last chip">
          Undo
        </button>
        <button type="button" className="btn px-3" onClick={onClear} disabled={busy || total === 0}>
          Clear
        </button>
        {total === 0 ? (
          <button type="button" className="btn px-3" onClick={onRebet} disabled={busy || !canRebet}>
            Rebet
          </button>
        ) : (
          <button type="button" className="btn px-3" onClick={onDouble} disabled={busy || total * 2 > balance}>
            ×2
          </button>
        )}
        <button type="button" className="btn-primary flex-1" onClick={onDeal} disabled={busy || total === 0}>
          {dealLabel}
          {total > 0 && <span className="font-mono tabular">{chipsShort(total)}</span>}
        </button>
      </div>
    </div>
  );
}
