import { useEffect, useState } from "react";
import type { GuideSection } from "./help";

/**
 * Hash routing, like the other apps in the stack: it needs no server rewrite
 * rules on either target, survives being opened from a home-screen icon, and
 * is what a notification's `url` points at ("#/bakes/<id>").
 */
export type Route =
  | { name: "today" }
  | { name: "starters" }
  | { name: "starter"; id: string }
  | { name: "starter-new" }
  | { name: "starter-edit"; id: string }
  | { name: "feed"; id: string }
  | { name: "bakes" }
  | { name: "bake"; id: string }
  /** Plan a new bake, from a recipe when one is given. */
  | { name: "plan"; recipeId?: string }
  | { name: "recipes" }
  | { name: "recipe"; id: string }
  /** A new recipe; `copy` starts from an existing one, `edit` changes the user's own. */
  | { name: "recipe-edit"; mode: "new" | "copy" | "edit"; id?: string }
  | { name: "settings" }
  /** The beginner's guide, scrolled to a section when one is given. */
  | { name: "guide"; section?: GuideSection };

export function parseRoute(hash: string): Route {
  const [head, arg, arg2] = hash.replace(/^#\/?/, "").split("/");
  switch (head) {
    case "starters":
      if (arg === "new") return { name: "starter-new" };
      if (arg && arg2 === "feed") return { name: "feed", id: arg };
      if (arg && arg2 === "edit") return { name: "starter-edit", id: arg };
      return arg ? { name: "starter", id: arg } : { name: "starters" };
    case "bakes":
      return arg ? { name: "bake", id: arg } : { name: "bakes" };
    case "plan":
      return { name: "plan", recipeId: arg || undefined };
    case "recipes":
      if (arg === "new") return { name: "recipe-edit", mode: "new" };
      if (arg && (arg2 === "copy" || arg2 === "edit")) return { name: "recipe-edit", mode: arg2, id: arg };
      return arg ? { name: "recipe", id: arg } : { name: "recipes" };
    case "settings":
      return { name: "settings" };
    case "guide":
      return { name: "guide", section: (arg || undefined) as GuideSection | undefined };
    default:
      return { name: "today" };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case "today":
      return "#/";
    case "starter":
      return `#/starters/${route.id}`;
    case "starter-new":
      return "#/starters/new";
    case "starter-edit":
      return `#/starters/${route.id}/edit`;
    case "feed":
      return `#/starters/${route.id}/feed`;
    case "bake":
      return `#/bakes/${route.id}`;
    case "plan":
      return route.recipeId ? `#/plan/${route.recipeId}` : "#/plan";
    case "recipe":
      return `#/recipes/${route.id}`;
    case "recipe-edit":
      return route.mode === "new" ? "#/recipes/new" : `#/recipes/${route.id}/${route.mode}`;
    case "guide":
      return route.section ? `#/guide/${route.section}` : "#/guide";
    default:
      return `#/${route.name}`;
  }
}

export function go(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      const next = parseRoute(window.location.hash);
      setRoute(next);
      // The guide scrolls to its own section.
      if (next.name !== "guide" || !next.section) window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}
