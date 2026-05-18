import { useEffect, useState } from "react";
import {
  api,
  type ArtistResult,
  type QueueStatusMap,
  type SearchResult,
} from "../api";
import { AlbumRow } from "../components/AlbumRow";

export function Artist(props: { artist: ArtistResult; onBack: () => void }) {
  const { artist, onBack } = props;
  const [albums, setAlbums] = useState<SearchResult[]>([]);
  const [statusMap, setStatusMap] = useState<QueueStatusMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { albums: list } = await api.artistAlbums(artist.providerArtistId);
        if (cancelled) return;
        setAlbums(list);
        if (list.length === 0) {
          setStatusMap({});
          return;
        }
        const ids = list.map((a) => a.providerAlbumId);
        const map = await api.queueStatus(ids);
        if (!cancelled) setStatusMap(map);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artist.providerArtistId]);

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
        [providerAlbumId]: {
          status: "queued",
          queueId,
          rating: m[providerAlbumId]?.rating ?? null,
        },
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-100 transition"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to search
        </button>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">Artist</div>
        <h2 className="text-2xl font-semibold tracking-tight">{artist.name}</h2>
        {artist.genre && <div className="text-sm text-neutral-400 mt-1">{artist.genre}</div>}
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}
      {loading && <div className="text-neutral-500 text-sm">Loading albums…</div>}

      {!loading && albums.length === 0 && !error && (
        <div className="text-neutral-500 text-sm">No albums found for this artist.</div>
      )}

      {albums.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {albums.map((a) => (
            <AlbumRow
              key={a.providerAlbumId}
              album={a}
              entry={statusMap[a.providerAlbumId]}
              isPending={pending === a.providerAlbumId}
              showArtist={false}
              onAdd={() => add(a)}
              onRequeue={() => {
                const entry = statusMap[a.providerAlbumId];
                if (entry) requeue(a.providerAlbumId, entry.queueId);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
