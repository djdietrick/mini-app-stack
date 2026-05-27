export interface GenreOption {
  genre: string;
  count: number;
}

export function GenrePicker(props: {
  value: string | null;
  options: GenreOption[];
  onChange: (next: string | null) => void;
  className?: string;
}) {
  const { value, options, onChange, className } = props;
  const total = options.reduce((n, o) => n + o.count, 0);
  // If the current selection is no longer present in options (e.g. last album
  // in that genre was marked listened), keep it visible so the user can see
  // what's selected and pick a different value.
  const merged =
    value && !options.some((o) => o.genre === value)
      ? [...options, { genre: value, count: 0 }]
      : options;
  return (
    <div className={"relative inline-flex items-center " + (className ?? "")}>
      <span className="absolute left-3 text-xs uppercase tracking-wide text-neutral-500 pointer-events-none">
        Genre
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="appearance-none pl-16 pr-8 py-2 rounded-full bg-white/10 backdrop-blur ring-1 ring-white/15 text-sm text-neutral-100 hover:bg-white/15 focus:outline-none focus:ring-[rgba(var(--c1-rgb),0.45)] transition cursor-pointer"
      >
        <option value="" className="bg-neutral-900 text-neutral-100">
          Any ({total})
        </option>
        {merged.map((o) => (
          <option key={o.genre} value={o.genre} className="bg-neutral-900 text-neutral-100">
            {o.genre} ({o.count})
          </option>
        ))}
      </select>
      <svg
        className="absolute right-3 pointer-events-none text-neutral-300"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}
