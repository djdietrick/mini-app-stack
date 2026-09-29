import { useEffect, useRef, useState } from "react";
import { type FretWindow, INLAY_FRETS, midiAt, midiName, stringName } from "../../../src/theory/index.js";
import { useSettings } from "../settings";

/** Smallest cell, px (WCAG 2.5.5 asks 44), and the gap between cells. */
const CELL = 44;
const GAP = 2;

export interface StripDot {
  fret: number;
  tone: "correct" | "miss" | "hint";
  name: string;
}

/**
 * One string, fret by fret: where a flashcard's answer is revealed, and the
 * tap fallback for it. Cells are buttons at least 44 px wide that wrap onto
 * more rows on a phone, rather than shrinking below a thumb; rows are
 * balanced (0–6 and 7–12, not 0–11 and 12). Left-handed players get the frets
 * running right to left.
 */
export function StringStrip({
  string,
  frets,
  dots = [],
  onPress,
}: {
  string: number;
  frets: FretWindow;
  dots?: StripDot[];
  onPress?: (fret: number) => void;
}) {
  const { leftHanded } = useSettings();
  const cells = Array.from({ length: frets.hi - frets.lo + 1 }, (_, i) => frets.lo + i);
  const byFret = new Map(dots.map((d) => [d.fret, d]));
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(350);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = Math.max(1, Math.min(cells.length, Math.floor((width + GAP) / (CELL + GAP))));
  const columns = Math.ceil(cells.length / Math.ceil(cells.length / fit));

  return (
    <div
      role="group"
      aria-label={`The ${stringName(string)} string, frets ${frets.lo} to ${frets.hi}`}
      ref={ref}
      className="grid"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP, direction: leftHanded ? "rtl" : "ltr" }}
    >
      {cells.map((fret) => {
        const dot = byFret.get(fret);
        return (
          <button
            key={fret}
            type="button"
            disabled={!onPress}
            onClick={() => onPress?.(fret)}
            aria-label={`Fret ${fret}, ${midiName(midiAt(string, fret))}${dot ? `, ${dot.tone === "hint" ? "answer" : dot.tone}` : ""}`}
            className={
              "focus-ring relative flex h-14 flex-col items-center justify-between rounded-lg py-1 disabled:cursor-default " +
              (fret === 0 ? "border-2 border-ink/60 bg-raised" : "bg-wood")
            }
          >
            <span className="font-mono text-[10px] leading-none text-faint">{fret}</span>
            <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#cdbd9f]/70" aria-hidden="true" />
            {dot ? (
              <span
                className={
                  "fb-flash relative flex h-8 w-8 items-center justify-center rounded-full border-2 font-display text-[13px] font-bold " +
                  (dot.tone === "correct"
                    ? "border-[#b8f0de] bg-correct text-correct-ink"
                    : dot.tone === "miss"
                      ? "border-miss bg-[#241410] text-miss"
                      : "border-dashed border-brass bg-[#241b13] text-brass-light")
                }
                aria-hidden="true"
              >
                {dot.name}
              </span>
            ) : (
              INLAY_FRETS.includes(fret) && <span className="relative h-2 w-2 rounded-full bg-[#7a6450]" aria-hidden="true" />
            )}
            <span className="h-[10px]" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
