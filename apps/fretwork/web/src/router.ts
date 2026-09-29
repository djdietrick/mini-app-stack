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
  /** A new exercise, or `edit` / `copy` an existing one (a copy is how a built-in is customised). */
  | { name: "build"; mode?: "edit" | "copy"; id?: string }
  /** Runs the suggested session, or one of the player's routines by id. */
  | { name: "session"; source: "suggested" | string }
  /** Edits a routine; no id for a new one. */
  | { name: "routine"; id?: string }
  | { name: "progress" }
  | { name: "tune" }
  | { name: "settings" };

export function parseRoute(hash: string): Route {
  const [head, arg, arg2] = hash.replace(/^#\/?/, "").split("/");
  if (head === "library") return { name: "library" };
  if (head === "exercise" && arg) return { name: "exercise", id: arg };
  if (head === "practice" && arg) return { name: "practice", id: arg };
  if (head === "build") {
    if ((arg === "edit" || arg === "copy") && arg2) return { name: "build", mode: arg, id: arg2 };
    return { name: "build" };
  }
  if (head === "session" && arg) return { name: "session", source: arg };
  if (head === "routine") return arg && arg !== "new" ? { name: "routine", id: arg } : { name: "routine" };
  if (head === "progress") return { name: "progress" };
  if (head === "tune") return { name: "tune" };
  if (head === "settings") return { name: "settings" };
  return { name: "home" };
}

export function href(route: Route): string {
  if (route.name === "exercise" || route.name === "practice") return `#/${route.name}/${route.id}`;
  if (route.name === "build" && route.mode && route.id) return `#/build/${route.mode}/${route.id}`;
  if (route.name === "session") return `#/session/${route.source}`;
  if (route.name === "routine") return `#/routine/${route.id ?? "new"}`;
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
