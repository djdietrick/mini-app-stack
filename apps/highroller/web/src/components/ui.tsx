import type { ReactNode } from "react";

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="font-display text-[28px] font-bold leading-tight">{children}</h1>
      {sub && <p className="mt-1 text-[15px] text-muted">{sub}</p>}
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-4 px-4 py-3">
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="focus-ring h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full bg-line transition before:block before:h-6 before:w-6 before:translate-x-0.5 before:rounded-full before:bg-ink before:transition checked:bg-gold checked:before:translate-x-[22px] checked:before:bg-gold-ink"
      />
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex min-h-[56px] items-center justify-between gap-4 px-4 py-3">
      <span className="text-[15px] font-medium">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-xl border border-line bg-ground p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={
              "focus-ring min-h-[40px] rounded-[10px] px-3 text-[14px] " +
              (value === o.value ? "bg-raised font-semibold text-gold-light" : "text-muted")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="card flex items-center justify-between gap-3 border-loss/40 p-4 text-[15px]">
      <span className="text-loss">Couldn't load: {error.message}</span>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
