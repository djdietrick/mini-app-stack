import { useEffect, useRef, useState } from "react";
import { type FeedEventRow, type GiftRow, api } from "../api";
import { chips, when } from "../format";
import { Sheet } from "../games/TableFrame";
import { reducedMotion, useSettings } from "../settings";

/** How often the lobby asks for the feed while it is on screen. The server caches it 10 s. */
const FEED_POLL_MS = 15_000;
/** Ticker speed, in CSS pixels a second. */
const TICKER_SPEED = 28;
/** After a touch, the ticker waits this long before moving again. */
const TOUCH_PAUSE_MS = 4_000;

/**
 * The lobby's big-win strip: recent big wins and jackpot hits from every
 * player, scrolling slowly sideways. It polls only while the page is visible,
 * stops while a finger or the pointer is on it (and a moment after), and
 * stays still with reduced motion, when it is simply a row you can swipe.
 * Tapping a win opens its details.
 */
export function FeedTicker() {
  const [events, setEvents] = useState<FeedEventRow[]>([]);
  const [open, setOpen] = useState<FeedEventRow | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const held = useRef(0);
  const settings = useSettings();
  const still = reducedMotion(settings);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      api.feed().then(
        (f) => live && setEvents(f.events),
        () => undefined,
      );
      timer = setTimeout(load, FEED_POLL_MS);
    };
    load();
    document.addEventListener("visibilitychange", load);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el || still || !events.length) return;
    let frame = 0;
    let last = performance.now();
    let pos = el.scrollLeft;
    const step = (t: number) => {
      const dt = Math.min(100, t - last);
      last = t;
      if (t >= held.current) {
        if (el.scrollWidth > el.clientWidth) {
          // Track a float position: scrollLeft rounds, and a slow ticker moves less than a pixel a frame.
          if (Math.abs(el.scrollLeft - pos) > 2) pos = el.scrollLeft;
          pos += (TICKER_SPEED * dt) / 1000;
          if (pos >= el.scrollWidth - el.clientWidth) pos = 0;
          el.scrollLeft = pos;
        }
      } else {
        pos = el.scrollLeft;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [still, events.length]);

  if (!events.length) return null;
  const hold = (ms = TOUCH_PAUSE_MS) => (held.current = performance.now() + ms);

  return (
    <section aria-labelledby="feed-title">
      <h2 id="feed-title" className="label-caps mb-2">
        Big wins
      </h2>
      <div
        ref={strip}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:-mx-8 md:px-8 [&::-webkit-scrollbar]:hidden"
        onPointerDown={() => hold()}
        onPointerMove={(e) => e.pointerType === "mouse" && hold(1_500)}
        onWheel={() => hold()}
        onFocus={() => hold(60_000)}
        onBlur={() => hold(0)}
      >
        {events.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setOpen(e)}
            className="focus-ring flex shrink-0 items-center gap-2 rounded-full border border-gold/30 bg-surface px-3 py-2 text-[13.5px]"
          >
            <span aria-hidden="true">{e.kind === "jackpot" ? "💎" : "🎉"}</span>
            <span className="font-medium">{e.display_name}</span>
            <span className="text-muted">won</span>
            <span className="tabular font-mono font-bold text-gold-light">{chips(e.amount)}</span>
            <span className="text-muted">· {e.hand_label}</span>
          </button>
        ))}
      </div>
      {open && <FeedEventSheet event={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function FeedEventSheet({ event: e, onClose }: { event: FeedEventRow; onClose: () => void }) {
  const rows: [string, string][] = [
    ["Game", e.game_name],
    ["Hand", e.hand_label],
    ["Staked", chips(e.wagered)],
    ["Paid", chips(e.amount)],
    ["Multiple", `${e.multiplier}×`],
    ["When", when(e.created_at)],
  ];
  return (
    <Sheet title={e.kind === "jackpot" ? "Jackpot!" : "Big win"} onClose={onClose}>
      <p className="text-[17px]">
        <span className="font-semibold">{e.display_name}</span> won{" "}
        <span className="font-mono font-bold text-gold-light">{chips(e.amount)}</span> at {e.game_name}.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular text-right font-mono">{v}</dd>
          </div>
        ))}
      </dl>
      <a href={`#/play/${e.game}${e.variant ? `/${e.variant}` : ""}`} className="btn-primary" onClick={onClose}>
        Play {e.game_name}
      </a>
    </Sheet>
  );
}

const SEEN_KEY = "highroller:gifts-seen";
/** With nothing remembered (a new device), gifts this recent still show. */
const FIRST_LOOK_MS = 7 * 86_400_000;

function seenSince(): string {
  try {
    const v = window.localStorage.getItem(SEEN_KEY);
    if (v && !Number.isNaN(Date.parse(v))) return v;
  } catch {
    // Storage blocked: fall through to the default window.
  }
  return new Date(Date.now() - FIRST_LOOK_MS).toISOString();
}

/** "You received" for gifts since the last one dismissed on this device. */
export function GiftBanner() {
  const [gifts, setGifts] = useState<GiftRow[]>([]);

  useEffect(() => {
    let live = true;
    api.giftsReceived(seenSince()).then(
      (r) => live && setGifts(r.gifts),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  if (!gifts.length) return null;
  const total = gifts.reduce((n, g) => n + g.amount, 0);

  function dismiss() {
    try {
      window.localStorage.setItem(SEEN_KEY, gifts[0].created_at);
    } catch {
      // Not remembered: the banner comes back next visit.
    }
    setGifts([]);
  }

  return (
    <div role="status" className="card flex flex-col gap-2 border-gold/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-caps">{gifts.length === 1 ? "A gift for you" : `${gifts.length} gifts for you`}</p>
          <p className="mt-1 font-display text-[22px] font-bold text-gold-light">+{chips(total)}</p>
        </div>
        <button type="button" className="btn min-h-[40px] px-3" onClick={dismiss}>
          Thanks
        </button>
      </div>
      <ul className="flex flex-col gap-1.5 text-[14px]">
        {gifts.slice(0, 3).map((g) => (
          <li key={g.id}>
            <span className="font-medium">{g.from_name}</span> sent <span className="font-mono font-bold">{chips(g.amount)}</span>
            {g.message && <span className="block break-words text-muted">“{g.message}”</span>}
          </li>
        ))}
        {gifts.length > 3 && <li className="text-muted">and {gifts.length - 3} more</li>}
      </ul>
    </div>
  );
}
