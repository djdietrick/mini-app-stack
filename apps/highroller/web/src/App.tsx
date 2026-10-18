import { type ComponentType, lazy, Suspense } from "react";
import { AppShell } from "./components/AppShell";
import { JackpotCelebration } from "./components/Jackpot";
import { useRoute } from "./router";
import { Leaderboards } from "./screens/Leaderboards";
import { Ledger } from "./screens/Ledger";
import { Lobby } from "./screens/Lobby";
import { More, Placeholder } from "./screens/More";
import { Quests } from "./screens/Quests";
import { Settings } from "./screens/Settings";
import { Shop } from "./screens/Shop";
import { Stats } from "./screens/Stats";

/**
 * Table screens load on demand, so PixiJS stays out of the lobby's bundle.
 * The demo is dev-only: in a production build this branch is dead code and
 * Vite drops it, Pixi included.
 */
const TableDemo = import.meta.env.DEV ? lazy(() => import("./screens/TableDemo")) : null;

const TABLES: Record<string, ComponentType<{ variant: string | null }>> = {
  blackjack: lazy(() => import("./games/blackjack/Screen")),
  uth: lazy(() => import("./games/uth/Screen")),
  roulette: lazy(() => import("./games/roulette/Screen")),
  baccarat: lazy(() => import("./games/baccarat/Screen")),
  threecard: lazy(() => import("./games/threecard/Screen")),
  videopoker: lazy(() => import("./games/videopoker/Screen")),
  slots: lazy(() => import("./games/slots/Screen")),
};

export function App() {
  const route = useRoute();
  const Table = route.name === "play" ? TABLES[route.game] : undefined;
  const table = route.name === "table-demo" || !!Table;

  return (
    <AppShell route={route} bleed={table}>
      {route.name === "lobby" && <Lobby />}
      {route.name === "shop" && <Shop />}
      {route.name === "quests" && <Quests />}
      {route.name === "stats" && <Stats />}
      {route.name === "more" && <More />}
      {route.name === "leaderboards" && <Leaderboards />}
      {route.name === "ledger" && <Ledger />}
      {route.name === "settings" && <Settings />}
      {route.name === "play" && !Table && <Placeholder title="Not a table" what="There's no game here. Pick one in the lobby." />}
      {Table && route.name === "play" && (
        <Suspense fallback={<div className="flex-1 bg-felt-dark" />}>
          <Table key={`${route.game}/${route.variant}`} variant={route.variant} />
        </Suspense>
      )}
      {route.name === "table-demo" && TableDemo && (
        <Suspense fallback={<div className="flex-1 bg-felt-dark" />}>
          <TableDemo />
        </Suspense>
      )}
      <JackpotCelebration />
    </AppShell>
  );
}
