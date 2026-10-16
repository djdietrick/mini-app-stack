import type { Rng } from "./rng.js";

/**
 * The contract every game implements. The hand lifecycle (src/domain/hands.ts)
 * drives any engine the same way, so adding a game needs no route, repo or
 * migration change: write an engine, register it in src/domain/registry.ts,
 * and draw its scene.
 *
 * Engines are pure and deterministic. `deal` is the only place randomness
 * enters, and it draws everything the hand will ever need (the whole shoe, the
 * spin, the reel stops) into the state, so `act` given the same state and
 * action always returns the same next state. That is what lets a Firestore
 * transaction be retried without re-rolling a hand, and a settled hand be
 * replayed from its stored state.
 *
 * State is plain JSON (it is stored as JSONB, or a JSON string in Firestore).
 * It holds private parts — the deck, a hole card — that only `view` may
 * filter for the client; the lifecycle never sends state itself.
 */
export interface GameEngine<Bets, State, Action extends { type: string }, View> {
  /** Variant names, the default first. Omit for a game with one. */
  readonly variants?: readonly string[];

  /** Null when the bets are acceptable, else a short reason (the 400's `reason`). */
  validateBets(bets: Bets, limits: TableLimits, variant: string | null): string | null;

  /** Draws all the hand's randomness and returns the initial state. */
  deal(bets: Bets, rng: Rng, variant: string | null): State;

  /** The action types allowed now. Empty once the hand is finished. */
  legalActions(state: State): string[];

  /**
   * The next state, or null when the action is not legal here (the lifecycle
   * answers 409 ILLEGAL_ACTION). An action that adds a wager (double, split,
   * a play bet) shows up as a rise in `staked`; the lifecycle debits it.
   */
  act(state: State, action: Action): State | null;

  isFinished(state: State): boolean;

  /** Total chips wagered on the hand so far, extra wagers included. */
  staked(state: State): number;

  /** Only called once the hand is finished. Whole chips: fractions round down. */
  settle(state: State): Settlement;

  /**
   * Chips already paid back before the hand finishes: bets that settle on
   * the deal (blackjack's side bets). The lifecycle credits each rise as it
   * happens; `settle` still counts them in `returned`, and settlement pays
   * only the rest. Never falls. Omit for a game that pays everything at the end.
   */
  paidEarly?(state: State): number;

  /**
   * What "average luck" returns on this hand, for the stats dashboard, when
   * it isn't `theoreticalRtp × staked` (a side bet with its own edge).
   */
  expectedReturn?(state: State): number;

  /** What the client may see. Never the undealt cards or a hidden hole card. */
  view(state: State): View;

  /** Facts about the finished hand that quests and achievements read. */
  summary(state: State): Facts;

  /** Expected return per chip wagered with basic play, e.g. 0.973 for European roulette. */
  theoreticalRtp(variant: string | null): number;
}

/** Per-game table limits, from the registry. */
export interface TableLimits {
  /** Smallest stake on a main bet spot. */
  min: number;
  /** Largest stake on any one bet spot. */
  max: number;
  /** Stakes are multiples of this. */
  step: number;
  /** Most chips on all spots together, for games with many spots (roulette). */
  total?: number;
  /** Side bet spots, each with its own range (in `step`s like the main spot). */
  side?: { min: number; max: number };
}

export type Outcome = "win" | "loss" | "push";

/** One bet spot's result. `returned` includes the stake when it comes back. */
export interface BetResult {
  spot: string;
  stake: number;
  returned: number;
  outcome: Outcome;
}

export interface Settlement {
  /** Chips paid back to the player, stakes included. 0 on a total loss. */
  returned: number;
  results: BetResult[];
}

export type Facts = Record<string, string | number | boolean>;

/** Everything quests and achievements read about one settled hand. */
export interface HandSummary {
  game: string;
  variant: string | null;
  wagered: number;
  returned: number;
  /** returned − wagered. */
  net: number;
  outcome: Outcome;
  /** The engine's own facts: `blackjack: true`, `handRank: "flush"`, `straightUp: true`. */
  facts: Facts;
}

export function outcomeOf(wagered: number, returned: number): Outcome {
  return returned > wagered ? "win" : returned < wagered ? "loss" : "push";
}

/**
 * The usual check for one bet spot: a whole multiple of the step, within the
 * limits. `min` defaults to the table minimum; side bets pass their own.
 */
export function checkStake(amount: number, limits: TableLimits, min = limits.min): string | null {
  if (!Number.isInteger(amount)) return "stakes are whole chips";
  if (amount < min) return `minimum bet is ${min}`;
  if (amount > limits.max) return `maximum bet is ${limits.max}`;
  if (amount % limits.step !== 0) return `bets go in steps of ${limits.step}`;
  return null;
}

/** The same check for a side bet (`name` for the message), against `limits.side`. Absent is fine. */
export function checkSideStake(name: string, amount: number | undefined, limits: TableLimits): string | null {
  if (amount === undefined) return null;
  const side = limits.side ?? { min: limits.min, max: limits.max };
  if (!Number.isInteger(amount)) return "stakes are whole chips";
  if (amount < side.min) return `minimum ${name} bet is ${side.min}`;
  if (amount > side.max) return `maximum ${name} bet is ${side.max}`;
  if (amount % limits.step !== 0) return `bets go in steps of ${limits.step}`;
  return null;
}
