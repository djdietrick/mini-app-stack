import type { ReactNode } from "react";
import { usePlayer } from "../player";
import { type Route, href } from "../router";
import { BalancePill } from "./BalancePill";
import { LevelBadge } from "./LevelBadge";

/**
 * Phone first: one column, the balance pinned in the header, and a bottom
 * tab bar in thumb reach. From `lg` the tabs move into a left rail (icons
 * only until `xl`, then labelled), as in fretwork. Breakpoints live in
 * src/breakpoints.ts. Screens only ever render into `children`; a table
 * screen asks for `bleed` to get the full width under the header.
 */

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const TABS: { route: Route; label: string; icon: ReactNode }[] = [
  {
    route: { name: "lobby" },
    label: "Lobby",
    icon: icon(
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </>,
    ),
  },
  {
    route: { name: "shop" },
    label: "Shop",
    icon: icon(<path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8zM9 8V6.5a3 3 0 0 1 6 0V8" />),
  },
  {
    route: { name: "quests" },
    label: "Quests",
    icon: icon(<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />),
  },
  {
    route: { name: "stats" },
    label: "Stats",
    icon: icon(<path d="M5 20V11M12 20V5M19 20v-6" />),
  },
  {
    route: { name: "more" },
    label: "More",
    icon: icon(
      <>
        <circle cx="5" cy="12" r="1.2" />
        <circle cx="12" cy="12" r="1.2" />
        <circle cx="19" cy="12" r="1.2" />
      </>,
    ),
  },
];

function isActive(tab: Route, current: Route): boolean {
  if (current.name === "ledger" || current.name === "settings" || current.name === "table-demo") return tab.name === "more";
  if (current.name === "play") return tab.name === "lobby";
  return tab.name === current.name;
}

/** The count of quest rewards waiting, on the Quests tab. */
function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="absolute -right-2 -top-1.5 min-w-[18px] rounded-full bg-gold px-1 text-center font-mono text-[11px] font-bold leading-[18px] text-gold-ink">
      {n > 9 ? "9+" : n}
    </span>
  );
}

function TabIcon({ tab, claimable }: { tab: (typeof TABS)[number]; claimable: number }) {
  return (
    <span className="relative">
      {tab.icon}
      {tab.route.name === "quests" && <Badge n={claimable} />}
    </span>
  );
}

const tabLabel = (tab: (typeof TABS)[number], claimable: number) =>
  tab.route.name === "quests" && claimable > 0 ? `${tab.label}, ${claimable} to claim` : tab.label;

export function AppShell({ route, bleed = false, children }: { route: Route; bleed?: boolean; children: ReactNode }) {
  const { claimable } = usePlayer();

  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[76px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-[100dvh] lg:flex-col lg:gap-2 lg:overflow-y-auto lg:border-r lg:border-line lg:bg-surface lg:px-3 lg:py-5 xl:px-5">
        <a href="#/" className="focus-ring mb-6 rounded text-center font-display text-2xl font-bold xl:text-left">
          <span aria-hidden="true" className="text-gold xl:hidden">
            H
          </span>
          <span className="sr-only xl:not-sr-only">Highroller</span>
        </a>
        {TABS.map((t) => (
          <a
            key={t.label}
            href={href(t.route)}
            title={t.label}
            aria-label={tabLabel(t, claimable)}
            aria-current={isActive(t.route, route) ? "page" : undefined}
            className={
              "focus-ring flex min-h-[44px] items-center justify-center gap-3 rounded-xl px-3 text-[15px] xl:justify-start " +
              (isActive(t.route, route) ? "bg-raised text-gold" : "text-muted hover:text-ink")
            }
          >
            <TabIcon tab={t} claimable={claimable} />
            <span className="sr-only xl:not-sr-only">{t.label}</span>
          </a>
        ))}
      </aside>

      <div className="pl-safe pr-safe flex min-h-[100dvh] min-w-0 flex-col">
        <header className="pt-safe sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line/60 bg-ground/90 px-4 pb-2 backdrop-blur md:px-8">
          <a href="#/" className="focus-ring rounded font-display text-[22px] font-bold lg:invisible">
            Highroller
          </a>
          <div className="flex items-center gap-2">
            <LevelBadge />
            <BalancePill />
          </div>
        </header>

        <main
          className={
            bleed
              ? "flex w-full flex-1 flex-col pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0"
              : "mx-auto w-full max-w-xl flex-1 px-4 pb-28 pt-4 md:max-w-3xl md:px-8 lg:max-w-5xl lg:pb-10 lg:pt-8"
          }
        >
          {children}
        </main>

        <nav
          aria-label="Main"
          className="pb-safe pl-safe pr-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-[#0e1913]/95 backdrop-blur lg:hidden"
        >
          {TABS.map((t) => (
            <a
              key={t.label}
              href={href(t.route)}
              aria-label={tabLabel(t, claimable)}
              aria-current={isActive(t.route, route) ? "page" : undefined}
              className={
                "focus-ring flex min-h-[56px] flex-col items-center justify-center gap-1 text-xs " +
                (isActive(t.route, route) ? "text-gold" : "text-muted")
              }
            >
              <TabIcon tab={t} claimable={claimable} />
              {t.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
