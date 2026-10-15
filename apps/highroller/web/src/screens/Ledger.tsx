import { useEffect, useState } from "react";
import { type LedgerKind, type LedgerRow, api } from "../api";
import { ErrorNote, PageTitle } from "../components/ui";
import { chips, signed, when } from "../format";

const LABELS: Record<LedgerKind, string> = {
  initial_grant: "Welcome chips",
  bet: "Bet",
  payout: "Payout",
  daily_bonus: "Daily bonus",
  bailout: "Top-up",
  purchase: "Shop",
  gift_in: "Gift received",
  gift_out: "Gift sent",
  quest_reward: "Quest reward",
  achievement_reward: "Achievement",
  jackpot: "Jackpot",
};

export function Ledger() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(from?: string) {
    setLoading(true);
    try {
      const page = await api.ledger(from);
      setRows((r) => (from ? [...r, ...page.entries] : page.entries));
      setCursor(page.next_cursor);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <PageTitle sub="Every chip in and out, newest first.">Ledger</PageTitle>
      {error && <ErrorNote error={error} onRetry={() => void load(cursor ?? undefined)} />}
      <ul className="card divide-y divide-line">
        {rows.map((r) => (
          <li key={r.seq} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[15px] font-medium">{LABELS[r.kind] ?? r.kind}</span>
              <span className="block text-[13px] text-muted">{when(r.created_at)}</span>
            </span>
            <span className="text-right font-mono">
              <span className={"tabular block text-[15px] font-bold " + (r.amount >= 0 ? "text-win" : "text-loss")}>{signed(r.amount)}</span>
              <span className="tabular block text-[12px] text-faint">{chips(r.balance_after)}</span>
            </span>
          </li>
        ))}
        {!rows.length && !error && <li className="px-4 py-6 text-center text-muted">{loading ? "Loading…" : "Nothing yet."}</li>}
      </ul>
      {cursor && (
        <button type="button" className="btn mt-4 w-full" disabled={loading} onClick={() => void load(cursor)}>
          {loading ? "Loading…" : "Older"}
        </button>
      )}
    </div>
  );
}
