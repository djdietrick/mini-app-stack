import { useEffect, useState } from "react";

/**
 * Hash routing, like the other apps in the stack: it needs no server rewrite
 * rules on either target and survives being opened from a home-screen icon.
 */
export type Route =
  | { name: "home" }
  | { name: "library" }
  | { name: "exercise"; id: string }
  | { name: "practice"; id: string }
  | { name: "build" }
  | { name: "progress" }
  | { name: "tune" }
  | { name: "settings" };

export function parseRoute(hash: string): Route {
  const [head, arg] = hash.replace(/^#\/?/, "").split("/");
  if (head === "library") return { name: "library" };
  if (head === "exercise" && arg) return { name: "exercise", id: arg };
  if (head === "practice" && arg) return { name: "practice", id: arg };
  if (head === "build") return { name: "build" };
  if (head === "progress") return { name: "progress" };
  if (head === "tune") return { name: "tune" };
  if (head === "settings") return { name: "settings" };
  return { name: "home" };
}

export function href(route: Route): string {
  if (route.name === "exercise" || route.name === "practice") return `#/${route.name}/${route.id}`;
  return route.name === "home" ? "#/" : `#/${route.name}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}
