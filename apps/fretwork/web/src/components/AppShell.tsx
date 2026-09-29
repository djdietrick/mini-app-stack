import type { ReactNode } from "react";
import { useAuth, useSession } from "@stack/auth-ui";
import { type Route, href } from "../router";

/**
 * Phone first: a single column with a bottom tab bar in thumb reach. From the
 * `lg` breakpoint the tabs move into a left rail and the content column gets
 * wider, which is the hook for the larger-screen layouts (landscape neck next
 * to a side panel) planned later. Screens only ever render into `children`,
 * so they do not need to know which layout is active.
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

function isActive(tab: Route, current: Route): boolean {
  if (current.name === "exercise") return tab.name === "library";
  return tab.name === current.name;
}

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const session = useSession();
  const { logout } = useAuth();
  const who = session.status === "signed-in" ? session.user.displayName || session.user.email : "";

  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="hidden lg:flex lg:flex-col lg:gap-2 lg:border-r lg:border-line lg:bg-surface lg:p-5">
        <a href="#/" className="mb-6 font-display text-2xl font-bold focus-ring rounded">
          Fretwork
        </a>
        {TABS.map((t) => (
          <a
            key={t.label}
            href={href(t.route)}
            aria-current={isActive(t.route, route) ? "page" : undefined}
            className={
              "focus-ring flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[15px] " +
              (isActive(t.route, route) ? "bg-raised text-brass" : "text-muted hover:text-ink")
            }
          >
            {t.icon}
            {t.label}
          </a>
        ))}
        <div className="mt-auto flex flex-col gap-2 text-sm text-muted">
          <span className="truncate">{who}</span>
          <button type="button" onClick={() => void logout()} className="btn">
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-h-[100dvh] flex-col">
        <header className="pt-safe flex items-center justify-between px-5 pb-2 lg:hidden">
          <a href="#/" className="font-display text-2xl font-bold focus-ring rounded">
            Fretwork
          </a>
          <button
            type="button"
            onClick={() => void logout()}
            className="focus-ring min-h-[44px] rounded-xl px-3 text-sm text-muted"
          >
            Sign out
          </button>
        </header>

        <main className="mx-auto w-full max-w-xl flex-1 px-5 pb-28 pt-2 lg:max-w-5xl lg:px-10 lg:pb-10 lg:pt-10">
          {children}
        </main>

        <nav
          aria-label="Main"
          className="pb-safe fixed inset-x-0 bottom-0 grid grid-cols-4 border-t border-line bg-[#17130f]/95 backdrop-blur lg:hidden"
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
