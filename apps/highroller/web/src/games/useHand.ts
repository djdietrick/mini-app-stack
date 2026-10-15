import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type HandResponse, type HandRow, api } from "../api";
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
 * the cards have turned or the ball has dropped.
 */
export function useHand(game: string) {
  const { setBalance } = usePlayer();
  const toast = useToast();
  const [hand, setHand] = useState<HandRow | null>(null);
  const [resuming, setResuming] = useState(true);
  const [busy, setBusy] = useState(false);
  const payout = useRef<{ id: string; balance: number; xp: number } | null>(null);
  const announced = useRef<string | null>(null);

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
      setHand(res.hand);
      if (res.hand.status === "settled" && res.hand.returned > 0) {
        setBalance(res.balance - res.hand.returned, res.xp);
        payout.current = { id: res.hand.id, balance: res.balance, xp: res.xp };
      } else {
        setBalance(res.balance, res.xp);
      }
    },
    [setBalance],
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
   * The table has finished showing `h`. Once per settled hand: land its
   * payout on the balance and announce the result (`describe` words it).
   */
  const shown = useCallback(
    (h: HandRow | null, describe: (h: HandRow) => { text: string; tone: "win" | "loss" | "info" } = resultText) => {
      if (!h || h.status !== "settled" || announced.current === h.id) return;
      announced.current = h.id;
      const p = payout.current;
      if (p?.id === h.id) {
        payout.current = null;
        setBalance(p.balance, p.xp);
      }
      const r = describe(h);
      toast(r.text, r.tone);
      if (r.tone === "win") buzz([10, 40, 10]);
    },
    [setBalance, toast],
  );

  return { hand, resuming, busy, start, act, shown, live: hand?.status === "active" };
}

/** "Win +150", "Push", "Lose −100". */
export function resultText(h: HandRow): { text: string; tone: "win" | "loss" | "info" } {
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
