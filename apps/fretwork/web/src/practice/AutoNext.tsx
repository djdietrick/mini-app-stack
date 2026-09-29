import { useEffect, useRef, useState } from "react";
import { useSettings } from "../settings";

/**
 * Hands-free: calls `onGo` after `ms` unless the player says stay, showing
 * the countdown so the move never comes as a surprise. Renders nothing (and
 * never fires) when the Hands-free setting is off. Mount it for as long as
 * moving on is the right thing to do; unmounting cancels it.
 */
export function AutoNext({ ms, label, onGo }: { ms: number; label: string; onGo: () => void }) {
  const { handsFree } = useSettings();
  const [stayed, setStayed] = useState(false);
  const [left, setLeft] = useState(ms);
  const go = useRef(onGo);
  go.current = onGo;
  const running = handsFree && !stayed;

  useEffect(() => {
    if (!running) return;
    const end = performance.now() + ms;
    setLeft(ms);
    const tick = window.setInterval(() => setLeft(Math.max(0, end - performance.now())), 200);
    const fire = window.setTimeout(() => go.current(), ms);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(fire);
    };
  }, [running, ms]);

  if (!running) return null;
  return (
    <p className="flex min-h-[44px] items-center gap-3 text-[15px] text-muted" role="status">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-raised" aria-hidden="true">
        <span className="block h-full bg-brass" style={{ width: `${100 - (100 * left) / ms}%` }} />
      </span>
      <span>
        {label} in {Math.ceil(left / 1000)} s
      </span>
      <button type="button" onClick={() => setStayed(true)} className="focus-ring min-h-[44px] rounded-xl px-3 text-muted underline">
        Stay
      </button>
    </p>
  );
}
