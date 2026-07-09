import { useEffect, useState } from "react";
import { api, type Cadence, type NotifyMode, type Subscription } from "../api";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function Subscriptions() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [query, setQuery] = useState("");
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [digestDay, setDigestDay] = useState(1);
  const [notifyMode, setNotifyMode] = useState<NotifyMode>("rules");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.subscriptions().then(setSubs);
  useEffect(() => {
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createSubscription({
        query: query.trim(),
        cadence,
        digestDayOfWeek: cadence === "weekly" ? digestDay : undefined,
        notifyMode,
      });
      setQuery("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to subscribe");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded border border-canvas-200 bg-white p-4">
        <div className="flex-1 min-w-64">
          <label className="block text-xs text-ink-muted">Channel (@handle, URL, or search)</label>
          <input
            className="mt-1 w-full rounded border border-canvas-200 px-2 py-1.5"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="@channelname"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-muted">Cadence</label>
          <select
            className="mt-1 rounded border border-canvas-200 px-2 py-1.5"
            value={cadence}
            onChange={(e) => setCadence(e.target.value as Cadence)}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        {cadence === "weekly" && (
          <div>
            <label className="block text-xs text-ink-muted">Day</label>
            <select
              className="mt-1 rounded border border-canvas-200 px-2 py-1.5"
              value={digestDay}
              onChange={(e) => setDigestDay(Number(e.target.value))}
            >
              {DAYS.map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-ink-muted">Notify me on</label>
          <select
            className="mt-1 rounded border border-canvas-200 px-2 py-1.5"
            value={notifyMode}
            onChange={(e) => setNotifyMode(e.target.value as NotifyMode)}
          >
            <option value="rules">matches only</option>
            <option value="all">every upload</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-brand-500 px-4 py-1.5 text-white hover:bg-brand-600 disabled:opacity-50"
        >
          Subscribe
        </button>
      </form>
      {error && <p className="text-sm text-brand-600">{error}</p>}

      <div className="space-y-2">
        {subs.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 rounded border border-canvas-200 bg-white p-3">
            {s.thumbnail_url && <img src={s.thumbnail_url} className="h-10 w-10 rounded-full" />}
            <div className="flex-1 min-w-40 font-medium">{s.channel_title}</div>

            <select
              className="rounded border border-canvas-200 px-2 py-1 text-sm"
              value={s.cadence}
              onChange={async (e) => {
                const cad = e.target.value as Cadence;
                await api.updateSubscription(s.id, {
                  cadence: cad,
                  digestDayOfWeek: cad === "weekly" ? s.digest_day_of_week ?? 1 : null,
                });
                load();
              }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>

            {s.cadence === "weekly" && (
              <select
                className="rounded border border-canvas-200 px-2 py-1 text-sm"
                value={s.digest_day_of_week ?? 1}
                onChange={async (e) => {
                  await api.updateSubscription(s.id, { digestDayOfWeek: Number(e.target.value) });
                  load();
                }}
              >
                {DAYS.map((d, i) => (
                  <option key={i} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            )}

            <select
              className="rounded border border-canvas-200 px-2 py-1 text-sm"
              value={s.notify_mode}
              onChange={async (e) => {
                await api.updateSubscription(s.id, { notifyMode: e.target.value as NotifyMode });
                load();
              }}
            >
              <option value="rules">matches only</option>
              <option value="all">every upload</option>
            </select>

            <button
              className="text-sm text-brand-500 hover:underline"
              onClick={async () => {
                await api.deleteSubscription(s.id);
                load();
              }}
            >
              unsubscribe
            </button>
          </div>
        ))}
        {subs.length === 0 && <p className="text-sm text-ink-muted">No subscriptions yet.</p>}
      </div>
    </div>
  );
}
