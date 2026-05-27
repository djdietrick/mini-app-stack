import { useEffect, useState } from "react";
import { api, type QueueRow } from "../api";
import { RatingModal, StarDisplay } from "../components/Rating";

type Filter = "listened" | "skipped";

export function History() {
  const [filter, setFilter] = useState<Filter>("listened");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ratingTarget, setRatingTarget] = useState<QueueRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .queue(filter)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  async function requeue(id: string) {
    setBusy(id);
    try {
      await api.requeue(id);
      setRows((rs) => rs.filter((r) => r.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["listened", "skipped"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              "px-3 py-1.5 rounded-full text-sm capitalize transition " +
              (filter === f
                ? "chip-queued"
                : "glass text-neutral-400 hover:text-neutral-100")
            }
          >
            {f}
          </button>
        ))}
      </div>

      {loading && <div className="text-neutral-500 text-sm">Loading…</div>}
      {error && <div className="text-red-400 text-sm">{error}</div>}
      {!loading && rows.length === 0 && (
        <div className="text-neutral-500 text-sm">Nothing here yet.</div>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-white/5 rounded-2xl glass">
          {rows.map((r) => (
            <li key={r.id} className="flex gap-3 p-3">
              {r.artwork_url ? (
                <img
                  src={r.artwork_url}
                  alt=""
                  className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-white/5 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{r.title}</div>
                <div className="text-sm text-neutral-400 truncate">
                  {r.artist}
                  {r.release_year ? ` · ${r.release_year}` : ""}
                  {r.genre ? ` · ${r.genre}` : ""}
                </div>
              </div>
              {filter === "listened" && (
                <button
                  type="button"
                  onClick={() => setRatingTarget(r)}
                  aria-label={r.rating != null ? "Edit rating" : "Rate album"}
                  title={r.rating != null ? "Edit rating" : "Rate album"}
                  className="self-center inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs text-amber-200 bg-amber-500/10 ring-1 ring-amber-400/30 hover:bg-amber-500/20 transition"
                >
                  {r.rating != null ? (
                    <StarDisplay rating={r.rating} size={13} />
                  ) : (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      Rate
                    </>
                  )}
                </button>
              )}
              {filter === "skipped" && (
                <button
                  type="button"
                  onClick={() => requeue(r.id)}
                  disabled={busy === r.id}
                  aria-label="Re-add to queue"
                  title="Re-add to queue"
                  className="self-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs chip-queued hover:brightness-125 transition disabled:opacity-50"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
                    <polyline points="21 3 21 8 16 8" />
                    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
                    <polyline points="3 21 3 16 8 16" />
                  </svg>
                  Re-add
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <RatingModal
        open={ratingTarget != null}
        title={ratingTarget?.title ?? ""}
        artist={ratingTarget?.artist ?? ""}
        initialRating={ratingTarget?.rating ?? null}
        onClose={() => setRatingTarget(null)}
        onSave={async (rating) => {
          if (!ratingTarget) return;
          try {
            await api.setRating(ratingTarget.id, rating);
            setRows((rs) =>
              rs.map((row) => (row.id === ratingTarget.id ? { ...row, rating } : row)),
            );
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
    </div>
  );
}
