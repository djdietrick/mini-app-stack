import { type ReactNode, useEffect, useState } from "react";
import type { TipId } from "../help";
import { useTip } from "./Help";

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

export function Section({
  title,
  action,
  help,
  children,
}: {
  title: string;
  action?: ReactNode;
  /** An ⓘ after the title that explains the section. */
  help?: TipId;
  children: ReactNode;
}) {
  const tip = useTip(help, title);
  return (
    <section className="mb-7 flex flex-col gap-3">
      <div className="-my-2 flex min-h-9 items-center justify-between">
        <div className="flex items-center gap-0.5">
          <h2 className="label-caps">{title}</h2>
          {tip.button}
        </div>
        {action}
      </div>
      {tip.panel}
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

/**
 * A labelled control. `help` adds an ⓘ beside the label. The ⓘ sits outside
 * the <label>, or tapping the label text would open the tip instead of
 * focusing the input. `group` is for a set of buttons (a Segmented): a
 * <label> would forward taps on its text to the first button.
 */
export function Field({
  label,
  hint,
  help,
  group = false,
  children,
}: {
  label: string;
  hint?: ReactNode;
  help?: TipId;
  group?: boolean;
  children: ReactNode;
}) {
  const tip = useTip(help, label);
  const body = (
    <>
      <span className={"min-h-5 text-sm font-bold " + (help ? "pr-8" : "")}>{label}</span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </>
  );
  return (
    // An open tip takes the field to a row of its own, so the text isn't
    // squeezed into one column of a grid.
    <div className={"relative flex min-w-0 flex-col gap-1.5 " + (tip.open ? "col-span-full" : "")}>
      {group ? (
        <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-1.5">
          {body}
        </div>
      ) : (
        <label className="flex min-w-0 flex-col gap-1.5">{body}</label>
      )}
      {tip.button && <div className="absolute -right-1.5 -top-2">{tip.button}</div>}
      {tip.panel}
    </div>
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
