import type { ReactNode } from "react";
import { useAuth, useSession } from "@stack/auth-ui";
import { type Route, href } from "../router";

/**
 * Phone first: a single column with a bottom tab bar in thumb reach. `md`
 * (tablet portrait) widens the column. From `lg` the tabs move into a left
 * rail, icons only so the content keeps the width a full 0–12 neck needs
 * laid out flat; from `xl` the rail shows its labels. Screens only ever render
 * into `children`, and switch their own layouts at the same breakpoints
 * (src/breakpoints.ts).
 */

const TABS: { route: Route; label: string; icon: ReactNode }[] = [
  {
    route: { name: "home" },
    label: "Practice",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M10 8.5l5 3.5-5 3.5z" />
      </svg>
    ),
  },
  {
    route: { name: "library" },
    label: "Library",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    route: { name: "build" },
    label: "Build",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    route: { name: "progress" },
    label: "Progress",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <path d="M5 20V11M12 20V5M19 20v-6" />
      </svg>
    ),
  },
];

const GEAR = (
  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
  </svg>
);

const TUNE = (
  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <path d="M4 17a8 8 0 0 1 16 0M12 17l4-6" />
  </svg>
);

const RAIL_LINK = "focus-ring flex min-h-[44px] items-center justify-center gap-3 rounded-xl px-3 text-[15px] xl:justify-start ";

function isActive(tab: Route, current: Route): boolean {
  if (current.name === "exercise" || current.name === "practice") return tab.name === "library";
  if (current.name === "session" || current.name === "routine") return tab.name === "home";
  return tab.name === current.name;
}

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const session = useSession();
  const { logout } = useAuth();
  const who = session.status === "signed-in" ? session.user.displayName || session.user.email : "";

  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[76px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-[100dvh] lg:flex-col lg:gap-2 lg:overflow-y-auto lg:border-r lg:border-line lg:bg-surface lg:px-3 lg:py-5 xl:px-5">
        <a href="#/" className="mb-6 rounded text-center font-display text-2xl font-bold focus-ring xl:text-left">
          <span aria-hidden="true" className="text-brass xl:hidden">
            F
          </span>
          <span className="sr-only xl:not-sr-only">Fretwork</span>
        </a>
        {TABS.map((t) => (
          <a
            key={t.label}
            href={href(t.route)}
            title={t.label}
            aria-current={isActive(t.route, route) ? "page" : undefined}
            className={RAIL_LINK + (isActive(t.route, route) ? "bg-raised text-brass" : "text-muted hover:text-ink")}
          >
            {t.icon}
            <span className="sr-only xl:not-sr-only">{t.label}</span>
          </a>
        ))}
        <div className="mt-auto flex flex-col gap-2 text-sm text-muted">
          {[
            { route: { name: "tune" } as Route, label: "Tune up", icon: TUNE },
            { route: { name: "settings" } as Route, label: "Settings", icon: GEAR },
          ].map((t) => (
            <a
              key={t.label}
              href={href(t.route)}
              title={t.label}
              aria-current={route.name === t.route.name ? "page" : undefined}
              className={RAIL_LINK + (route.name === t.route.name ? "bg-raised text-brass" : "text-muted hover:text-ink")}
            >
              {t.icon}
              <span className="sr-only xl:not-sr-only">{t.label}</span>
            </a>
          ))}
          <span className="hidden truncate xl:block">{who}</span>
          <button type="button" onClick={() => void logout()} title={who ? `Sign out ${who}` : "Sign out"} className="btn px-0 xl:px-4">
            <svg viewBox="0 0 24 24" className="h-5 w-5 xl:hidden" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
            </svg>
            <span className="sr-only xl:not-sr-only">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="pl-safe pr-safe flex min-h-[100dvh] min-w-0 flex-col">
        <header className="pt-safe flex items-center justify-between px-5 pb-2 lg:hidden">
          <a href="#/" className="font-display text-2xl font-bold focus-ring rounded">
            Fretwork
          </a>
          <div className="flex items-center">
            <a
              href={href({ name: "tune" })}
              aria-label="Tune up"
              aria-current={route.name === "tune" ? "page" : undefined}
              className={"focus-ring flex h-11 w-11 items-center justify-center rounded-xl " + (route.name === "tune" ? "text-brass" : "text-muted")}
            >
              {TUNE}
            </a>
            <a
              href={href({ name: "settings" })}
              aria-label="Settings"
              aria-current={route.name === "settings" ? "page" : undefined}
              className={"focus-ring flex h-11 w-11 items-center justify-center rounded-xl " + (route.name === "settings" ? "text-brass" : "text-muted")}
            >
              {GEAR}
            </a>
            <button
              type="button"
              onClick={() => void logout()}
              className="focus-ring min-h-[44px] rounded-xl px-3 text-sm text-muted"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-xl flex-1 px-5 pb-28 pt-2 md:max-w-3xl md:px-8 lg:max-w-5xl lg:pb-10 lg:pt-8">
          {children}
        </main>

        <nav
          aria-label="Main"
          className="pb-safe pl-safe pr-safe fixed inset-x-0 bottom-0 grid grid-cols-4 border-t border-line bg-[#17130f]/95 backdrop-blur lg:hidden"
        >
          {TABS.map((t) => (
            <a
              key={t.label}
              href={href(t.route)}
              aria-current={isActive(t.route, route) ? "page" : undefined}
              className={
                "focus-ring flex min-h-[56px] flex-col items-center justify-center gap-1 text-xs " +
                (isActive(t.route, route) ? "text-brass" : "text-muted")
              }
            >
              {t.icon}
              {t.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
