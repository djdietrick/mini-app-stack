import type { ReactNode } from "react";
import { type Route, href } from "../router";

/**
 * Phone first: one column with a bottom tab bar in thumb reach. Wider screens
 * keep the same column, centred, with the tabs moved up beside the title;
 * nothing here needs more width than a phone gives it.
 */

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

const TABS: { route: Route; label: string; icon: ReactNode; owns: Route["name"][] }[] = [
  {
    route: { name: "today" },
    label: "Today",
    icon: icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
    owns: ["today"],
  },
  {
    route: { name: "starters" },
    label: "Starter",
    icon: icon(<><path d="M7 4h10M8 4v3a2 2 0 0 1-1 1.7A3 3 0 0 0 5.5 11.3V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-7.7A3 3 0 0 0 17 8.7 2 2 0 0 1 16 7V4" /><path d="M5.5 14h13" /></>),
    owns: ["starters", "starter", "starter-new", "starter-edit", "feed"],
  },
  {
    route: { name: "bakes" },
    label: "Bakes",
    icon: icon(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
    owns: ["bakes", "bake", "plan"],
  },
  {
    route: { name: "recipes" },
    label: "Recipes",
    icon: icon(<><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6" /></>),
    owns: ["recipes", "recipe", "recipe-edit"],
  },
];

const GUIDE = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
  </>,
);

const GEAR = icon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
  </>,
);

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const active = (t: (typeof TABS)[number]) => t.owns.includes(route.name);

  return (
    <div className="pl-safe pr-safe flex min-h-[100dvh] flex-col">
      <header className="pt-safe mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 pb-2 md:px-6">
        <a href="#/" className="focus-ring rounded font-display text-2xl font-bold tracking-tight">
          crumb<span className="text-crust">.</span>
        </a>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {TABS.map((t) => (
            <a
              key={t.label}
              href={href(t.route)}
              aria-current={active(t) ? "page" : undefined}
              className={"focus-ring rounded-xl px-3 py-2 text-[15px] font-bold " + (active(t) ? "bg-crust-soft text-crust" : "text-muted hover:text-ink")}
            >
              {t.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center">
          <a
            href={href({ name: "guide" })}
            aria-label="Guide"
            title="Guide"
            aria-current={route.name === "guide" ? "page" : undefined}
            className={"focus-ring flex h-11 w-11 items-center justify-center rounded-xl " + (route.name === "guide" ? "text-crust" : "text-muted")}
          >
            {GUIDE}
          </a>
          <a
            href={href({ name: "settings" })}
            aria-label="Settings"
            title="Settings"
            aria-current={route.name === "settings" ? "page" : undefined}
            className={"focus-ring flex h-11 w-11 items-center justify-center rounded-xl " + (route.name === "settings" ? "text-crust" : "text-muted")}
          >
            {GEAR}
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-2 md:px-6 md:pb-12">{children}</main>

      <nav
        aria-label="Main"
        className="pb-safe pl-safe pr-safe fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-line bg-surface/95 backdrop-blur md:hidden"
      >
        {TABS.map((t) => (
          <a
            key={t.label}
            href={href(t.route)}
            aria-current={active(t) ? "page" : undefined}
            className={"focus-ring flex min-h-[56px] flex-col items-center justify-center gap-1 text-xs font-bold " + (active(t) ? "text-crust" : "text-muted")}
          >
            {t.icon}
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
