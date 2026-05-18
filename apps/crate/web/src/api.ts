export interface SearchResult {
  providerAlbumId: string;
  providerArtistId: string;
  title: string;
  artist: string;
  year: number | null;
  artworkUrl: string | null;
  appleMusicUrl: string | null;
  genre: string | null;
}

export interface ArtistResult {
  providerArtistId: string;
  name: string;
  genre: string | null;
  appleMusicUrl: string | null;
}

export interface SearchResponse {
  artists: ArtistResult[];
  albums: SearchResult[];
}

export interface ArtistAlbumsResponse {
  artist: ArtistResult | null;
  albums: SearchResult[];
}

export interface QueueRow {
  id: string;
  status: "queued" | "listened" | "skipped";
  added_at: string;
  listened_at: string | null;
  rating: number | null;
  album_id: string;
  title: string;
  release_year: number | null;
  artwork_url: string | null;
  apple_music_url: string | null;
  genre: string | null;
  artist: string;
}

export interface RandomPick {
  id: string;
  rating: number | null;
  album_id: string;
  title: string;
  release_year: number | null;
  artwork_url: string | null;
  apple_music_url: string | null;
  genre: string | null;
  artist: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (init?.body != null) headers["content-type"] = "application/json";
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export type QueueStatus = "queued" | "listened" | "skipped";
export type QueueStatusMap = Record<
  string,
  { status: QueueStatus; queueId: string; rating: number | null }
>;

export const api = {
  search: (q: string) => request<SearchResponse>(`/search?q=${encodeURIComponent(q)}`),
  artistAlbums: (artistId: string) =>
    request<ArtistAlbumsResponse>(`/artists/${encodeURIComponent(artistId)}/albums`),
  addToQueue: (album: SearchResult) =>
    request<{ albumId: string; queued: boolean }>(`/queue`, {
      method: "POST",
      body: JSON.stringify(album),
    }),
  queue: (status?: QueueStatus) =>
    request<QueueRow[]>(`/queue${status ? `?status=${status}` : ""}`),
  queueStatus: (providerAlbumIds: string[]) =>
    request<QueueStatusMap>(`/queue/status`, {
      method: "POST",
      body: JSON.stringify({ providerAlbumIds }),
    }),
  random: (genre?: string) =>
    request<RandomPick>(
      `/queue/random${genre ? `?genre=${encodeURIComponent(genre)}` : ""}`,
    ),
  genres: (status?: QueueStatus) =>
    request<{ genre: string; count: number }[]>(
      `/queue/genres${status ? `?status=${status}` : ""}`,
    ),
  markListened: (id: string) =>
    request<{ ok: true }>(`/queue/${id}/listened`, { method: "POST" }),
  setRating: (id: string, rating: number | null) =>
    request<{ ok: true }>(`/queue/${id}/rating`, {
      method: "POST",
      body: JSON.stringify({ rating }),
    }),
  skip: (id: string) => request<{ ok: true }>(`/queue/${id}/skip`, { method: "POST" }),
  requeue: (id: string) => request<{ ok: true }>(`/queue/${id}/requeue`, { method: "POST" }),
  remove: (id: string) => request<{ ok: true }>(`/queue/${id}`, { method: "DELETE" }),
};
