import { useEffect, useState } from "react";
import { api, type NotifyMode, type Subscription } from "../api";

export function Subscriptions() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [query, setQuery] = useState("");
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
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded border border-canvas-200 bg-surface p-4">
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
          <label className="block text-xs text-ink-muted">Show in feed</label>
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
          className="rounded bg-brand-500 px-4 py-1.5 text-white hover:brightness-90 disabled:opacity-50"
        >
          Subscribe
        </button>
      </form>
      {error && <p className="text-sm text-brand-600">{error}</p>}

      <div className="space-y-2">
        {subs.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 rounded border border-canvas-200 bg-surface p-3">
            {s.thumbnail_url && <img src={s.thumbnail_url} className="h-10 w-10 rounded-full" />}
            <div className="flex-1 min-w-40 font-medium">{s.channel_title}</div>

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
