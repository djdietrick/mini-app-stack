import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type CompletionRow, type HandResponse, type HandRow, type LevelRow, api } from "../api";
import { useToast } from "../components/Toast";
import { chips } from "../format";
import { usePlayer } from "../player";
import { buzz } from "../settings";

/**
 * One table's hand, the same for every game: resume the active hand on load,
 * start a hand, act on it, and turn the server's refusals into a toast.
 *
 * The balance moves in two steps so the pill never gives a result away: a
 * stake leaves it as soon as the server takes it, and a payout lands only
 * when the screen calls `shown(hand)` from TableCanvas's `onShown`, after
 * the cards have turned or the ball has dropped. That holds for payouts made
 * mid-hand too (blackjack's side bets, paid on the deal): `paidSoFar` reads
 * them from a live hand's view. XP, a level gained and quests completed are
 * held with the payout, so the badge and the toasts follow the cards too.
 */
export type Announcement = { text: string; tone: "win" | "loss" | "info" } | null;

export function useHand(game: string, opts: { paidSoFar?: (h: HandRow) => number } = {}) {
  const paidSoFar = opts.paidSoFar;
  const { setBalance, setClaimable } = usePlayer();
  const toast = useToast();
  const [hand, setHand] = useState<HandRow | null>(null);
  const [resuming, setResuming] = useState(true);
  const [busy, setBusy] = useState(false);
  /**
   * What to show once the table has shown hand `id`: the balance (by then it
   * has paid back `back`), the XP and level, and the quests it completed.
   */
  const payout = useRef<{
    id: string;
    balance: number;
    progress: Progress;
    back: number;
    completed: CompletionRow[];
  } | null>(null);
  /** What the pill already includes from hand `id`'s payouts. */
  const seen = useRef<{ id: string; back: number } | null>(null);
  /** Hands played here (not resumed), and what has been announced for them. */
  const fresh = useRef(new Set<string>());
  const announced = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    api
      .activeHands()
      .then((r) => live && setHand(r.hands.find((h) => h.game === game) ?? null))
      .catch(() => undefined)
      .finally(() => live && setResuming(false));
    return () => {
      live = false;
    };
  }, [game]);

  const receive = useCallback(
    (res: HandResponse) => {
      const h = res.hand;
      setHand(h);
      fresh.current.add(h.id);
      const back = h.status === "settled" ? h.returned : (paidSoFar?.(h) ?? 0);
      const unseen = back - (seen.current?.id === h.id ? seen.current.back : 0);
      const progress = progressOf(res);
      if (unseen > 0 || h.status === "settled") {
        setBalance(res.balance - Math.max(0, unseen));
        payout.current = { id: h.id, balance: res.balance, progress, back, completed: res.completed };
      } else {
        setBalance(res.balance, progress);
      }
    },
    [setBalance, paidSoFar],
  );

  const fail = useCallback(
    async (e: unknown) => {
      if (!(e instanceof ApiError)) {
        toast("Couldn't reach the table", "loss");
        return;
      }
      const details = (e.body as { error?: { reason?: string; hand_id?: string } } | null)?.error;
      switch (e.code) {
        case "INSUFFICIENT_FUNDS":
          toast("Not enough chips", "loss");
          break;
        case "BAD_BETS":
          toast(details?.reason ? cap(details.reason) : "Those bets aren't allowed", "loss");
          break;
        case "HAND_IN_PROGRESS":
          if (details?.hand_id) setHand(await api.hand(details.hand_id).catch(() => null));
          toast("You have a hand in play", "info");
          break;
        case "STALE_HAND":
        case "ILLEGAL_ACTION":
          // Another tab or a double tap got there first: show the hand as it is now.
          if (hand) setHand(await api.hand(hand.id).catch(() => hand));
          break;
        default:
          toast(`Something went wrong (${e.code})`, "loss");
      }
    },
    [hand, toast],
  );

  /** Deals a hand. Resolves to the new hand, or null when the server refused. */
  const start = useCallback(
    async (bets: unknown, variant?: string): Promise<HandRow | null> => {
      setBusy(true);
      try {
        const res = await api.startHand({ id: uuid(), game, variant, bets });
        receive(res);
        return res.hand;
      } catch (e) {
        await fail(e);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [game, receive, fail],
  );

  const act = useCallback(
    async (type: string) => {
      if (!hand || hand.status !== "active") return;
      setBusy(true);
      try {
        receive(await api.act(hand.id, { type }, hand.version));
      } catch (e) {
        await fail(e);
      } finally {
        setBusy(false);
      }
    },
    [hand, receive, fail],
  );

  /**
   * The table has finished showing `h`: land what it has paid on the balance,
   * and announce it once (`describe` words it; null says nothing). A live
   * hand is announced only for an early payout, a settled one always.
   */
  const shown = useCallback(
    (h: HandRow | null, describe: (h: HandRow) => Announcement = resultText) => {
      if (!h) return;
      const p = payout.current;
      if (p?.id === h.id) {
        payout.current = null;
        seen.current = { id: h.id, back: p.back };
        setBalance(p.balance, p.progress);
      }
      const key = `${h.id}:${h.status}`;
      if (fresh.current.has(h.id) && !announced.current.has(key)) {
        const r = describe(h);
        if (r) {
          announced.current.add(key);
          toast(r.text, r.tone);
          if (r.tone === "win") buzz([10, 40, 10]);
        }
      }
      if (p?.id === h.id && p.completed.length) {
        for (const c of p.completed) toast(`${c.kind === "achievement" ? "Achievement" : "Quest"} done: ${c.text}`, "win");
        setClaimable((n) => n + p.completed.length);
      }
    },
    [setBalance, setClaimable, toast],
  );

  return { hand, resuming, busy, start, act, shown, live: hand?.status === "active" };
}

type Progress = Pick<HandResponse, "xp"> & LevelRow;

const progressOf = (r: HandResponse): Progress => ({
  xp: r.xp,
  level: r.level,
  level_xp: r.level_xp,
  level_xp_needed: r.level_xp_needed,
});

/** "Win +150", "Push", "Lose −100". */
export function resultText(h: HandRow): Announcement {
  if (h.status !== "settled") return null;
  const net = h.returned - h.wagered;
  if (net > 0) return { text: `Win +${chips(net)}`, tone: "win" };
  if (net < 0) return { text: `Lose −${chips(-net)}`, tone: "loss" };
  return { text: "Push", tone: "info" };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** crypto.randomUUID needs a secure context; a phone on a LAN address over http has getRandomValues only. */
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
