import { useEffect, useRef, useState } from "react";

/**
 * YouTube's embedded player with its rabbit holes covered.
 *
 * The embed can't be told to show no suggestions at all: `rel=0` only limits
 * them to the same channel. So the parts that show them are covered by this
 * component instead, driven by the IFrame API's state events:
 *   - ended: the end-screen grid of videos is replaced by our own card
 *   - paused: the "More videos" shelf is covered, leaving the control bar
 *     free so scrubbing still works
 * Everything else (annotations, the nocookie host, inline playback on iOS) is
 * a player parameter.
 */

interface YTPlayer {
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      host?: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoading: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiLoading ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiLoading = null;
      reject(new Error("could not load the YouTube player"));
    };
    document.head.append(script);
  });
  return apiLoading;
}

// YT.PlayerState
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;

/** Errors where the uploader, not the network, is the reason it won't play here. */
const EMBED_BLOCKED = new Set([101, 150]);

type State = "loading" | "playing" | "paused" | "ended" | "blocked" | "failed";

export function YouTubePlayer({ videoId, onDone }: { videoId: string; onDone: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !mount.current) return;
        // The API replaces the element it's given, so give it a fresh one.
        const el = document.createElement("div");
        mount.current.replaceChildren(el);
        player.current = new YT.Player(el, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onStateChange: ({ data }) => {
              if (data === PLAYING) setState("playing");
              else if (data === PAUSED) setState("paused");
              else if (data === ENDED) setState("ended");
            },
            onError: ({ data }) => setState(EMBED_BLOCKED.has(data) ? "blocked" : "failed"),
          },
        });
      })
      .catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
    };
  }, [videoId]);

  const play = () => player.current?.playVideo();
  const replay = () => {
    player.current?.seekTo(0, true);
    player.current?.playVideo();
  };

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black sm:rounded-xl">
      <div ref={mount} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />

      {state === "paused" && (
        // Stops short of the control bar (about 48px) so it stays usable.
        <button
          onClick={play}
          aria-label="Play"
          className="absolute inset-x-0 top-0 bottom-12 flex items-center justify-center bg-black/60"
        >
          <PlayIcon />
        </button>
      )}

      {state === "ended" && (
        <Cover>
          <p className="text-lg font-medium">That's the end.</p>
          <div className="mt-4 flex gap-3">
            <button onClick={replay} className="rounded-full bg-white/15 px-4 py-2 text-sm hover:bg-white/25">
              Replay
            </button>
            <button onClick={onDone} className="rounded-full bg-white px-4 py-2 text-sm font-medium text-ink">
              Back to feed
            </button>
          </div>
        </Cover>
      )}

      {(state === "blocked" || state === "failed") && (
        <Cover>
          <p className="max-w-sm text-center text-sm">
            {state === "blocked"
              ? "The uploader doesn't allow this video to play outside YouTube."
              : "The player couldn't load this video."}
          </p>
          <a
            href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-medium text-ink"
          >
            Watch on YouTube
          </a>
        </Cover>
      )}
    </div>
  );
}

function Cover({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black p-6 text-white">
      {children}
    </div>
  );
}

function PlayIcon() {
  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-ink shadow-lg">
      <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7" fill="currentColor" aria-hidden>
        <path d="M8 5.5v13l11-6.5z" />
      </svg>
    </span>
  );
}
