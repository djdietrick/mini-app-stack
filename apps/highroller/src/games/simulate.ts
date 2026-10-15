import type { GameEngine } from "./engine.js";
import type { Rng } from "./rng.js";

export interface SimulateOptions<Bets, State, Action> {
  hands: number;
  rng: Rng;
  /** The same bets every hand, or a function of the hand's index. */
  bets: Bets | ((i: number) => Bets);
  /** Picks the next action from the state and the legal action types. */
  strategy: (state: State, legal: string[]) => Action;
  variant?: string | null;
  /** Guards against a strategy that never finishes a hand. */
  maxActionsPerHand?: number;
}

export interface SimulationResult {
  hands: number;
  wagered: number;
  returned: number;
  /** returned ÷ wagered. */
  rtp: number;
  /** Standard error of `rtp` (a ratio estimator, so extra wagers are weighted properly). */
  stdErr: number;
}

/**
 * Plays `hands` hands with a strategy and measures the return to player.
 * Every game's house-edge test runs through this: the measured RTP must sit
 * within a few standard errors of `engine.theoreticalRtp`, with the engine's
 * own rounding (no half chips) included.
 */
export function simulate<Bets, State, Action extends { type: string }, View>(
  engine: GameEngine<Bets, State, Action, View>,
  opts: SimulateOptions<Bets, State, Action>,
): SimulationResult {
  const variant = opts.variant ?? null;
  const maxActions = opts.maxActionsPerHand ?? 100;
  const wagers: number[] = [];
  const returns: number[] = [];

  for (let i = 0; i < opts.hands; i++) {
    const bets = typeof opts.bets === "function" ? (opts.bets as (i: number) => Bets)(i) : opts.bets;
    let state = engine.deal(bets, opts.rng, variant);
    for (let n = 0; !engine.isFinished(state); n++) {
      if (n >= maxActions) throw new Error(`hand ${i} did not finish in ${maxActions} actions`);
      const legal = engine.legalActions(state);
      const next = engine.act(state, opts.strategy(state, legal));
      if (next === null) throw new Error(`strategy chose an illegal action in hand ${i}`);
      state = next;
    }
    wagers.push(engine.staked(state));
    returns.push(engine.settle(state).returned);
  }

  const n = wagers.length;
  const wagered = sum(wagers);
  const returned = sum(returns);
  const rtp = wagered === 0 ? 0 : returned / wagered;
  // Delta-method standard error of a ratio of means.
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (returns[i] - rtp * wagers[i]) ** 2;
  const meanWager = wagered / n;
  const stdErr = n > 1 && meanWager > 0 ? Math.sqrt(ss / (n * (n - 1))) / meanWager : 0;

  return { hands: n, wagered, returned, rtp, stdErr };
}

function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
