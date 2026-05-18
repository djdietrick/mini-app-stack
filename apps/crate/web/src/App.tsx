import { useEffect, useState } from "react";
import { useAuth, useSession } from "@stack/auth-ui";
import type { ArtistResult } from "./api";
import { Search } from "./screens/Search";
import { Queue } from "./screens/Queue";
import { Recommendation } from "./screens/Recommendation";
import { History } from "./screens/History";
import { Artist } from "./screens/Artist";

type Route = "recommendation" | "search" | "queue" | "history";

function currentRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "search" || h === "queue" || h === "history") return h;
  return "recommendation";
}

const tabs: { id: Route; label: string }[] = [
  { id: "recommendation", label: "Pick one" },
  { id: "search", label: "Search & add" },
  { id: "queue", label: "Queue" },
  { id: "history", label: "History" },
];

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute());
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState<ArtistResult | null>(null);
  const session = useSession();
  const { logout } = useAuth();
  const userLabel =
    session.status === "signed-in"
      ? session.user.displayName || session.user.email
      : "";

  useEffect(() => {
    const onHash = () => {
      const next = currentRoute();
      setRoute(next);
      setMenuOpen(false);
      if (next !== "search") setSelectedArtist(null);
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

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <a
            href="#/recommendation"
            className="text-lg font-semibold tracking-tight hover:text-neutral-300 transition"
          >
            Crate
          </a>
          <nav className="hidden sm:flex items-center gap-1">
            {tabs.map((t) => (
              <a
                key={t.id}
                href={`#/${t.id}`}
                className={
                  "px-3 py-1.5 rounded-md text-sm transition " +
                  (route === t.id
                    ? "bg-neutral-100 text-neutral-900"
                    : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800")
                }
              >
                {t.label}
              </a>
            ))}
            {userLabel && (
              <span className="ml-3 pl-3 border-l border-neutral-800 text-xs text-neutral-500 max-w-[10rem] truncate" title={userLabel}>
                {userLabel}
              </span>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="px-3 py-1.5 rounded-md text-sm text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition"
            >
              Sign out
            </button>
          </nav>
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800 transition"
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
          "sm:hidden fixed inset-0 z-20 bg-black/60 transition-opacity duration-200 " +
          (menuOpen ? "opacity-100" : "opacity-0 pointer-events-none")
        }
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={
          "sm:hidden fixed top-0 right-0 z-30 h-full w-72 max-w-[80%] bg-neutral-950 border-l border-neutral-800 shadow-xl transform transition-transform duration-200 ease-out " +
          (menuOpen ? "translate-x-0" : "translate-x-full")
        }
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <span className="text-sm font-semibold tracking-tight text-neutral-200">Menu</span>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="inline-flex items-center justify-center w-9 h-9 rounded-md text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800 transition"
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
              href={`#/${t.id}`}
              className={
                "px-3 py-2 rounded-md text-sm transition " +
                (route === t.id
                  ? "bg-neutral-100 text-neutral-900"
                  : "text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800")
              }
            >
              {t.label}
            </a>
          ))}
          <div className="mt-3 pt-3 border-t border-neutral-800">
            {userLabel && (
              <div className="px-3 py-1.5 text-xs text-neutral-500 truncate" title={userLabel}>
                {userLabel}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void logout();
              }}
              className="w-full text-left px-3 py-2 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800 transition"
            >
              Sign out
            </button>
          </div>
        </nav>
      </aside>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {route === "recommendation" && <Recommendation />}
        {route === "search" && selectedArtist && (
          <Artist artist={selectedArtist} onBack={() => setSelectedArtist(null)} />
        )}
        {route === "search" && !selectedArtist && (
          <Search onSelectArtist={setSelectedArtist} />
        )}
        {route === "queue" && <Queue />}
        {route === "history" && <History />}
      </main>
    </div>
  );
}
