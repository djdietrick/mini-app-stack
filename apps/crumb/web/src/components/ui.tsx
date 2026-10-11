import { type ReactNode, useEffect, useState } from "react";

/** Small pieces every screen uses. */

export function PageTitle({ children, sub, action }: { children: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-balance font-display text-3xl font-bold leading-tight">{children}</h1>
        {sub && <p className="mt-1 text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-7 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="label-caps">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Loading() {
  return <p className="py-10 text-center text-muted">Loading…</p>;
}

export function ErrorNote({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="card flex items-center justify-between gap-3 border-warn/40 bg-warn-soft p-4 text-warn" role="alert">
      <span>{error.message}</span>
      {retry && (
        <button type="button" className="btn" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-start gap-3 border-dashed p-5">
      <h3 className="font-display text-xl font-bold">{title}</h3>
      {children && <p className="text-muted">{children}</p>}
      {action}
    </div>
  );
}

export type Tone = "live" | "crust" | "muted" | "warn";

const TONES: Record<Tone, string> = {
  live: "bg-live-soft text-live",
  crust: "bg-crust-soft text-crust",
  muted: "bg-raised text-muted",
  warn: "bg-warn-soft text-warn",
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill ${TONES[tone]}`}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-bold">{label}</span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl border border-line bg-raised p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={
            "focus-ring min-h-[40px] flex-1 rounded-lg px-2 font-mono text-[13px] font-semibold " +
            (o.value === value ? "bg-ink text-ground" : "text-muted")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Re-renders every `ms` so relative times and timers stay current. */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Runs an async action, exposing whether it is in flight and its last error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e as Error);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, clear: () => setError(null) };
}
