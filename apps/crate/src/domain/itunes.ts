import type { CacheStore } from "@stack/service-kit";

export interface NormalizedAlbum {
  providerAlbumId: string;
  providerArtistId: string;
  title: string;
  artist: string;
  year: number | null;
  artworkUrl: string | null;
  appleMusicUrl: string | null;
  genre: string | null;
}

export interface NormalizedArtist {
  providerArtistId: string;
  name: string;
  genre: string | null;
  appleMusicUrl: string | null;
}

export interface SearchResponse {
  artists: NormalizedArtist[];
  albums: NormalizedAlbum[];
}

interface ITunesAlbumResult {
  wrapperType?: string;
  collectionType?: string;
  collectionId: number;
  artistId: number;
  collectionName: string;
  artistName: string;
  releaseDate?: string;
  artworkUrl100?: string;
  collectionViewUrl?: string;
  primaryGenreName?: string;
  trackCount?: number;
}

interface ITunesArtistResult {
  wrapperType?: string;
  artistType?: string;
  artistId: number;
  artistName: string;
  primaryGenreName?: string;
  artistLinkUrl?: string;
}

interface ITunesAlbumResponse {
  resultCount: number;
  results: ITunesAlbumResult[];
}

interface ITunesArtistResponse {
  resultCount: number;
  results: ITunesArtistResult[];
}

interface ITunesLookupResponse {
  resultCount: number;
  results: Array<ITunesAlbumResult | ITunesArtistResult>;
}

const CACHE_TTL_SECONDS = 60 * 60 * 24;
const SEARCH_LIMIT = 25;
const ARTIST_SEARCH_LIMIT = 5;
const ARTIST_ALBUMS_LIMIT = 200;

function normalizeAlbum(raw: ITunesAlbumResult): NormalizedAlbum {
  return {
    providerAlbumId: String(raw.collectionId),
    providerArtistId: String(raw.artistId),
    title: raw.collectionName,
    artist: raw.artistName,
    year: raw.releaseDate ? Number(raw.releaseDate.slice(0, 4)) || null : null,
    // Bump to a larger thumbnail; iTunes serves these as 100x100 by default.
    artworkUrl: raw.artworkUrl100 ? raw.artworkUrl100.replace("100x100", "600x600") : null,
    appleMusicUrl: raw.collectionViewUrl ?? null,
    genre: raw.primaryGenreName ?? null,
  };
}

function normalizeArtist(raw: ITunesArtistResult): NormalizedArtist {
  return {
    providerArtistId: String(raw.artistId),
    name: raw.artistName,
    genre: raw.primaryGenreName ?? null,
    appleMusicUrl: raw.artistLinkUrl ?? null,
  };
}

async function search(query: string, cache: CacheStore): Promise<SearchResponse> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return { artists: [], albums: [] };

  const cacheKey = `search:v3:${trimmed}`;
  const cached = await cache.get<SearchResponse>(cacheKey);
  if (cached) return cached;

  const albumUrl = new URL("https://itunes.apple.com/search");
  albumUrl.searchParams.set("entity", "album");
  albumUrl.searchParams.set("limit", String(SEARCH_LIMIT));
  albumUrl.searchParams.set("term", trimmed);

  const artistUrl = new URL("https://itunes.apple.com/search");
  artistUrl.searchParams.set("entity", "musicArtist");
  artistUrl.searchParams.set("limit", String(ARTIST_SEARCH_LIMIT));
  artistUrl.searchParams.set("term", trimmed);

  const [albumRes, artistRes] = await Promise.all([fetch(albumUrl), fetch(artistUrl)]);
  if (!albumRes.ok) throw new Error(`iTunes album search failed: ${albumRes.status}`);
  if (!artistRes.ok) throw new Error(`iTunes artist search failed: ${artistRes.status}`);

  const albumData = (await albumRes.json()) as ITunesAlbumResponse;
  const artistData = (await artistRes.json()) as ITunesArtistResponse;

  const response: SearchResponse = {
    artists: artistData.results.map(normalizeArtist),
    albums: albumData.results.map(normalizeAlbum),
  };
  await cache.set(cacheKey, response, CACHE_TTL_SECONDS);
  return response;
}

export interface ArtistAlbumsResponse {
  artist: NormalizedArtist | null;
  albums: NormalizedAlbum[];
}

async function getArtistAlbums(
  artistId: string,
  cache: CacheStore,
): Promise<ArtistAlbumsResponse> {
  const cacheKey = `artist:v1:${artistId}`;
  const cached = await cache.get<ArtistAlbumsResponse>(cacheKey);
  if (cached) return cached;

  const url = new URL("https://itunes.apple.com/lookup");
  url.searchParams.set("id", artistId);
  url.searchParams.set("entity", "album");
  url.searchParams.set("limit", String(ARTIST_ALBUMS_LIMIT));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes artist lookup failed: ${res.status}`);
  const data = (await res.json()) as ITunesLookupResponse;

  let artist: NormalizedArtist | null = null;
  const albums: NormalizedAlbum[] = [];
  for (const r of data.results) {
    if ("artistType" in r || r.wrapperType === "artist") {
      artist = normalizeArtist(r as ITunesArtistResult);
    } else if (r.wrapperType === "collection" || "collectionId" in r) {
      const a = r as ITunesAlbumResult;
      // Drop singles (one track); keep albums + EPs + compilations.
      if (a.trackCount != null && a.trackCount <= 1) continue;
      albums.push(normalizeAlbum(a));
    }
  }

  albums.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  const response: ArtistAlbumsResponse = { artist, albums };
  await cache.set(cacheKey, response, CACHE_TTL_SECONDS);
  return response;
}

/**
 * Bundles the cache so routes take a plain gateway. Backed by Redis
 * self-hosted and by Firestore-with-a-TTL-policy in Cloud Functions, where
 * there is no Redis to reach.
 */
export interface ItunesGateway {
  search(query: string): Promise<SearchResponse>;
  artistAlbums(artistId: string): Promise<ArtistAlbumsResponse>;
}

export function createItunesGateway(cache: CacheStore): ItunesGateway {
  return {
    search: (query) => search(query, cache),
    artistAlbums: (artistId) => getArtistAlbums(artistId, cache),
  };
}
