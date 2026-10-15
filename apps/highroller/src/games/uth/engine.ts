import { type Card, freshDeck } from "../cards.js";
import { type BetResult, type GameEngine, type TableLimits, checkStake, outcomeOf } from "../engine.js";
import { type HandCategory, type HandRank, categoryOf, describeHand, evaluate, floorOf, handScore } from "../poker/eval.js";
import { sample } from "../rng.js";

/**
 * Ultimate Texas Hold'em (#44). You and the dealer each get two cards and
 * share a five-card board.
 *
 * - Ante and Blind are equal and both required (the bets carry only `ante`).
 * - One Play bet per hand: 3× or 4× the ante before the flop, 2× after it,
 *   1× after the river, where you may fold instead. Checking moves to the
 *   next street; a Play bet goes straight to the showdown.
 * - The dealer qualifies with a pair or better; if not, the Ante pushes.
 * - Win: Play pays 1:1, Ante 1:1 (or pushes), Blind by the paytable below
 *   (pushing on less than a straight). Lose: all three lose. A tie pushes.
 *   Folding loses Ante and Blind.
 *
 * `deal` draws all nine cards up front: yours, the dealer's and the board.
 * The view shows the board street by street and the dealer's cards only
 * once the hand is over.
 */
export const UTH_LIMITS: TableLimits = { min: 10, max: 1_000, step: 5 };

const FULL_DECK: readonly Card[] = freshDeck();

/** Blind pays, as "to 1" (flush 3:2). Anything under a straight pushes. */
export const BLIND_PAYS: Partial<Record<HandCategory, number>> = {
  royal_flush: 500,
  straight_flush: 50,
  quads: 10,
  full_house: 3,
  flush: 1.5,
  straight: 1,
};

export interface UthBets {
  ante: number;
}

export type Street = "preflop" | "flop" | "river" | "done";

export interface UthState {
  ante: number;
  /** The Play bet, 0 until made. */
  play: number;
  /** The street the Play bet was made on. */
  playStreet: Exclude<Street, "done"> | null;
  street: Street;
  folded: boolean;
  player: Card[];
  /** Private until the hand is over. */
  dealer: Card[];
  /** Private beyond what the street shows. */
  board: Card[];
}

export const ACTIONS = ["check", "bet4", "bet3", "bet2", "bet1", "fold"] as const;
export type UthAction = { type: (typeof ACTIONS)[number] };

export interface Showdown {
  player: { category: HandCategory; label: string; cards: Card[] };
  dealer: { category: HandCategory; label: string; cards: Card[] };
  dealerQualifies: boolean;
  /** Null when you folded. */
  winner: "player" | "dealer" | "tie" | null;
}

export interface UthView {
  street: Street;
  ante: number;
  blind: number;
  play: number;
  playStreet: Exclude<Street, "done"> | null;
  folded: boolean;
  player: Card[];
  /** null is face down. */
  dealer: (Card | null)[];
  /** The cards turned so far: 0, 3 or 5. */
  board: Card[];
  showdown: Showdown | null;
  /** Per spot once settled: ante, blind, play. */
  returned: { ante: number; blind: number; play: number } | null;
}

const BET_STREET = { bet4: "preflop", bet3: "preflop", bet2: "flop", bet1: "river" } as const;
const MULTIPLE = { bet4: 4, bet3: 3, bet2: 2, bet1: 1 } as const;

function legal(s: UthState): string[] {
  switch (s.street) {
    case "preflop":
      return ["check", "bet4", "bet3"];
    case "flop":
      return ["check", "bet2"];
    case "river":
      return ["fold", "bet1"];
    case "done":
      return [];
  }
}

function act(s: UthState, action: UthAction): UthState | null {
  if (!legal(s).includes(action.type)) return null;
  switch (action.type) {
    case "check":
      return { ...s, street: s.street === "preflop" ? "flop" : "river" };
    case "fold":
      return { ...s, folded: true, street: "done" };
    default:
      return { ...s, play: s.ante * MULTIPLE[action.type], playStreet: BET_STREET[action.type], street: "done" };
  }
}

const visibleBoard = (s: UthState) => s.board.slice(0, s.street === "preflop" ? 0 : s.street === "flop" ? 3 : 5);

/** Both hands' scores (handScore: settlement runs in every simulated hand) and who won. */
function contest(s: UthState) {
  const p = handScore([...s.player, ...s.board]);
  const d = handScore([...s.dealer, ...s.board]);
  return {
    player: p,
    dealerQualifies: d >= floorOf("pair"),
    winner: s.folded ? null : p > d ? ("player" as const) : p < d ? ("dealer" as const) : ("tie" as const),
  };
}

function showdown(s: UthState): Showdown {
  const side = (h: HandRank) => ({ category: h.category, label: describeHand(h), cards: h.cards });
  const c = contest(s);
  return {
    player: side(evaluate([...s.player, ...s.board])),
    dealer: side(evaluate([...s.dealer, ...s.board])),
    dealerQualifies: c.dealerQualifies,
    winner: c.winner,
  };
}

/** Chips back on each spot, stakes included. */
function returns(s: UthState): { ante: number; blind: number; play: number } {
  const c = contest(s);
  const a = s.ante;
  if (c.winner === null) return { ante: 0, blind: 0, play: 0 };
  if (c.winner === "tie") return { ante: a, blind: a, play: s.play };
  if (c.winner === "dealer") return { ante: c.dealerQualifies ? 0 : a, blind: 0, play: 0 };
  const pays = BLIND_PAYS[categoryOf(c.player)];
  return {
    ante: c.dealerQualifies ? 2 * a : a,
    blind: pays === undefined ? a : a + Math.floor(a * pays),
    play: 2 * s.play,
  };
}

/**
 * The house edge with optimal play is 2.19% of the ante (the Wizard of Odds'
 * figure). The Play bet makes the average hand wager about 4.16 antes
 * (measured with `simpleStrategy` over 12 million hands), so per chip
 * wagered the return is the figure below.
 */
export const HOUSE_EDGE_PER_ANTE = 0.0219;
export const WAGER_PER_ANTE = 4.16;

/** The hand dealt from nine cards: yours, the dealer's, then the board. Tests pass a stacked deck. */
export function dealFrom(cards: Card[], bets: UthBets): UthState {
  return {
    ante: bets.ante,
    play: 0,
    playStreet: null,
    street: "preflop",
    folded: false,
    player: cards.slice(0, 2),
    dealer: cards.slice(2, 4),
    board: cards.slice(4, 9),
  };
}

export const uth: GameEngine<UthBets, UthState, UthAction, UthView> = {
  validateBets(bets, limits) {
    return checkStake(bets.ante, limits);
  },

  deal(bets, rng) {
    return dealFrom(sample(FULL_DECK, 9, rng), bets);
  },

  legalActions: legal,
  act,
  isFinished: (s) => s.street === "done",
  staked: (s) => 2 * s.ante + s.play,

  settle(s) {
    const r = returns(s);
    const spot = (name: string, stake: number, returned: number): BetResult => ({
      spot: name,
      stake,
      returned,
      outcome: outcomeOf(stake, returned),
    });
    const results = [spot("ante", s.ante, r.ante), spot("blind", s.ante, r.blind)];
    if (s.play > 0) results.push(spot("play", s.play, r.play));
    return { returned: r.ante + r.blind + r.play, results };
  },

  view(s) {
    const done = s.street === "done";
    return {
      street: s.street,
      ante: s.ante,
      blind: s.ante,
      play: s.play,
      playStreet: s.playStreet,
      folded: s.folded,
      player: s.player,
      dealer: done ? s.dealer : [null, null],
      board: done ? s.board : visibleBoard(s),
      showdown: done ? showdown(s) : null,
      returned: done ? returns(s) : null,
    };
  },

  summary(s) {
    const c = contest(s);
    return {
      handRank: categoryOf(c.player),
      raiseStreet: s.playStreet ?? "none",
      dealerQualified: c.dealerQualifies,
      folded: s.folded,
      won: c.winner === "player",
    };
  },

  theoreticalRtp() {
    return 1 - HOUSE_EDGE_PER_ANTE / WAGER_PER_ANTE;
  },
};
