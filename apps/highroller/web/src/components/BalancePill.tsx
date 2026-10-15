import { useEffect, useRef, useState } from "react";
import { chips } from "../format";
import { usePlayer } from "../player";
import { motionScale } from "../settings";

/**
 * The balance, always on screen. When it changes it counts up or down to the
 * new value rather than jumping, so a win reads as a win. Payout animations on
 * a table fly chips to this element: it is found by `data-balance-pill`.
 */
export function BalancePill({ className = "" }: { className?: string }) {
  const { player } = usePlayer();
  const target = player?.balance ?? null;
  const shown = useCountTo(target);
  const [pop, setPop] = useState(0);
  const last = useRef(target);

  useEffect(() => {
    if (target !== null && last.current !== null && target > last.current) setPop((n) => n + 1);
    last.current = target;
  }, [target]);

  return (
    <div
      data-balance-pill
      aria-live="polite"
      aria-label={target === null ? "Balance loading" : `Balance ${chips(target)} chips`}
      className={
        "inline-flex min-h-[36px] items-center gap-2 rounded-full border border-gold/40 bg-raised px-3 font-mono text-[15px] font-bold text-gold-light " +
        className
      }
    >
      <ChipGlyph />
      <span key={pop} className={"tabular " + (pop ? "pill-pop inline-block" : "")}>
        {shown === null ? "—" : chips(shown)}
      </span>
    </div>
  );
}

function ChipGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="#d4af37" />
      <circle cx="10" cy="10" r="5.5" fill="#0f3d24" stroke="#f8f3e3" strokeWidth="1.2" strokeDasharray="2.2 1.6" />
      <g fill="#f8f3e3">
        <rect x="9" y="1" width="2" height="3" rx="0.6" />
        <rect x="9" y="16" width="2" height="3" rx="0.6" />
        <rect x="1" y="9" width="3" height="2" rx="0.6" />
        <rect x="16" y="9" width="3" height="2" rx="0.6" />
      </g>
    </svg>
  );
}

/** Animates a displayed number toward `target` over ~0.6 s (snaps with reduced motion). */
function useCountTo(target: number | null): number | null {
  const [shown, setShown] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    if (target === null) return;
    const start = from.current;
    const duration = 600 * motionScale();
    if (start === null || duration === 0 || start === target) {
      from.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - (1 - t) ** 3;
      const value = Math.round(start + (target - start) * eased);
      from.current = value;
      setShown(value);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return shown;
}
