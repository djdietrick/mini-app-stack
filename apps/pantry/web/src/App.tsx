import { useEffect, useState } from "react";
import { useAuth, useSession } from "@stack/auth-ui";
import { Pantry } from "./screens/Pantry";
import { Tags } from "./screens/Tags";
import { Lists } from "./screens/Lists";
import { ListBuilder } from "./screens/ListBuilder";
import { Shopping } from "./screens/Shopping";
import { Household } from "./screens/Household";
import { Onboarding } from "./screens/Onboarding";
import { InviteAccept } from "./screens/InviteAccept";
import { useHousehold } from "./household";

export type Route =
  | { name: "pantry" }
  | { name: "tags" }
  | { name: "lists" }
  | { name: "builder" }
  | { name: "shopping"; listId: string }
  | { name: "household" }
  | { name: "invite"; token: string };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "tags") return { name: "tags" };
  if (h === "lists") return { name: "lists" };
  if (h === "builder") return { name: "builder" };
  if (h === "household") return { name: "household" };
  const inviteMatch = h.match(/^invite\/(.+)$/);
  if (inviteMatch) return { name: "invite", token: decodeURIComponent(inviteMatch[1]) };
  const m = h.match(/^shopping\/([0-9a-f-]+)$/);
  if (m) return { name: "shopping", listId: m[1] };
  return { name: "pantry" };
}

export function navigate(hash: string) {
  window.location.hash = hash;
}

const tabs: { id: string; label: string; href: string }[] = [
  { id: "pantry", label: "Pantry", href: "#/pantry" },
  { id: "lists", label: "Lists", href: "#/lists" },
  { id: "tags", label: "Tags", href: "#/tags" },
];

export function App() {
  const [route, setRoute] = useState<Route>(parseHash());
  const [menuOpen, setMenuOpen] = useState(false);
  const session = useSession();
  const { logout } = useAuth();
  const { loading: householdLoading, household } = useHousehold();
  const userLabel =
    session.status === "signed-in"
      ? session.user.displayName || session.user.email
      : "";

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      setMenuOpen(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Invite links are accessible whether or not the user has a household yet.
  if (route.name === "invite") {
    return (
      <div className="min-h-screen bg-cream-100">
        <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
          <InviteAccept token={route.token} />
        </main>
      </div>
    );
  }

  if (householdLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-ink-muted bg-cream-100">
        Loading…
      </div>
    );
  }

  if (!household) {
    return <Onboarding />;
  }

  return (
    <div className="min-h-screen bg-cream-100">
      <header className="border-b border-cream-300 bg-cream-50/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <a
            href="#/pantry"
            className="font-display text-xl font-semibold tracking-tight text-ink hover:text-apple-600 transition"
          >
            Pantry
          </a>
          <nav className="hidden sm:flex items-center gap-1">
            {tabs.map((t) => (
              <a
                key={t.id}
                href={t.href}
                className={
                  "px-3 py-1.5 rounded-md text-sm font-medium transition " +
                  (route.name === t.id
                    ? "bg-ink text-cream-50"
                    : "text-ink-muted hover:text-ink hover:bg-cream-200")
                }
              >
                {t.label}
              </a>
            ))}
            <a
              href="#/household"
              className={
                "ml-3 pl-3 border-l border-cream-300 px-2 py-1 rounded-md text-xs max-w-[12rem] truncate transition " +
                (route.name === "household"
                  ? "text-ink bg-cream-200"
                  : "text-ink-muted hover:text-ink hover:bg-cream-200")
              }
              title={`Household: ${household.name}`}
            >
              {household.name}
            </a>
            {userLabel && (
              <span
                className="ml-1 text-xs text-ink-soft max-w-[10rem] truncate"
                title={userLabel}
              >
                {userLabel}
              </span>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="px-3 py-1.5 rounded-md text-sm text-ink-muted hover:text-ink hover:bg-cream-200 transition"
            >
              Sign out
            </button>
          </nav>
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-ink hover:bg-cream-200 transition"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      <div
        className={
          "sm:hidden fixed inset-0 z-20 bg-ink/40 transition-opacity duration-200 " +
          (menuOpen ? "opacity-100" : "opacity-0 pointer-events-none")
        }
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={
          "sm:hidden fixed top-0 right-0 z-30 h-full w-72 max-w-[80%] bg-cream-50 border-l border-cream-300 shadow-xl transform transition-transform duration-200 ease-out " +
          (menuOpen ? "translate-x-0" : "translate-x-full")
        }
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-cream-300">
          <span className="font-display text-base font-semibold tracking-tight text-ink">Menu</span>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="inline-flex items-center justify-center w-9 h-9 rounded-md text-ink hover:bg-cream-200 transition"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <nav className="flex flex-col p-3 gap-1">
          {tabs.map((t) => (
            <a
              key={t.id}
              href={t.href}
              className={
                "px-3 py-2 rounded-md text-sm font-medium transition " +
                (route.name === t.id
                  ? "bg-ink text-cream-50"
                  : "text-ink hover:bg-cream-200")
              }
            >
              {t.label}
            </a>
          ))}
          <div className="mt-3 pt-3 border-t border-cream-300">
            <a
              href="#/household"
              className={
                "block px-3 py-2 rounded-md text-sm transition " +
                (route.name === "household"
                  ? "bg-ink text-cream-50"
                  : "text-ink hover:bg-cream-200")
              }
            >
              <div className="truncate font-medium">{household.name}</div>
              <div className="text-xs text-ink-soft">Manage household</div>
            </a>
            {userLabel && (
              <div className="px-3 py-1.5 text-xs text-ink-soft truncate" title={userLabel}>
                {userLabel}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void logout();
              }}
              className="w-full text-left px-3 py-2 rounded-md text-sm text-ink hover:bg-cream-200 transition"
            >
              Sign out
            </button>
          </div>
        </nav>
      </aside>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24">
        {route.name === "pantry" && <Pantry />}
        {route.name === "tags" && <Tags />}
        {route.name === "lists" && <Lists />}
        {route.name === "builder" && <ListBuilder />}
        {route.name === "shopping" && <Shopping listId={route.listId} />}
        {route.name === "household" && <Household />}
      </main>
    </div>
  );
}
