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
  /**
   * Chips have gone down since the last deal. Screens keep the last hand on
   * the felt until then, and the betting felt after it, so Undo or Clear back
   * to nothing leaves an empty felt rather than bringing the last hand back
   * (which the scene would deal again as if it were new).
   */
  started: boolean;
}

export const total = (bets: Bets) => Object.values(bets).reduce((s, n) => s + n, 0);

/**
 * A table's betting rules. `max` is the most on one spot (a number, or per
 * spot for tables whose side bets have their own range). `weight` is what a
 * chip on a spot really costs: 2 on UTH's Ante, which the Blind matches.
 */
export interface BetRules {
  max?: number | ((spot: string) => number);
  weight?: (spot: string) => number;
}

const maxOf = (r: BetRules, spot: string) => (typeof r.max === "function" ? r.max(spot) : (r.max ?? Infinity));
const weightOf = (r: BetRules, spot: string) => r.weight?.(spot) ?? 1;

/** What the bets cost from the balance. */
export const cost = (bets: Bets, r: BetRules = {}) => Object.entries(bets).reduce((n, [k, v]) => n + v * weightOf(r, k), 0);

export function place(s: BettingState, spot: string, balance: number, r: BetRules = {}): BettingState {
  const w = weightOf(r, spot);
  const room = Math.min(Math.floor((balance - cost(s.bets, r)) / w), maxOf(r, spot) - (s.bets[spot] ?? 0));
  const amount = Math.min(s.chip, room);
  if (amount <= 0) return s;
  return { ...s, bets: { ...s.bets, [spot]: (s.bets[spot] ?? 0) + amount }, history: [...s.history, { spot, amount }], started: true };
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
export function rebet(s: BettingState, balance: number, r: BetRules = {}): BettingState {
  if (!s.last || cost(s.last, r) > balance) return s;
  return { ...s, bets: { ...s.last }, history: Object.entries(s.last).map(([spot, amount]) => ({ spot, amount })), started: true };
}

/** The hand is dealt: these bets are remembered for Rebet and the spots cleared. */
export function commit(s: BettingState): BettingState {
  return { ...s, last: s.bets, bets: {}, history: [], started: false };
}

/** Every spot doubled, if the balance and the limits allow it. */
export function double(s: BettingState, balance: number, r: BetRules = {}): BettingState {
  if (!total(s.bets) || cost(s.bets, r) * 2 > balance || Object.entries(s.bets).some(([k, n]) => n * 2 > maxOf(r, k))) return s;
  return {
    ...s,
    bets: Object.fromEntries(Object.entries(s.bets).map(([k, v]) => [k, v * 2])),
    history: [...s.history, ...Object.entries(s.bets).map(([spot, amount]) => ({ spot, amount }))],
  };
}

export function useBetting(balance: number, opts: BetRules & { chip?: number } = {}) {
  const [s, set] = useState<BettingState>({ chip: opts.chip ?? DENOMINATIONS[1], bets: {}, history: [], last: null, started: false });
  return {
    ...s,
    total: total(s.bets),
    /** What dealing these bets takes from the balance. */
    cost: cost(s.bets, opts),
    setChip: useCallback((chip: number) => set((x) => ({ ...x, chip })), []),
    place: (spot: string) => set((x) => place(x, spot, balance, opts)),
    undo: () => set(undo),
    clear: () => set(clear),
    rebet: () => set((x) => rebet(x, balance, opts)),
    double: () => set((x) => double(x, balance, opts)),
    /** Call when the hand is dealt. */
    commit: () => set(commit),
  };
}
