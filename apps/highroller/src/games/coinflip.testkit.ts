import { type GameEngine, checkStake, outcomeOf } from "./engine.js";

/**
 * A toy game for the lifecycle tests: never registered in production
 * (src/domain/registry.ts), only by the tests that need a game to play.
 *
 * - `call` (default): the player may double once, then calls heads or tails.
 *   Two actions, an extra wager and a version bump each, so it exercises
 *   everything a multi-decision game like blackjack will.
 * - `instant`: the player always takes heads and the hand settles as it is
 *   dealt, like a roulette spin.
 * - `longshot`: `instant`, but a win pays 36 for 1, like a straight-up
 *   roulette number: big enough for the big-win feed.
 *
 * Both coins are flipped in `deal`. The first decides the hand and is shown
 * once it is over; the second is never used and never shown, so a test can
 * check private state stays private even after settlement.
 */
export type Coin = "H" | "T";

export interface CoinflipBets {
  main: number;
}

export interface CoinflipState {
  variant: "call" | "instant" | "longshot";
  stake: number;
  doubled: boolean;
  call: Coin | null;
  /** Private. */
  coins: [Coin, Coin];
}

export type CoinflipAction = { type: "double" } | { type: "heads" } | { type: "tails" };

export interface CoinflipView {
  stake: number;
  doubled: boolean;
  call: Coin | null;
  landed: Coin | null;
}

const done = (s: CoinflipState) => s.call !== null;
const staked = (s: CoinflipState) => s.stake * (s.doubled ? 2 : 1);
const legal = (s: CoinflipState) => (done(s) ? [] : s.doubled ? ["heads", "tails"] : ["double", "heads", "tails"]);

export const coinflip: GameEngine<CoinflipBets, CoinflipState, CoinflipAction, CoinflipView> = {
  variants: ["call", "instant", "longshot"],

  validateBets(bets, limits) {
    return checkStake(bets.main, limits);
  },

  deal(bets, rng, variant) {
    const coins: [Coin, Coin] = [rng.int(2) ? "H" : "T", rng.int(2) ? "H" : "T"];
    const v = variant === "instant" || variant === "longshot" ? variant : "call";
    return { variant: v, stake: bets.main, doubled: false, call: v === "call" ? null : "H", coins };
  },

  legalActions: legal,

  act(s, action) {
    if (!legal(s).includes(action.type)) return null;
    if (action.type === "double") return { ...s, doubled: true };
    return { ...s, call: action.type === "heads" ? "H" : "T" };
  },

  isFinished: done,
  staked,

  settle(s) {
    const stake = staked(s);
    const returned = s.call === s.coins[0] ? stake * (s.variant === "longshot" ? 36 : 2) : 0;
    return { returned, results: [{ spot: "main", stake, returned, outcome: outcomeOf(stake, returned) }] };
  },

  view(s) {
    return { stake: s.stake, doubled: s.doubled, call: s.call, landed: done(s) ? s.coins[0] : null };
  },

  summary(s) {
    return { called: s.call ?? "", landed: s.coins[0], doubled: s.doubled };
  },

  theoreticalRtp(variant) {
    return variant === "longshot" ? 18 : 1;
  },
};
