import type { QueueStatusMap, SearchResult } from "../api";
import { StarDisplay } from "./Rating";

export function AlbumRow(props: {
  album: SearchResult;
  entry: QueueStatusMap[string] | undefined;
  isPending: boolean;
  showArtist?: boolean;
  onAdd: () => void;
  onRequeue: () => void;
}) {
  const { album, entry, isPending, showArtist = true, onAdd, onRequeue } = props;
  return (
    <li className="flex gap-3 p-3 rounded-2xl glass">
      {album.artworkUrl ? (
        <img
          src={album.artworkUrl}
          alt=""
          className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-16 h-16 rounded-lg bg-white/5 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{album.title}</div>
        <div className="text-sm text-neutral-400 truncate">
          {showArtist ? album.artist : null}
          {showArtist && album.year ? " · " : ""}
          {album.year ?? ""}
          {(showArtist || album.year) && album.genre ? " · " : ""}
          {album.genre ?? ""}
        </div>
        {entry?.status === "listened" && entry.rating != null && (
          <div className="mt-1">
            <StarDisplay rating={entry.rating} />
          </div>
        )}
      </div>
      <div className="self-center flex items-center gap-2">
        <ResultAction
          entry={entry}
          isPending={isPending}
          onAdd={onAdd}
          onRequeue={onRequeue}
        />
      </div>
    </li>
  );
}

function ResultAction(props: {
  entry: QueueStatusMap[string] | undefined;
  isPending: boolean;
  onAdd: () => void;
  onRequeue: () => void;
}) {
  const { entry, isPending, onAdd, onRequeue } = props;

  if (!entry) {
    return (
      <button
        onClick={onAdd}
        disabled={isPending}
        className="btn-themed px-3 py-1 rounded-full text-sm disabled:opacity-50"
      >
        {isPending ? "…" : "Add"}
      </button>
    );
  }

  if (entry.status === "queued") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs chip-queued">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        In queue
      </span>
    );
  }

  if (entry.status === "listened") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs chip-listened">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        Listened
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs chip-skipped">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 4 15 12 5 20 5 4" />
          <line x1="19" y1="5" x2="19" y2="19" />
        </svg>
        Skipped
      </span>
      <button
        type="button"
        onClick={onRequeue}
        disabled={isPending}
        aria-label="Re-add to queue"
        title="Re-add to queue"
        className="inline-flex items-center justify-center w-7 h-7 rounded-full chip-queued hover:brightness-125 transition disabled:opacity-50"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
          <polyline points="21 3 21 8 16 8" />
          <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
          <polyline points="3 21 3 16 8 16" />
        </svg>
      </button>
    </div>
  );
}
