import { useEffect, useState } from "react";

export function StarDisplay(props: { rating: number | null; size?: number }) {
  const { rating, size = 12 } = props;
  if (!rating) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-300" aria-label={`Rated ${rating} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} filled={n <= rating} size={size} />
      ))}
    </span>
  );
}

export function RatingModal(props: {
  open: boolean;
  title: string;
  artist: string;
  initialRating: number | null;
  onSave: (rating: number | null) => Promise<void> | void;
  onClose: () => void;
  /** Label for the secondary dismiss button (e.g. "Skip" when prompting after listen). */
  dismissLabel?: string;
}) {
  const { open, title, artist, initialRating, onSave, onClose, dismissLabel } = props;
  const [value, setValue] = useState<number | null>(initialRating);
  const [hover, setHover] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialRating);
      setHover(null);
    }
  }, [open, initialRating]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const display = hover ?? value ?? 0;

  async function save(next: number | null) {
    setSaving(true);
    try {
      await onSave(next);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm rounded-xl bg-neutral-900 border border-neutral-800 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm text-neutral-400">Rate this album</div>
        <div className="mt-1 text-lg font-semibold tracking-tight truncate">{title}</div>
        <div className="text-sm text-neutral-400 truncate">{artist}</div>

        <div
          className="mt-5 flex items-center gap-1.5"
          onMouseLeave={() => setHover(null)}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onClick={() => setValue(n)}
              className="p-1 rounded text-amber-300 hover:text-amber-200 transition"
            >
              <Star filled={n <= display} size={28} />
            </button>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          {value != null ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => save(null)}
              className="text-xs text-neutral-400 hover:text-neutral-200 transition disabled:opacity-50"
            >
              Clear rating
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-sm text-neutral-300 hover:bg-neutral-800 transition disabled:opacity-50"
            >
              {dismissLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              disabled={saving || value == null}
              onClick={() => save(value)}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-amber-500 text-neutral-950 hover:bg-amber-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Star(props: { filled: boolean; size: number }) {
  const { filled, size } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={filled ? "" : "text-neutral-600"}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
