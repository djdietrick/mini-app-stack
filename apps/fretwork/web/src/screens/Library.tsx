import { useState } from "react";
import { api, type Category } from "../api";
import { CATEGORY_LABELS, ENGINE_LABELS, summary } from "../describe";
import { href } from "../router";
import { useApi } from "../useApi";

type Tab = Category | "all";
const TABS: Tab[] = ["all", "notes", "scales", "arpeggios", "ear"];

export function Library() {
  const [tab, setTab] = useState<Tab>("all");
  const exercises = useApi("exercises", api.listExercises);
  const rows = (exercises.data ?? []).filter((e) => tab === "all" || e.category === tab);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Library</h1>
        <a href={href({ name: "build" })} className="btn focus-ring">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New
        </a>
      </div>

      <div role="tablist" aria-label="Category" className="grid grid-cols-5 gap-1 rounded-xl bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={
              "focus-ring min-h-[40px] rounded-lg text-sm font-medium " +
              (tab === t ? "bg-brass text-brass-ink" : "text-ink")
            }
          >
            {t === "all" ? "All" : CATEGORY_LABELS[t]}
          </button>
        ))}
      </div>

      {exercises.loading && !exercises.data && <p className="text-sm text-muted">Loading…</p>}
      {exercises.error && <p className="text-sm text-miss">Couldn't load exercises.</p>}

      <ul className="flex flex-col lg:grid lg:grid-cols-2 lg:gap-3">
        {rows.map((e) => (
          <li key={e.id}>
            <a
              href={href({ name: "exercise", id: e.id })}
              className="focus-ring flex min-h-[64px] items-center gap-3 border-b border-raised py-2 lg:card lg:border lg:p-4"
            >
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-[15px] font-semibold">{e.name}</span>
                <span className="text-[13px] text-muted">{summary(e)}</span>
              </div>
              <span
                className={
                  "rounded-lg bg-surface px-2 py-1 font-mono text-xs " + (e.builtin ? "text-muted" : "text-correct")
                }
              >
                {e.builtin ? ENGINE_LABELS[e.engine] : "Yours"}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
