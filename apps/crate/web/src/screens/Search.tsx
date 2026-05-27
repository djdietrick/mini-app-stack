import { useEffect, useState } from "react";
import { api, type ArtistResult, type QueueStatusMap, type SearchResult } from "../api";
import { AlbumRow } from "../components/AlbumRow";

const DEBOUNCE_MS = 300;

export function Search(props: { onSelectArtist: (artist: ArtistResult) => void }) {
  const [q, setQ] = useState("");
  const [artists, setArtists] = useState<ArtistResult[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [statusMap, setStatusMap] = useState<QueueStatusMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) {
      setArtists([]);
      setResults([]);
      setStatusMap({});
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const { artists: ar, albums } = await api.search(trimmed);
        if (cancelled) return;
        setArtists(ar);
        setResults(albums);
        if (albums.length === 0) {
          setStatusMap({});
          return;
        }
        const ids = albums.map((r) => r.providerAlbumId);
        const map = await api.queueStatus(ids);
        if (!cancelled) setStatusMap(map);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q]);

  async function add(album: SearchResult) {
    setPending(album.providerAlbumId);
    try {
      await api.addToQueue(album);
      setStatusMap((m) => ({
        ...m,
        [album.providerAlbumId]: {
          status: "queued",
          queueId: m[album.providerAlbumId]?.queueId ?? "",
          rating: m[album.providerAlbumId]?.rating ?? null,
        },
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function requeue(providerAlbumId: string, queueId: string) {
    setPending(providerAlbumId);
    try {
      await api.requeue(queueId);
      setStatusMap((m) => ({
        ...m,
        [providerAlbumId]: { status: "queued", queueId, rating: m[providerAlbumId]?.rating ?? null },
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  const topArtist = artists[0];

  return (
    <div className="space-y-6">
      <div className="relative">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search albums or artists…"
          className="glass w-full px-4 py-2 pr-24 rounded-full focus:outline-none focus:border-[rgba(var(--c1-rgb),0.40)]"
        />
        {loading && (
          <span className="absolute right-10 top-1/2 -translate-y-1/2 text-xs text-neutral-500">
            Searching…
          </span>
        )}
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQ("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 rounded-full text-neutral-400 hover:text-neutral-100 hover:bg-white/5 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      {topArtist && (
        <button
          type="button"
          onClick={() => props.onSelectArtist(topArtist)}
          className="glass w-full flex items-center justify-between gap-3 p-4 rounded-2xl hover:bg-white/[0.08] transition text-left"
        >
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">Artist</div>
            <div className="font-semibold truncate">{topArtist.name}</div>
            {topArtist.genre && (
              <div className="text-sm text-neutral-400 truncate">{topArtist.genre}</div>
            )}
          </div>
          <span className="text-neutral-400 text-sm flex-shrink-0">View albums →</span>
        </button>
      )}

      {results.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {results.map((r) => (
            <AlbumRow
              key={r.providerAlbumId}
              album={r}
              entry={statusMap[r.providerAlbumId]}
              isPending={pending === r.providerAlbumId}
              onAdd={() => add(r)}
              onRequeue={() => {
                const entry = statusMap[r.providerAlbumId];
                if (entry) requeue(r.providerAlbumId, entry.queueId);
              }}
            />
          ))}
        </ul>
      )}

      {!loading && results.length === 0 && !topArtist && q && !error && (
        <div className="text-neutral-500 text-sm">No results. Try another search.</div>
      )}
    </div>
  );
}
