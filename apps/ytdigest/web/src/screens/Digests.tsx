import { useEffect, useState } from "react";
import { api, type DigestDetail, type DigestRun } from "../api";

export function Digests() {
  const [runs, setRuns] = useState<DigestRun[]>([]);
  const [expanded, setExpanded] = useState<Record<string, DigestDetail>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.digests().then(setRuns);
  useEffect(() => {
    load();
  }, []);

  const runNow = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await api.runDigestNow();
      setStatus(result.sent ? `Sent — ${result.itemCount} video(s).` : "Nothing new to send.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "failed to send digest");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: string) => {
    if (expanded[id]) {
      const next = { ...expanded };
      delete next[id];
      setExpanded(next);
      return;
    }
    const detail = await api.digest(id);
    setExpanded({ ...expanded, [id]: detail });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={runNow}
          disabled={busy}
          className="rounded bg-brand-500 px-4 py-1.5 text-white hover:bg-brand-600 disabled:opacity-50"
        >
          Run digest now
        </button>
        {status && <span className="text-sm text-ink-muted">{status}</span>}
      </div>

      <div className="space-y-2">
        {runs.map((r) => (
          <div key={r.id} className="rounded border border-canvas-200 bg-white p-3">
            <button className="flex w-full items-center gap-3 text-left" onClick={() => toggle(r.id)}>
              <span className="font-medium">{r.run_date}</span>
              <span className="rounded-full bg-canvas-100 px-2 py-0.5 text-xs text-ink-muted">{r.cadence}</span>
              <span className="text-sm text-ink-muted">{r.item_count} video(s)</span>
              {!r.sent_at && <span className="text-xs text-brand-500">not sent</span>}
            </button>
            {expanded[r.id] && (
              <ul className="mt-2 space-y-1 border-t border-canvas-200 pt-2">
                {expanded[r.id].items.map((item) => (
                  <li key={item.video_id} className="text-sm">
                    <a
                      className="font-medium text-ink hover:underline"
                      href={`https://www.youtube.com/watch?v=${item.video_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.title}
                    </a>
                    <span className="text-ink-muted"> — {item.channel_title}</span>
                    {item.reason_json && item.reason_json.length > 0 && (
                      <span className="text-ink-soft"> ({item.reason_json.join("; ")})</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {runs.length === 0 && <p className="text-sm text-ink-muted">No digests sent yet.</p>}
      </div>
    </div>
  );
}
