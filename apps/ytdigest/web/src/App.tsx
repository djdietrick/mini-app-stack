import { useEffect, useLayoutEffect, useRef } from "react";
import { hrefFor, type Route, useRoute } from "./route";
import { Feed } from "./screens/Feed";
import { Watch } from "./screens/Watch";
import { Subscriptions } from "./screens/Subscriptions";
import { Rules } from "./screens/Rules";
import { Digests } from "./screens/Digests";

const TABS: { route: Route; label: string }[] = [
  { route: { name: "feed" }, label: "Feed" },
  { route: { name: "channels" }, label: "Channels" },
  { route: { name: "rules" }, label: "Rules" },
  { route: { name: "digests" }, label: "Digests" },
];

export function App() {
  const route = useRoute();
  const current = useRef(route);
  const feedScroll = useRef(0);
  const cameFromFeed = useRef(false);
  const watching = route.name === "watch";

  // The feed stays mounted (hidden) under the player, so coming back keeps
  // its pages; this puts the scroll position back too.
  useLayoutEffect(() => {
    const prev = current.current;
    current.current = route;
    if (route.name === "watch") cameFromFeed.current = prev.name === "feed";
    if (route.name === "feed" && prev.name === "watch") window.scrollTo(0, feedScroll.current);
    else if (route !== prev) window.scrollTo(0, 0);
  }, [route]);

  useEffect(() => {
    const onScroll = () => {
      if (current.current.name === "feed") feedScroll.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const backToFeed = () => {
    if (cameFromFeed.current) window.history.back();
    else window.location.hash = hrefFor({ name: "feed" });
  };

  return (
    <div className={`mx-auto px-4 py-6 ${watching ? "max-w-4xl" : route.name === "feed" ? "max-w-6xl" : "max-w-3xl"}`}>
      <h1 className="text-2xl font-semibold">YouTube Digest</h1>
      {!watching && (
        <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-canvas-200">
          {TABS.map((t) => (
            <a
              key={t.route.name}
              href={hrefFor(t.route)}
              className={`shrink-0 px-3 py-2 text-sm font-medium ${
                route.name === t.route.name
                  ? "border-b-2 border-brand-500 text-brand-600"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {t.label}
            </a>
          ))}
        </nav>
      )}
      <div className="mt-4">
        {/* Unmounted on the other tabs, so a rule edited there shows on return. */}
        {(route.name === "feed" || watching) && (
          <div className={watching ? "hidden" : undefined}>
            <Feed />
          </div>
        )}
        {watching && <Watch id={route.id} onBack={backToFeed} />}
        {route.name === "channels" && <Subscriptions />}
        {route.name === "rules" && <Rules />}
        {route.name === "digests" && <Digests />}
      </div>
    </div>
  );
}
