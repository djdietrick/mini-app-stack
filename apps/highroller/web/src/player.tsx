import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { type PlayerRow, api } from "./api";

/**
 * The signed-in player, loaded once and shared: the balance pill, the lobby
 * cards and every table read it from here. Anything that changes the balance
 * on the server hands back the new player (a claim) or the new balance (a
 * hand), and calls `set` / `setBalance` so the pill moves at once.
 */
interface PlayerContextValue {
  player: PlayerRow | null;
  error: Error | null;
  reload: () => void;
  set: (p: PlayerRow) => void;
  setBalance: (balance: number, xp?: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    api.me().then(
      (p) => live && (setPlayer(p), setError(null)),
      (e: Error) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [tick]);

  // A new day (and a new daily bonus) can start while the app sits open.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setBalance = useCallback(
    (balance: number, xp?: number) => setPlayer((p) => (p ? { ...p, balance, xp: xp ?? p.xp } : p)),
    [],
  );

  return (
    <PlayerContext.Provider value={{ player, error, reload, set: setPlayer, setBalance }}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer outside PlayerProvider");
  return ctx;
}
