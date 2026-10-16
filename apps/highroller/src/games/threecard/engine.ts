import { type Card, freshDeck } from "../cards.js";
import { type BetResult, type GameEngine, type TableLimits, checkSideStake, checkStake, outcomeOf } from "../engine.js";
import { type ThreeCardCategory, describe3, floor3, rank3 } from "../poker/rank3.js";
import { sample } from "../rng.js";

/**
 * Three Card Poker (#54). You and the dealer get three cards each from one
 * deck; hands rank by `rank3` (a straight beats a flush).
 *
 * - Ante, then one decision: Play (a second bet equal to the ante) or fold.
 *   Folding loses the Ante.
 * - The dealer qualifies with queen high or better. If not, the Ante pays
 *   1:1 and the Play bet pushes. If so, the hands are compared: both bets
 *   pay 1:1 on a win, push on a tie and lose otherwise.
 * - The Ante bonus (ANTE_BONUS) pays on a played straight or better, whatever
 *   the dealer has.
 * - Pair Plus, optional, pays on your own hand by PAIR_PLUS_PAYS, even after
 *   a fold. It isn't one of the jackpot's side bets (PLAN.md, #57).
 *
 * `deal` draws all six cards; the dealer's stay private until the decision.
 */
export const THREECARD_LIMITS: TableLimits = { min: 10, max: 2_500, step: 5, side: { min: 5, max: 500 } };

const FULL_DECK: readonly Card[] = freshDeck();

/** "x to 1" on the Ante for a played hand, whatever the dealer has. */
export const ANTE_BONUS: Partial<Record<ThreeCardCategory, number>> = { straight_flush: 5, trips: 4, straight: 1 };

/**
 * "x to 1" on Pair Plus: the common 40-30-6-4-1 table. (A flush at 3:1 would
 * make the edge 7.28%.)
 */
export const PAIR_PLUS_PAYS: Partial<Record<ThreeCardCategory, number>> = {
  straight_flush: 40,
  trips: 30,
  straight: 6,
  flush: 4,
  pair: 1,
};

/** Queen high or better qualifies the dealer. */
export const DEALER_QUALIFIES = floor3("high_card", [12, 0, 0]);
/** The optimal strategy: play queen-six-four or better, fold anything less. */
export const PLAY_AT_LEAST = floor3("high_card", [12, 6, 4]);

/**
 * Exact figures for the Ante with the optimal strategy, from all 22,100 ×
 * 18,424 deals (computed once; threecard.test.ts checks them by Monte
 * Carlo): the house keeps 3.37% of the ante, and you play 67.42% of hands,
 * so the average hand wagers 1.674 antes. Element of risk: 2.01%.
 */
export const HOUSE_EDGE_PER_ANTE = 0.0337298094;
/** 1 + 14,900 / 22,100: the hands at Q-6-4 or better. */
export const WAGER_PER_ANTE = 1 + 14_900 / 22_100;
/** Pair Plus returns 97.68% per chip (a 2.32% edge), exact from the 22,100 hands. */
export const PAIR_PLUS_RTP = 21_588 / 22_100;

export interface ThreeCardBets {
  ante: number;
  pairPlus?: number;
}

export interface ThreeCardState {
  ante: number;
  pairPlus: number;
  /** The Play bet: 0 until played. */
  play: number;
  folded: boolean;
  done: boolean;
  player: Card[];
  /** Private until the hand is over. */
  dealer: Card[];
}

export const ACTIONS = ["play", "fold"] as const;
export type ThreeCardAction = { type: (typeof ACTIONS)[number] };

export interface ThreeCardReturns {
  /** The Ante's 1:1 (or push) plus the Ante bonus. */
  ante: number;
  /** The Ante bonus alone, part of `ante`. */
  anteBonus: number;
  play: number;
  pairPlus: number;
}

export interface ThreeCardShowdown {
  player: { category: ThreeCardCategory; label: string };
  dealer: { category: ThreeCardCategory; label: string };
  dealerQualifies: boolean;
  /** Null when you folded. */
  winner: "player" | "dealer" | "tie" | null;
}

export interface ThreeCardView {
  ante: number;
  pairPlus: number;
  play: number;
  folded: boolean;
  done: boolean;
  player: Card[];
  /** null is face down. */
  dealer: (Card | null)[];
  /** Your hand's name, always. */
  label: string;
  showdown: ThreeCardShowdown | null;
  returned: ThreeCardReturns | null;
}

/** The hand from six stacked cards: yours, then the dealer's. Tests pass a stacked deck. */
export function dealFrom(cards: readonly Card[], bets: ThreeCardBets): ThreeCardState {
  return {
    ante: bets.ante,
    pairPlus: bets.pairPlus ?? 0,
    play: 0,
    folded: false,
    done: false,
    player: cards.slice(0, 3),
    dealer: cards.slice(3, 6),
  };
}

function contest(s: ThreeCardState) {
  const p = rank3(s.player);
  const d = rank3(s.dealer);
  const dealerQualifies = d.score >= DEALER_QUALIFIES;
  const winner = s.folded ? null : p.score > d.score ? ("player" as const) : p.score < d.score ? ("dealer" as const) : ("tie" as const);
  return { p, d, dealerQualifies, winner };
}

function returns(s: ThreeCardState): ThreeCardReturns {
  const c = contest(s);
  const pp = PAIR_PLUS_PAYS[c.p.category];
  const pairPlus = s.pairPlus && pp !== undefined ? s.pairPlus * (pp + 1) : 0;
  if (s.folded) return { ante: 0, anteBonus: 0, play: 0, pairPlus };
  const anteBonus = s.ante * (ANTE_BONUS[c.p.category] ?? 0);
  const a = s.ante;
  let ante: number;
  let play: number;
  if (!c.dealerQualifies) [ante, play] = [2 * a, s.play];
  else if (c.winner === "player") [ante, play] = [2 * a, 2 * s.play];
  else if (c.winner === "tie") [ante, play] = [a, s.play];
  else [ante, play] = [0, 0];
  return { ante: ante + anteBonus, anteBonus, play, pairPlus };
}

export const threecard: GameEngine<ThreeCardBets, ThreeCardState, ThreeCardAction, ThreeCardView> = {
  validateBets(bets, limits) {
    return checkStake(bets.ante, limits) ?? checkSideStake("Pair Plus", bets.pairPlus, limits);
  },

  deal(bets, rng) {
    return dealFrom(sample(FULL_DECK, 6, rng), bets);
  },

  legalActions: (s) => (s.done ? [] : [...ACTIONS]),

  act(s, action) {
    if (s.done) return null;
    if (action.type === "play") return { ...s, play: s.ante, done: true };
    if (action.type === "fold") return { ...s, folded: true, done: true };
    return null;
  },

  isFinished: (s) => s.done,
  staked: (s) => s.ante + s.play + s.pairPlus,

  expectedReturn(s) {
    return (s.ante + s.play) * threecard.theoreticalRtp(null) + s.pairPlus * PAIR_PLUS_RTP;
  },

  settle(s) {
    const r = returns(s);
    const spot = (name: string, stake: number, returned: number): BetResult => ({ spot: name, stake, returned, outcome: outcomeOf(stake, returned) });
    const results = [spot("ante", s.ante, r.ante)];
    if (s.play) results.push(spot("play", s.play, r.play));
    if (s.pairPlus) results.push(spot("pairPlus", s.pairPlus, r.pairPlus));
    return { returned: r.ante + r.play + r.pairPlus, results };
  },

  view(s) {
    const c = s.done ? contest(s) : null;
    return {
      ante: s.ante,
      pairPlus: s.pairPlus,
      play: s.play,
      folded: s.folded,
      done: s.done,
      player: s.player,
      dealer: s.done ? s.dealer : [null, null, null],
      label: describe3(s.player),
      showdown: c && {
        player: { category: c.p.category, label: describe3(s.player) },
        dealer: { category: c.d.category, label: describe3(s.dealer) },
        dealerQualifies: c.dealerQualifies,
        winner: c.winner,
      },
      returned: s.done ? returns(s) : null,
    };
  },

  summary(s) {
    const c = contest(s);
    return {
      handRank: c.p.category,
      dealerQualified: c.dealerQualifies,
      folded: s.folded,
      won: c.winner === "player",
      pairPlusWon: s.pairPlus > 0 && PAIR_PLUS_PAYS[c.p.category] !== undefined,
    };
  },

  theoreticalRtp() {
    return 1 - HOUSE_EDGE_PER_ANTE / WAGER_PER_ANTE;
  },
};
