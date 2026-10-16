import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type LevelRow, type PlayerRow, api } from "./api";
import { useToast } from "./components/Toast";
import { buzz } from "./settings";
import { type Equipped, equippedStyles } from "./table/cosmetics";

/**
 * The signed-in player, loaded once and shared: the balance pill, the level
 * badge, the lobby cards and every table read it from here. Anything that
 * changes the balance on the server hands back the new player (a claim) or
 * the new balance and level (a hand, a purchase), and calls `set` /
 * `setBalance` so the header moves at once. A level gained that way is
 * announced here, whatever caused it.
 *
 * It also keeps the count of quest rewards waiting to be claimed, for the
 * Quests tab's badge.
 */
type Progress = Partial<Pick<PlayerRow, "xp"> & LevelRow>;

interface PlayerContextValue {
  player: PlayerRow | null;
  error: Error | null;
  reload: () => void;
  set: (p: PlayerRow) => void;
  setBalance: (balance: number, progress?: Progress) => void;
  setEquippedIds: (equipped: PlayerRow["equipped"]) => void;
  /** Quest rewards waiting to be claimed. */
  claimable: number;
  setClaimable: (n: number | ((n: number) => number)) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [claimable, setClaimable] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    api.me().then(
      (p) => live && (setPlayer(p), setError(null)),
      (e: Error) => live && setError(e),
    );
    api.quests().then(
      (q) => live && setClaimable(q.claimable),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [tick]);

  // A new day (a new daily bonus, new quests) can start while the app sits open.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Level-ups, announced once the header shows them.
  const level = player?.level ?? null;
  const lastLevel = useRef<number | null>(null);
  useEffect(() => {
    if (level === null) return;
    if (lastLevel.current !== null && level > lastLevel.current) {
      toast(`Level ${level}!`, "win");
      buzz([10, 40, 10, 40, 10]);
    }
    lastLevel.current = level;
  }, [level, toast]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setBalance = useCallback(
    (balance: number, progress: Progress = {}) => setPlayer((p) => (p ? { ...p, ...progress, balance } : p)),
    [],
  );
  const setEquippedIds = useCallback(
    (equipped: PlayerRow["equipped"]) => setPlayer((p) => (p ? { ...p, equipped } : p)),
    [],
  );

  return (
    <PlayerContext.Provider
      value={{ player, error, reload, set: setPlayer, setBalance, setEquippedIds, claimable, setClaimable }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer outside PlayerProvider");
  return ctx;
}

/**
 * The equipped cosmetics as styles for the tables. Stable while the ids are,
 * because a new object remounts the table's canvas.
 */
export function useEquipped(): Equipped {
  const ids = usePlayer().player?.equipped;
  const key = ids ? `${ids.card_back}|${ids.felt}|${ids.chip_set}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => equippedStyles(ids ?? { card_back: "", felt: "", chip_set: "" }), [key]);
}
