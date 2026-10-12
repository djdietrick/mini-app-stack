import { type ReactNode, useId, useState } from "react";
import { STEP_HOWTO, TIPS, type TipId } from "../help";
import type { StepKind } from "../../../src/fermentation/index.js";
import { href } from "../router";

/**
 * Explainers for new bakers. On a phone there is no hover, so a tip is not a
 * hover tooltip: an ⓘ button opens it inline under the thing it explains, and
 * a link goes on to the full section of the guide.
 */

/** An ⓘ button and the panel it opens, for a component to place where it likes. */
export function useTip(id: TipId | undefined, about: string): { button: ReactNode; panel: ReactNode; open: boolean } {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!id) return { button: null, panel: null, open: false };
  const tip = TIPS[id];
  return {
    open,
    button: (
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? `Hide help: ${about}` : `What is this? ${about}`}
        onClick={() => setOpen(!open)}
        className={
          "focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
          (open ? "text-crust" : "text-muted hover:text-crust")
        }
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </button>
    ),
    panel: open ? (
      <div id={panelId} role="note" className="rounded-xl bg-crust-soft px-3 py-2.5 text-sm leading-relaxed text-ink">
        <p>{tip.text}</p>
        {"more" in tip && tip.more && (
          <a href={href({ name: "guide", section: tip.more })} className="focus-ring mt-1 inline-block rounded font-bold text-crust">
            More in the guide
          </a>
        )}
      </div>
    ) : null,
  };
}

/** A small caps label with an ⓘ after it, and its panel underneath. */
export function TipLine({ tip, label }: { tip: TipId; label: string }) {
  const t = useTip(tip, label);
  return (
    <div className="flex flex-col gap-1">
      <div className="-my-2 flex items-center gap-0.5">
        <span className="label-caps">{label}</span>
        {t.button}
      </div>
      {t.panel}
    </div>
  );
}

/** "How do I do this?" for one bake step, collapsed until asked. */
export function StepHowTo({ kind, open = false }: { kind: StepKind; open?: boolean }) {
  return (
    <details open={open} className="group rounded-xl bg-raised px-3 py-2 text-sm">
      <summary className="focus-ring cursor-pointer list-none rounded font-bold text-crust">
        <span className="group-open:hidden">How do I do this?</span>
        <span className="hidden group-open:inline">How to do it</span>
      </summary>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 leading-relaxed">
        {STEP_HOWTO[kind].map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  );
}
