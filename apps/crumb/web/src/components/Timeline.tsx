import type { BakeStep } from "../../../src/fermentation/index.js";
import { duration, time, when } from "../format";

/**
 * A bake's steps down a line: done ones struck through at the time they were
 * done, the current one highlighted, and any that land in the night flagged.
 * Times are shown with the day whenever it changes from the previous step.
 */
export function Timeline({
  steps,
  currentId,
  night = [],
  compact = false,
}: {
  steps: readonly BakeStep[];
  currentId?: string | null;
  night?: readonly string[];
  compact?: boolean;
}) {
  let lastDay = "";
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => {
        // A finished step shows when it was finished, which keeps the times
        // in order when steps were done early or late.
        const at = s.done_at ?? s.start_at;
        const dayLabel = new Date(at).toDateString();
        const showDay = dayLabel !== lastDay;
        lastDay = dayLabel;
        const done = s.done_at !== null;
        const current = s.id === currentId;
        const atNight = night.includes(s.id);
        return (
          <li key={s.id} className="grid grid-cols-[4.75rem_1.25rem_minmax(0,1fr)] gap-x-2">
            <div className="whitespace-pre-line pt-0.5 text-right font-mono text-[12px] font-semibold leading-tight text-muted">
              {showDay ? when(at).replace(" ", "\n") : time(at)}
            </div>
            <div className="flex flex-col items-center">
              <span
                className={
                  "mt-1 h-3 w-3 shrink-0 rounded-full border-2 " +
                  (done ? "border-live bg-live" : current ? "border-crust bg-crust ring-4 ring-crust-soft" : "border-muted bg-ground")
                }
              />
              {i < steps.length - 1 && <span className="w-px flex-1 bg-line" />}
            </div>
            <div className={"min-w-0 pb-4 " + (done ? "text-muted line-through" : "")}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold">{s.label}</span>
                <span className="text-sm text-muted">{duration(s.minutes)}</span>
                {atNight && !done && <span className="pill bg-warn-soft text-warn">Night</span>}
              </div>
              {!compact && s.detail && !done && <p className="mt-0.5 text-sm text-muted">{s.detail}</p>}
              {!compact && s.folds && !done && (
                <p className="mt-0.5 text-sm text-muted">
                  {s.folds.count} sets of stretch and folds, every {s.folds.every} min
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
