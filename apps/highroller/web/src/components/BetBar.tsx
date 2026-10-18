import type { ReactNode } from "react";
import { chips as chipsLong, chipsShort } from "../format";
import { useKeys } from "../keys";
import { useEquipped } from "../player";
import { DENOMINATIONS, chipColors } from "../table/cosmetics";
import { Kbd } from "./ActionBar";

/**
 * The chip selector and bet controls, at thumb height under the table. Tap a
 * chip to select it, then tap a bet spot on the table to add it. Every
 * target is at least 44 px, and the bar clears the home indicator.
 *
 * The bet spots are on the canvas, which a keyboard can't reach, so `spots`
 * lists them again as buttons: hidden until one has keyboard focus (Tab into
 * the bar), then a row above the chips. `extra` adds controls to that row
 * (roulette's pick-a-number). Keys: 1–6 pick a chip, a spot's own key puts
 * it down (M for blackjack's main bet), Space or Enter deals, Backspace
 * undoes, C clears, R rebets, X doubles.
 */
export interface SpotSpec {
  id: string;
  label: string;
  /** Places a chip here, one character, lower case. Not C, R or X. */
  key?: string;
}
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
  spots,
  bets = {},
  onSpot,
  extra,
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
  spots?: SpotSpec[];
  /** What is on each spot, for the spot buttons' labels. */
  bets?: Record<string, number>;
  onSpot?: (id: string) => void;
  extra?: ReactNode;
}) {
  const set = useEquipped().chips;
  useKeys(
    {
      ...Object.fromEntries(DENOMINATIONS.map((d, i) => [String(i + 1), d <= balance && (() => onChip(d))])),
      ...Object.fromEntries((spots ?? []).flatMap((s) => (s.key && onSpot ? [[s.key, () => onSpot(s.id)]] : []))),
      " ": total > 0 && onDeal,
      enter: total > 0 && onDeal,
      backspace: total > 0 && onUndo,
      c: total > 0 && onClear,
      r: total === 0 && canRebet && onRebet,
      x: total > 0 && total * 2 <= balance && onDouble,
    },
    !busy,
  );
  return (
    <div className="flex flex-col gap-2 border-t border-line bg-surface/95 px-3 pb-3 pt-2 backdrop-blur">
      {(spots?.length || extra) && (
        <div role="group" aria-label="Bet spots" className="sr-only focus-within:not-sr-only focus-within:flex focus-within:flex-wrap focus-within:gap-2">
          {spots?.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn min-h-[44px] px-3 text-[14px]"
              disabled={busy}
              aria-keyshortcuts={s.key?.toUpperCase()}
              onClick={() => onSpot?.(s.id)}
            >
              {s.label}
              {s.key && <Kbd k={s.key} />}
              {bets[s.id] ? <span className="font-mono tabular text-gold-light">{chipsLong(bets[s.id])}</span> : null}
            </button>
          ))}
          {extra}
        </div>
      )}
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
              aria-keyshortcuts={String(DENOMINATIONS.indexOf(d) + 1)}
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
        <button type="button" className="btn-primary flex-1" onClick={onDeal} disabled={busy || total === 0} aria-keyshortcuts="Space">
          {dealLabel}
          {total > 0 && <span className="font-mono tabular">{chipsShort(total)}</span>}
          <Kbd k=" " />
        </button>
      </div>
    </div>
  );
}
