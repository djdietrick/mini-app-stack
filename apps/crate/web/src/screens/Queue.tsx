import { useEffect, useMemo, useRef, useState } from "react";
import { api, type QueueRow } from "../api";
import { RatingModal } from "../components/Rating";
import { GenrePicker, type GenreOption } from "../components/GenrePicker";

const GENRE_STORAGE_KEY = "crate:queueGenre";

export function Queue() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [filter, setFilter] = useState("");
  const [genre, setGenre] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(GENRE_STORAGE_KEY);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ratingTarget, setRatingTarget] = useState<QueueRow | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.queue("queued"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!openId) return;
    const onDocClick = (e: MouseEvent) => {
      if (!listRef.current) return;
      if (!listRef.current.contains(e.target as Node)) setOpenId(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openId]);

  async function act(row: QueueRow, action: "listened" | "skip" | "remove") {
    if (action === "remove" && !confirm("Remove this album from the queue?")) return;
    setBusy(row.id);
    try {
      if (action === "listened") await api.markListened(row.id);
      else if (action === "skip") await api.skip(row.id);
      else await api.remove(row.id);
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      setOpenId(null);
      if (action === "listened") setRatingTarget(row);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const genreOptions: GenreOption[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!r.genre) continue;
      counts.set(r.genre, (counts.get(r.genre) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([g, count]) => ({ genre: g, count }))
      .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
  }, [rows]);

  function changeGenre(next: string | null) {
    setGenre(next);
    if (next) window.localStorage.setItem(GENRE_STORAGE_KEY, next);
    else window.localStorage.removeItem(GENRE_STORAGE_KEY);
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (genre && r.genre !== genre) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || r.artist.toLowerCase().includes(q);
    });
  }, [rows, filter, genre]);

  if (loading) return <div className="text-neutral-500 text-sm">Loading…</div>;
  if (error) return <div className="text-red-400 text-sm">{error}</div>;
  if (rows.length === 0)
    return (
      <div className="text-neutral-500 text-sm">
        Queue is empty. Use <a className="underline" href="#/search">Search & add</a> to find
        something.
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter queue by title or artist…"
          className="glass flex-1 min-w-[12rem] px-4 py-2 rounded-full focus:outline-none focus:border-[rgba(var(--c1-rgb),0.40)]"
        />
        {(genreOptions.length > 0 || genre) && (
          <GenrePicker value={genre} options={genreOptions} onChange={changeGenre} />
        )}
        <div className="text-xs text-neutral-500 whitespace-nowrap">
          {visible.length} of {rows.length}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-neutral-500 text-sm">No matches for "{filter}".</div>
      ) : (
        <ul ref={listRef} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visible.map((r) => {
            const isOpen = openId === r.id;
            const isBusy = busy === r.id;
            return (
              <li
                key={r.id}
                onClick={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
                className={
                  "group relative flex gap-3 p-3 rounded-2xl glass transition cursor-pointer overflow-hidden " +
                  "hover:bg-white/[0.08] hover:shadow-lg hover:shadow-black/40"
                }
              >
                {r.artwork_url ? (
                  <img
                    src={r.artwork_url}
                    alt=""
                    className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-white/5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.title}</div>
                  <div className="text-sm text-neutral-400 truncate">
                    {r.artist}
                    {r.release_year ? ` · ${r.release_year}` : ""}
                    {r.genre ? ` · ${r.genre}` : ""}
                  </div>
                </div>

                <div
                  className={
                    "absolute inset-0 flex items-center justify-center gap-3 rounded-2xl " +
                    "bg-black/40 backdrop-blur-md transition-opacity duration-150 " +
                    (isOpen
                      ? "opacity-100"
                      : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto")
                  }
                  onClick={(e) => e.stopPropagation()}
                >
                  <ActionCircle
                    label="Mark listened"
                    tone="primary"
                    disabled={isBusy}
                    onClick={() => act(r, "listened")}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </ActionCircle>
                  <ActionCircle
                    label="Skip"
                    tone="ghost"
                    disabled={isBusy}
                    onClick={() => act(r, "skip")}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 4 15 12 5 20 5 4" />
                      <line x1="19" y1="5" x2="19" y2="19" />
                    </svg>
                  </ActionCircle>
                  <ActionCircle
                    label="Remove"
                    tone="danger"
                    disabled={isBusy}
                    onClick={() => act(r, "remove")}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                    </svg>
                  </ActionCircle>
                  {r.apple_music_url && (
                    <ActionCircle
                      label="Open in Apple Music"
                      tone="external"
                      href={r.apple_music_url}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </ActionCircle>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RatingModal
        open={ratingTarget != null}
        title={ratingTarget?.title ?? ""}
        artist={ratingTarget?.artist ?? ""}
        initialRating={ratingTarget?.rating ?? null}
        dismissLabel="Skip"
        onClose={() => setRatingTarget(null)}
        onSave={async (rating) => {
          if (!ratingTarget) return;
          try {
            await api.setRating(ratingTarget.id, rating);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
    </div>
  );
}

type Tone = "primary" | "ghost" | "danger" | "external";

const toneClasses: Record<Tone, string> = {
  primary:
    "bg-[rgba(var(--c2-rgb),0.18)] text-[var(--c2-ink)] ring-[rgba(var(--c2-rgb),0.40)] hover:bg-[rgba(var(--c2-rgb),0.30)]",
  ghost:
    "bg-white/10 text-neutral-100 ring-white/15 hover:bg-white/20",
  danger:
    "bg-red-500/15 text-red-300 ring-red-400/30 hover:bg-red-500/25 hover:text-red-200",
  external:
    "bg-[rgba(var(--c3-rgb),0.18)] text-[var(--c3-ink)] ring-[rgba(var(--c3-rgb),0.40)] hover:bg-[rgba(var(--c3-rgb),0.30)]",
};

function ActionCircle(props: {
  label: string;
  tone: Tone;
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const cls =
    "inline-flex items-center justify-center w-10 h-10 rounded-full ring-1 backdrop-blur-sm transition " +
    "disabled:opacity-40 disabled:cursor-not-allowed " +
    toneClasses[props.tone];
  if (props.href) {
    return (
      <a
        href={props.href}
        target="_blank"
        rel="noreferrer"
        aria-label={props.label}
        title={props.label}
        className={cls}
      >
        {props.children}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cls}
    >
      {props.children}
    </button>
  );
}
