import { type ReactNode, useEffect, useState } from "react";
import { JackpotMeter } from "../components/Jackpot";

/**
 * The frame every table screen shares: the canvas filling the space under
 * the header, a slim bar over its top edge (back to the lobby, the game's
 * name, an info button), and the bet or action bar pinned at thumb height
 * above the tab bar. From `lg` (WIDE_TABLE) it turns landscape: the table on
 * the left and the bars in a column beside it.
 *
 * `description` is the table in words, for screen readers (games/describe.ts):
 * an `aria-live` region the canvas can't be. Games that feed the jackpot pass
 * `jackpot` for a meter under the top bar.
 *
 * While a table is open the page doesn't rubber-band (iOS standalone), so a
 * drag on the felt never moves the whole app.
 */
export function TableFrame({
  title,
  info,
  canvas,
  overlay,
  bar,
  above,
  description,
  jackpot = false,
}: {
  title: string;
  /** The game's rules and paytables, in a sheet. */
  info?: ReactNode;
  canvas: ReactNode;
  /** Extra controls over the canvas (roulette's zoom-out). */
  overlay?: ReactNode;
  /** The bet bar or the action bar. */
  bar: ReactNode;
  /** A line above the bar: a prompt, a made hand. */
  above?: ReactNode;
  /** The table in words, read out as it changes. */
  description?: string;
  /** Show the progressive jackpot over the table. */
  jackpot?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("at-table");
    return () => document.documentElement.classList.remove("at-table");
  }, []);

  return (
    <div className="table-screen flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="relative min-h-[360px] flex-1 bg-felt-dark lg:min-h-0">
        <div className="absolute inset-0" aria-hidden="true">
          {canvas}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 p-2">
          <a href="#/" className="btn pointer-events-auto min-h-[40px] bg-raised/80 px-3 text-[14px] backdrop-blur" aria-label="Back to the lobby">
            ‹ Lobby
          </a>
          <h1 className="truncate rounded-full bg-black/30 px-3 py-1 font-display text-[15px] font-bold text-ink/90">{title}</h1>
          {info ? (
            <button
              type="button"
              className="btn pointer-events-auto min-h-[40px] w-[40px] bg-raised/80 px-0 font-display text-[17px] font-bold backdrop-blur"
              aria-label="Rules and payouts"
              onClick={() => setOpen(true)}
            >
              i
            </button>
          ) : (
            <span className="w-[40px]" />
          )}
        </div>
        {jackpot && (
          <div className="pointer-events-none absolute inset-x-0 top-14 z-10 flex justify-center">
            <JackpotMeter compact />
          </div>
        )}
        {overlay}
      </div>
      <div className="pb-safe sticky bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 lg:static lg:flex lg:w-[380px] lg:shrink-0 lg:flex-col lg:border-l lg:border-line lg:bg-surface lg:pb-4 xl:w-[420px]">
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {description}
        </p>
        {/* The wide layout has room to show the same words: a running account of the hand, with its keys. */}
        {description && (
          <p aria-hidden="true" className="hidden px-5 pb-2 pt-5 text-[15px] leading-relaxed text-muted lg:block">
            {description}
          </p>
        )}
        <div className="hidden flex-1 lg:block" />
        {above && (
          <div className="border-t border-line bg-surface/95 px-4 py-2 text-center text-[14px] text-ink/90 backdrop-blur lg:border-t-0 lg:py-4">
            {above}
          </div>
        )}
        {bar}
      </div>
      {open && info && <Sheet title={`${title}: rules`} onClose={() => setOpen(false)}>{info}</Sheet>}
    </div>
  );
}

/** A bottom sheet over everything, closed by its button, the backdrop or Escape. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 lg:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="pb-safe max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 lg:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-[20px] font-bold">{title}</h2>
          <button type="button" className="btn min-h-[40px] px-3" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-ink/90">{children}</div>
      </div>
    </div>
  );
}

/** A two-column paytable. */
export function Paytable({ caption, rows }: { caption: string; rows: [string, string][] }) {
  return (
    <table className="w-full text-[15px]">
      <caption className="label-caps mb-2 text-left">{caption}</caption>
      <tbody>
        {rows.map(([hand, pays]) => (
          <tr key={hand} className="border-t border-line">
            <td className="py-2">{hand}</td>
            <td className="py-2 text-right font-mono tabular text-gold-light">{pays}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
