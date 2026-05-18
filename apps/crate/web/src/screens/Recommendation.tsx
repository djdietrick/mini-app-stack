import { useEffect, useRef, useState } from "react";
import { api, type RandomPick } from "../api";
import { RatingModal, StarDisplay } from "../components/Rating";
import { GenrePicker, type GenreOption } from "../components/GenrePicker";

const GENRE_STORAGE_KEY = "crate:pickGenre";

type RGB = { r: number; g: number; b: number };

export function Recommendation() {
  const [pick, setPick] = useState<RandomPick | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<RandomPick | null>(null);
  const [tint, setTint] = useState<RGB | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [genre, setGenre] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(GENRE_STORAGE_KEY);
  });
  const [genres, setGenres] = useState<GenreOption[]>([]);

  async function load(forGenre: string | null = genre) {
    setLoading(true);
    setError(null);
    setEmpty(false);
    setImgLoaded(false);
    setTint(null);
    try {
      setPick(await api.random(forGenre ?? undefined));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("404")) setEmpty(true);
      else setError(msg);
      setPick(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(genre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setGenres(await api.genres("queued"));
      } catch {
        // Non-fatal: just no picker options.
      }
    })();
  }, []);

  function changeGenre(next: string | null) {
    setGenre(next);
    if (next) window.localStorage.setItem(GENRE_STORAGE_KEY, next);
    else window.localStorage.removeItem(GENRE_STORAGE_KEY);
    void load(next);
  }

  function handleImgLoad() {
    setImgLoaded(true);
    const img = imgRef.current;
    if (!img) return;
    const color = extractDominantColor(img);
    if (color) setTint(color);
  }

  async function markAndPickAnother() {
    if (!pick) return;
    setActing(true);
    try {
      await api.markListened(pick.id);
      setRatingTarget(pick);
      await load(genre);
      try {
        setGenres(await api.genres("queued"));
      } catch {
        // Non-fatal.
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActing(false);
    }
  }

  if (loading && !pick) return <SkeletonHero />;
  if (error) return <div className="text-red-400 text-sm">{error}</div>;
  if (empty)
    return (
      <div className="space-y-4">
        {genres.length > 0 && (
          <div className="flex justify-center pt-2">
            <GenrePicker value={genre} options={genres} onChange={changeGenre} />
          </div>
        )}
        <div className="text-neutral-400 text-center">
          {genre ? (
            <>No queued albums in <span className="text-neutral-200">{genre}</span>.</>
          ) : (
            <>
              Nothing queued yet. Head to{" "}
              <a className="underline" href="#/search">Search & add</a> to put something on the shelf.
            </>
          )}
        </div>
      </div>
    );
  if (!pick) return null;

  const tintCss = tint ? `rgb(${tint.r}, ${tint.g}, ${tint.b})` : "rgb(20, 20, 20)";

  return (
    <>
      <AmbientBackdrop artworkUrl={pick.artwork_url} tintCss={tintCss} ready={imgLoaded} />

      <div className="relative flex justify-center pt-2 pb-1">
        <GenrePicker value={genre} options={genres} onChange={changeGenre} />
      </div>

      <div
        key={pick.id}
        className="relative flex flex-col items-center text-center gap-3 sm:gap-6 py-2 sm:py-6 animate-pickIn"
      >
        {pick.artwork_url ? (
          <img
            ref={imgRef}
            src={pick.artwork_url}
            crossOrigin="anonymous"
            alt=""
            onLoad={handleImgLoad}
            className="w-56 h-56 sm:w-96 sm:h-96 rounded-lg shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] object-cover"
          />
        ) : (
          <div className="w-56 h-56 sm:w-96 sm:h-96 rounded-lg bg-neutral-900" />
        )}

        <div>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
            {pick.title}
          </h2>
          <p className="text-base sm:text-lg text-neutral-300 mt-1.5">
            {pick.artist}
            {pick.release_year ? ` · ${pick.release_year}` : ""}
            {pick.genre ? ` · ${pick.genre}` : ""}
          </p>
          {pick.rating != null && (
            <div className="mt-2 flex justify-center">
              <StarDisplay rating={pick.rating} size={16} />
            </div>
          )}
        </div>

        <div className="w-full max-w-sm flex flex-col gap-3 pb-[env(safe-area-inset-bottom)] sm:pb-0">
          <button
            onClick={markAndPickAnother}
            disabled={acting}
            className="w-full px-6 py-3 rounded-full bg-transparent border-2 border-emerald-400 text-emerald-300 hover:bg-emerald-400/10 hover:text-emerald-200 font-medium transition disabled:opacity-50"
          >
            Listened — pick another
          </button>
          <div className="flex gap-3">
            <button
              onClick={() => load(genre)}
              disabled={acting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-transparent border-2 border-sky-400 text-sky-300 hover:bg-sky-400/10 hover:text-sky-200 text-sm font-medium transition disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
              Skip
            </button>
            {pick.apple_music_url && (
              <a
                href={pick.apple_music_url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-transparent border-2 border-pink-400 text-pink-300 hover:bg-pink-400/10 hover:text-pink-200 text-sm font-medium transition"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                Apple Music
              </a>
            )}
          </div>
        </div>

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
    </>
  );
}

function AmbientBackdrop(props: { artworkUrl: string | null; tintCss: string; ready: boolean }) {
  const { artworkUrl, tintCss, ready } = props;
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-neutral-950">
      {artworkUrl && (
        <img
          src={artworkUrl}
          alt=""
          aria-hidden="true"
          className={
            "absolute inset-0 w-full h-full object-cover scale-125 blur-3xl transition-opacity duration-700 " +
            (ready ? "opacity-60" : "opacity-0")
          }
        />
      )}
      <div
        className="absolute inset-0 transition-colors duration-700"
        style={{ backgroundColor: tintCss, opacity: 0.35 }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/40 via-neutral-950/60 to-neutral-950" />
    </div>
  );
}

function SkeletonHero() {
  return (
    <div className="flex flex-col items-center text-center gap-6 py-6 animate-pulse">
      <div className="w-56 h-56 sm:w-96 sm:h-96 rounded-lg bg-neutral-900" />
      <div className="space-y-2">
        <div className="h-8 w-64 bg-neutral-900 rounded" />
        <div className="h-5 w-40 bg-neutral-900 rounded mx-auto" />
      </div>
      <div className="h-10 w-60 bg-neutral-900 rounded-full" />
    </div>
  );
}

function extractDominantColor(img: HTMLImageElement): RGB | null {
  try {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 128) continue;
      const pr = data[i];
      const pg = data[i + 1];
      const pb = data[i + 2];
      const max = Math.max(pr, pg, pb);
      const min = Math.min(pr, pg, pb);
      // Skip near-white and near-black pixels so a black border / white frame
      // doesn't dominate the average.
      if (max < 20 || min > 235) continue;
      r += pr;
      g += pg;
      b += pb;
      count++;
    }
    if (count === 0) return null;
    return {
      r: Math.round(r / count),
      g: Math.round(g / count),
      b: Math.round(b / count),
    };
  } catch {
    // getImageData can throw if the image is tainted (CORS). Fail silent;
    // the tint just stays neutral.
    return null;
  }
}
