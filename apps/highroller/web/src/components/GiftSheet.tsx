import { useState } from "react";
import { ApiError, api } from "../api";
import { chips } from "../format";
import { Sheet } from "../games/TableFrame";
import { usePlayer } from "../player";
import { buzz } from "../settings";
import { uuid } from "../uuid";
import { useToast } from "./Toast";

const AMOUNTS = [100, 500, 1_000, 2_500, 5_000];
const MESSAGE_MAX = 140;

const REFUSALS: Record<string, string> = {
  NO_SUCH_PLAYER: "No player with that email. They need to have played Highroller, and be on the leaderboards.",
  SELF_GIFT: "That's you. Gifts go to other players.",
  OVER_SEND_CAP: "That's more than you can send today.",
  OVER_RECEIVE_CAP: "They've had all the gifts they can take today. Try tomorrow.",
  BELOW_FLOOR: "You can't gift yourself below the top-up floor.",
};

/**
 * Send chips to a player: by email from More, or to a leaderboard row's
 * player (`to`). The gift id is made once per sheet, so a send retried after
 * a dropped response lands once; a refused send stored nothing, so the same id
 * is fine for the next try.
 */
export function GiftSheet({ to, onClose }: { to?: { userId: string; name: string }; onClose: () => void }) {
  const { player, setBalance, reload } = usePlayer();
  const toast = useToast();
  const [id] = useState(uuid);
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  if (!player) return null;

  const g = player.gifting;
  const left = Math.max(0, g.send_limit - g.sent_today);
  const spare = Math.max(0, player.balance - g.floor);
  const most = Math.min(left, spare);
  const recipient = to ? { userId: to.userId } : { email: email.trim() };
  const ready = amount !== null && amount <= most && (to || /^\S+@\S+\.\S+$/.test(email.trim()));

  async function send() {
    if (!ready || amount === null) return;
    setBusy(true);
    setRefusal(null);
    try {
      const res = await api.gift({ id, to: recipient, amount, message: message.trim() || undefined });
      setBalance(res.balance);
      // `gifting.sent_today` is on /me; reload so the next sheet knows what's left.
      reload();
      buzz([10, 40, 10]);
      toast(`Sent ${chips(res.gift.amount)} to ${res.gift.to_name}`, "win");
      onClose();
    } catch (e) {
      setRefusal(e instanceof ApiError ? (REFUSALS[e.code] ?? "Couldn't send the gift.") : "Couldn't send the gift.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={to ? `Gift chips to ${to.name}` : "Gift chips"} onClose={onClose}>
      {!to && (
        <label className="flex flex-col gap-1.5">
          <span className="label-caps">Their email</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@example.com"
            className="focus-ring min-h-[48px] rounded-xl border border-line bg-ground px-3 text-[16px]"
          />
          <span className="text-[13px] text-muted">They need to have played Highroller.</span>
        </label>
      )}

      <fieldset>
        <legend className="label-caps mb-1.5">Amount</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={amount === a}
              disabled={a > most}
              onClick={() => setAmount(a)}
              className={
                "focus-ring min-h-[48px] rounded-xl border font-mono text-[14px] font-bold disabled:opacity-40 " +
                (amount === a ? "border-gold bg-gold/15 text-gold-light" : "border-line bg-raised")
              }
            >
              {a >= 1_000 ? `${a / 1_000}K` : a}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[13px] text-muted">
          {left > 0
            ? `You can send ${chips(left)} more today, and keep at least ${chips(g.floor)}.`
            : "You've sent all you can today. It resets at midnight."}
        </p>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="label-caps">Message (optional)</span>
        <textarea
          value={message}
          maxLength={MESSAGE_MAX}
          rows={2}
          onChange={(e) => setMessage(e.target.value)}
          className="focus-ring rounded-xl border border-line bg-ground px-3 py-2 text-[16px]"
        />
        <span className="self-end font-mono text-[11px] text-faint">
          {message.length}/{MESSAGE_MAX}
        </span>
      </label>

      {refusal && (
        <p role="alert" className="text-[14px] text-loss">
          {refusal}
        </p>
      )}
      <button type="button" className="btn-primary" disabled={!ready || busy} onClick={() => void send()}>
        {busy ? "Sending…" : amount ? `Send ${chips(amount)}` : "Pick an amount"}
      </button>
    </Sheet>
  );
}
