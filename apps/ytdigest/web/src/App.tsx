import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hrefFor, type Route, useRoute } from "./route";
import { Feed } from "./screens/Feed";
import { Watch } from "./screens/Watch";
import { Subscriptions } from "./screens/Subscriptions";
import { Channel } from "./screens/Channel";
import { Rules } from "./screens/Rules";
import { ThemePicker } from "./components/ThemePicker";

const TABS: { route: Route; label: string }[] = [
  { route: { name: "feed" }, label: "Feed" },
  { route: { name: "channels" }, label: "Channels" },
  { route: { name: "rules" }, label: "Rules" },
];

/** The screens a video opens from; each stays mounted (hidden) under the player. */
type ListRoute = Extract<Route, { name: "feed" } | { name: "channel" }>;
const isList = (r: Route): r is ListRoute => r.name === "feed" || r.name === "channel";

export function App() {
  const route = useRoute();
  const current = useRef(route);
  /** The feed or channel page under the player, and how far down it was. */
  const [under, setUnder] = useState<ListRoute>(isList(route) ? route : { name: "feed" });
  const listScroll = useRef(0);
  const cameFromList = useRef(false);
  const watching = route.name === "watch";

  if (isList(route) && hrefFor(route) !== hrefFor(under)) setUnder(route);

  // The list stays mounted under the player, so coming back keeps its pages;
  // this puts the scroll position back too.
  useLayoutEffect(() => {
    const prev = current.current;
    current.current = route;
    if (route.name === "watch") cameFromList.current = isList(prev);
    if (isList(route) && prev.name === "watch" && hrefFor(route) === hrefFor(under)) {
      window.scrollTo(0, listScroll.current);
    } else if (route !== prev) window.scrollTo(0, 0);
  }, [route]);

  useEffect(() => {
    const onScroll = () => {
      if (isList(current.current)) listScroll.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const back = () => {
    if (cameFromList.current) window.history.back();
    else window.location.hash = hrefFor(under);
  };

  const showList = isList(route) || watching;
  const tab = route.name === "channel" ? "channels" : route.name;

  return (
    <div className={`mx-auto px-4 py-6 ${watching ? "max-w-4xl" : isList(route) ? "max-w-6xl" : "max-w-3xl"}`}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">YouTube Digest</h1>
        <ThemePicker />
      </div>
      {!watching && (
        <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-canvas-200">
          {TABS.map((t) => (
            <a
              key={t.route.name}
              href={hrefFor(t.route)}
              className={`shrink-0 px-3 py-2 text-sm font-medium ${
                tab === t.route.name
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
        {showList && (
          <div className={watching ? "hidden" : undefined}>
            {under.name === "feed" ? <Feed /> : <Channel key={under.id} id={under.id} />}
          </div>
        )}
        {watching && <Watch id={route.id} onBack={back} backLabel={under.name === "feed" ? "Feed" : "Channel"} />}
        {route.name === "channels" && <Subscriptions />}
        {route.name === "rules" && <Rules />}
      </div>
    </div>
  );
}
