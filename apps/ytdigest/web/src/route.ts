import { useEffect, useState } from "react";

/**
 * Hash routes, so every screen is linkable and Back works without the
 * servers needing to know about client paths.
 *
 *   #/feed (default)   #/watch/<youtube id>   #/channels   #/rules   #/digests
 */
export type Route =
  | { name: "feed" }
  | { name: "watch"; id: string }
  | { name: "channels" }
  | { name: "rules" }
  | { name: "digests" };

export function parseRoute(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, "").split("/");
  if (first === "watch" && second) return { name: "watch", id: decodeURIComponent(second) };
  if (first === "channels" || first === "rules" || first === "digests") return { name: first };
  return { name: "feed" };
}

export const hrefFor = (route: Route) =>
  route.name === "watch" ? `#/watch/${encodeURIComponent(route.id)}` : `#/${route.name}`;

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
