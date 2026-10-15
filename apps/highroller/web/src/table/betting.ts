import { useCallback, useState } from "react";
import { DENOMINATIONS } from "./cosmetics";

/**
 * Bet-building state for a table, before a hand is dealt: which chip is
 * selected, what is on each spot, and the history undo walks back. Pure
 * helpers plus a hook; the scene reports spot taps, the bet bar does the rest.
 */
export type Bets = Record<string, number>;

export interface BettingState {
  chip: number;
  bets: Bets;
  /** Each placement, so undo removes the last chip rather than the whole spot. */
  history: { spot: string; amount: number }[];
  /** The previous hand's bets, for Rebet. */
  last: Bets | null;
}

export const total = (bets: Bets) => Object.values(bets).reduce((s, n) => s + n, 0);

export function place(s: BettingState, spot: string, balance: number, max = Infinity): BettingState {
  const room = Math.min(balance - total(s.bets), max - (s.bets[spot] ?? 0));
  const amount = Math.min(s.chip, room);
  if (amount <= 0) return s;
  return { ...s, bets: { ...s.bets, [spot]: (s.bets[spot] ?? 0) + amount }, history: [...s.history, { spot, amount }] };
}

export function undo(s: BettingState): BettingState {
  const lastMove = s.history.at(-1);
  if (!lastMove) return s;
  const left = (s.bets[lastMove.spot] ?? 0) - lastMove.amount;
  const bets = { ...s.bets };
  if (left > 0) bets[lastMove.spot] = left;
  else delete bets[lastMove.spot];
  return { ...s, bets, history: s.history.slice(0, -1) };
}

export function clear(s: BettingState): BettingState {
  return { ...s, bets: {}, history: [] };
}

/** The last hand's bets again, if the balance covers them. */
export function rebet(s: BettingState, balance: number): BettingState {
  if (!s.last || total(s.last) > balance) return s;
  return { ...s, bets: { ...s.last }, history: Object.entries(s.last).map(([spot, amount]) => ({ spot, amount })) };
}

/** Every spot doubled, if the balance covers it. */
export function double(s: BettingState, balance: number, max = Infinity): BettingState {
  if (!total(s.bets) || total(s.bets) * 2 > balance || Object.values(s.bets).some((n) => n * 2 > max)) return s;
  return {
    ...s,
    bets: Object.fromEntries(Object.entries(s.bets).map(([k, v]) => [k, v * 2])),
    history: [...s.history, ...Object.entries(s.bets).map(([spot, amount]) => ({ spot, amount }))],
  };
}

export function useBetting(balance: number, opts: { max?: number; chip?: number } = {}) {
  const [s, set] = useState<BettingState>({ chip: opts.chip ?? DENOMINATIONS[1], bets: {}, history: [], last: null });
  const max = opts.max ?? Infinity;
  return {
    ...s,
    total: total(s.bets),
    setChip: useCallback((chip: number) => set((x) => ({ ...x, chip })), []),
    place: (spot: string) => set((x) => place(x, spot, balance, max)),
    undo: () => set(undo),
    clear: () => set(clear),
    rebet: () => set((x) => rebet(x, balance)),
    double: () => set((x) => double(x, balance, max)),
    /** Call when the hand is dealt: remembers these bets for Rebet and clears the spots. */
    commit: () => set((x) => ({ ...x, last: x.bets, bets: {}, history: [] })),
  };
}
