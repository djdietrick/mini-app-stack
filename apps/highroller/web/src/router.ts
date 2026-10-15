import { useEffect, useState } from "react";

/**
 * Hash routing, like the other apps in the stack: it needs no server rewrite
 * rules on either target and survives being opened from a home-screen icon.
 *
 * The five tabs are lobby, shop, quests, stats and more; ledger and settings
 * live under More. A table is `#/play/<game>` (`#/play/roulette/american`
 * for a variant). `table-demo` is the PixiJS kit's test bench and exists in
 * dev builds only.
 */
export type Route =
  | { name: "lobby" }
  | { name: "shop" }
  | { name: "quests" }
  | { name: "stats" }
  | { name: "more" }
  | { name: "ledger" }
  | { name: "settings" }
  | { name: "play"; game: string; variant: string | null }
  | { name: "table-demo" };

const SIMPLE = ["shop", "quests", "stats", "more", "ledger", "settings"] as const;

export function parseRoute(hash: string): Route {
  const [head, game, variant] = hash.replace(/^#\/?/, "").split("/");
  if ((SIMPLE as readonly string[]).includes(head)) return { name: head as (typeof SIMPLE)[number] };
  if (head === "play" && game) return { name: "play", game, variant: variant || null };
  if (head === "table-demo" && import.meta.env.DEV) return { name: "table-demo" };
  return { name: "lobby" };
}

export function href(route: Route): string {
  if (route.name === "play") return `#/play/${route.game}${route.variant ? `/${route.variant}` : ""}`;
  return route.name === "lobby" ? "#/" : `#/${route.name}`;
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
