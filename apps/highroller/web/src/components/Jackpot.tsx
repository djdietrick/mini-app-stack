import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type JackpotResponse, api } from "../api";
import { play } from "../audio/sfx";
import { chips, when } from "../format";
import { buzz, reducedMotion, useSettings } from "../settings";

/**
 * The shared progressive jackpot (#57) in the SPA: one poll of `GET /jackpot`
 * shared by every meter on screen, the meter itself, the lobby's card, and
 * the full-screen celebration when you win it.
 */

/** How often a meter on screen asks. The server caches the answer 5 s. */
const POLL_MS = 10_000;

// ---------- the shared poll ----------

let latest: JackpotResponse | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function load() {
  clearTimeout(timer);
  if (!listeners.size || document.visibilityState !== "visible") return;
  api.jackpot().then(
    (j) => {
      latest = j;
      for (const l of listeners) l();
    },
    () => undefined,
  );
  timer = setTimeout(load, POLL_MS);
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", load);
    load();
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size) {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", load);
    }
  };
}

/** The jackpot as last polled; null until the first answer. */
export function useJackpot(): JackpotResponse | null {
  return useSyncExternalStore(subscribe, () => latest);
}

/** After a win, show the reset at once rather than wait for the next poll. */
export function refreshJackpot(): void {
  if (listeners.size) load();
}

/**
 * The amount on screen, ticking up to each new reading over one poll
 * interval, so it moves between polls without ever showing more than the
 * server said. A fall (someone won it) snaps. Reduced motion snaps always.
 */
function useTicking(target: number | null): number | null {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const still = reducedMotion(useSettings());

  useEffect(() => {
    if (target === null) return;
    const start = from.current;
    if (start === null || target <= start || still) {
      from.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    let lastShown = start;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / POLL_MS);
      const v = Math.floor(start + (target - start) * k);
      if (v !== lastShown) {
        lastShown = v;
        from.current = v;
        setShown(v);
      }
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, still]);

  return shown;
}

export function JackpotMeter({ compact = false }: { compact?: boolean }) {
  const j = useJackpot();
  const amount = useTicking(j?.amount ?? null);
  if (amount === null) return null;
  if (compact) {
    return (
      <span className="rounded-full border border-gold/50 bg-black/55 px-3 py-1 font-mono text-[13px] font-bold tabular text-gold-light backdrop-blur">
        <span className="font-sans text-[11px] font-semibold uppercase tracking-wider text-gold">Jackpot </span>
        {chips(amount)}
      </span>
    );
  }
  return <span className="font-mono tabular">{chips(amount)}</span>;
}

/** The lobby's card: the amount, who won it last, and how it's won. */
export function JackpotCard() {
  const j = useJackpot();
  const [why, setWhy] = useState(false);
  if (!j) return null;
  const last = j.last_hit;
  return (
    <section aria-labelledby="jackpot-title" className="card relative overflow-hidden border-gold/40 p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(90%_120%_at_85%_0%,rgba(212,175,55,0.22),transparent_60%)]" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="jackpot-title" className="label-caps">
            Progressive jackpot
          </h2>
          <p className="mt-1 font-display text-[30px] font-bold leading-tight text-gold-light">
            <JackpotMeter />
          </p>
          <p className="mt-1 truncate text-[13px] text-muted">
            {last ? `Last won by ${last.display_name}: ${chips(last.amount)}, ${when(last.created_at)}` : "Not won yet. Everyone's play feeds it."}
          </p>
        </div>
        <button type="button" className="btn shrink-0 px-3 text-[14px]" aria-expanded={why} onClick={() => setWhy((w) => !w)}>
          How?
        </button>
      </div>
      {why && (
        <p className="relative mt-3 text-[14px] leading-relaxed text-ink/90">
          Every slot spin and every Perfect Pairs, 21+3 and Trips bet adds {Math.round(j.rate * 100)}% of its stake; the house pays it, so no
          payout changes. It's won, on top of the hand's own pay, by five jackpot symbols on a slot spin with all lines bet, suited trips on 21+3,
          or a royal flush with a Trips bet. Then it starts again from {chips(j.seed)}.
        </p>
      )}
    </section>
  );
}

// ---------- the celebration ----------

let won: number | null = null;
const wonListeners = new Set<() => void>();
const setWon = (amount: number | null) => {
  won = amount;
  for (const l of wonListeners) l();
};

/** Shows the full-screen celebration for a jackpot of `amount` chips. */
export function celebrateJackpot(amount: number): void {
  setWon(amount);
  buzz([30, 60, 30, 60, 30, 60, 200]);
  play("jackpot");
  refreshJackpot();
}

const COINS = 36;

/** Mounted once, in App: coins, haptics and (when on) sound, closed by a tap, Escape or itself. */
export function JackpotCelebration() {
  const amount = useSyncExternalStore(
    (l) => {
      wonListeners.add(l);
      return () => wonListeners.delete(l);
    },
    () => won,
  );
  const settings = useSettings();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (amount === null) return;
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setWon(null);
    window.addEventListener("keydown", onKey);
    const auto = setTimeout(() => setWon(null), 8_000);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(auto);
    };
  }, [amount]);

  if (amount === null) return null;
  const particles = settings.batterySaver || reducedMotion(settings) ? 0 : COINS;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="jackpot-won"
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-black/75 p-6"
      onClick={() => setWon(null)}
    >
      {Array.from({ length: particles }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="coin-fall absolute top-[-40px] block h-7 w-7 rounded-full border-2 border-gold-light bg-gold shadow-lg"
          style={{
            left: `${(i * 97) % 100}%`,
            animationDelay: `${(i % 12) * 0.18}s`,
            animationDuration: `${2.2 + ((i * 37) % 10) / 10}s`,
          }}
        />
      ))}
      <div className="jackpot-pop relative flex max-w-sm flex-col items-center gap-3 rounded-3xl border-2 border-gold bg-surface px-8 py-7 text-center shadow-2xl">
        <p className="label-caps text-gold">You hit the</p>
        <h2 id="jackpot-won" className="font-display text-[40px] font-bold leading-none text-gold-light">
          JACKPOT
        </h2>
        <p className="font-mono text-[28px] font-bold tabular text-win">+{chips(amount)}</p>
        <button ref={button} type="button" className="btn-primary mt-2 min-w-[160px]" onClick={() => setWon(null)}>
          Collect
        </button>
      </div>
    </div>
  );
}
