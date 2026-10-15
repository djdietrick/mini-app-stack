import { lazy, Suspense } from "react";
import { AppShell } from "./components/AppShell";
import { ToastProvider } from "./components/Toast";
import { useRoute } from "./router";
import { Ledger } from "./screens/Ledger";
import { Lobby } from "./screens/Lobby";
import { More, Placeholder } from "./screens/More";
import { Settings } from "./screens/Settings";

/**
 * Table screens load on demand, so PixiJS stays out of the lobby's bundle.
 * The demo is dev-only: in a production build this branch is dead code and
 * Vite drops it, Pixi included.
 */
const TableDemo = import.meta.env.DEV ? lazy(() => import("./screens/TableDemo")) : null;

export function App() {
  const route = useRoute();
  const table = route.name === "table-demo";

  return (
    <ToastProvider>
      <AppShell route={route} bleed={table}>
        {route.name === "lobby" && <Lobby />}
        {route.name === "shop" && <Placeholder title="Shop" what="Card backs, table felts and chip sets, bought with chips. Coming soon." />}
        {route.name === "quests" && <Placeholder title="Quests" what="Daily and weekly quests, and achievements. Coming soon." />}
        {route.name === "stats" && <Placeholder title="Stats" what="Hands, wagered, net and biggest wins, per game and in total. Coming soon." />}
        {route.name === "more" && <More />}
        {route.name === "ledger" && <Ledger />}
        {route.name === "settings" && <Settings />}
        {table && TableDemo && (
          <Suspense fallback={<div className="flex-1 bg-felt-dark" />}>
            <TableDemo />
          </Suspense>
        )}
      </AppShell>
    </ToastProvider>
  );
}
