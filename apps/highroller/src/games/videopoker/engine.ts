import { type Card, freshDeck } from "../cards.js";
import type { GameEngine, TableLimits } from "../engine.js";
import { categoryOf, handScore } from "../poker/eval.js";
import { sample } from "../rng.js";

/**
 * Video Poker, Jacks or Better (#55), on the full-pay 9/6 table. Two steps:
 * five cards are dealt, you hold any of them, and the rest are replaced.
 *
 * - The bet is 1–5 coins at a coin value of 5, 25 or 100. Pays are per coin
 *   and include the stake (a high pair "pays 1": your coins back).
 * - A royal flush pays 250 a coin, or 800 a coin at 5 coins.
 *
 * `deal` takes the top ten cards of a shuffled deck: the five dealt, then
 * the five that replace discards, in order. That is the whole of the hand's
 * future, so the draw is fixed by the stored state, and a reload between the
 * deal and the draw shows the same cards. The replacements stay private.
 */
export const COIN_VALUES = [5, 25, 100] as const;
export const MAX_COINS = 5;
export const VIDEOPOKER_LIMITS: TableLimits = { min: 5, max: MAX_COINS * 100, step: 5 };

const FULL_DECK: readonly Card[] = freshDeck();

export const VP_HANDS = [
  "royal_flush",
  "straight_flush",
  "quads",
  "full_house",
  "flush",
  "straight",
  "trips",
  "two_pair",
  "jacks_or_better",
  "nothing",
] as const;
export type VpHand = (typeof VP_HANDS)[number];

/** Per coin bet. The royal's 5-coin bonus is ROYAL_MAX_COINS. */
export const PAYS: Record<VpHand, number> = {
  royal_flush: 250,
  straight_flush: 50,
  quads: 25,
  full_house: 9,
  flush: 6,
  straight: 4,
  trips: 3,
  two_pair: 2,
  jacks_or_better: 1,
  nothing: 0,
};
export const ROYAL_MAX_COINS = 800;

export const HAND_NAMES: Record<VpHand, string> = {
  royal_flush: "Royal flush",
  straight_flush: "Straight flush",
  quads: "Four of a kind",
  full_house: "Full house",
  flush: "Flush",
  straight: "Straight",
  trips: "Three of a kind",
  two_pair: "Two pair",
  jacks_or_better: "Jacks or better",
  nothing: "No win",
};

/** Per coin, for this many coins: the royal's bonus at the maximum. */
export const payFor = (hand: VpHand, coins: number) => (hand === "royal_flush" && coins === MAX_COINS ? ROYAL_MAX_COINS : PAYS[hand]);

/**
 * Optimal play returns 99.54% at 5 coins (the published figure for 9/6
 * Jacks or Better). With fewer coins the royal pays 250, not 800: at the
 * 5-coin strategy's royal rate (1 in 40,391) that costs 550 × 0.0000247583
 * of the bet, which puts the return at 98.18% (re-optimising for the lower
 * royal gets back a little of it).
 */
export const RTP_MAX_COINS = 0.995439;
export const RTP_FEWER_COINS = 0.98182;

export interface VideoPokerBets {
  coins: number;
  coinValue: number;
}

export interface VideoPokerState {
  coins: number;
  coinValue: number;
  /** Private beyond the first five: the dealt hand, then the replacements in order. */
  cards: Card[];
  /** Set by the draw. */
  held: boolean[] | null;
}

export type VideoPokerAction = { type: "draw"; hold: boolean[] };

export interface VideoPokerView {
  coins: number;
  coinValue: number;
  phase: "hold" | "done";
  /** As dealt. */
  dealt: Card[];
  /** The hand on screen: the dealt five, then after the draw the final five. */
  cards: Card[];
  held: boolean[] | null;
  /** What the cards on screen make. */
  hand: VpHand;
  /** Chips back once drawn (the stake included), else null. */
  returned: number | null;
}

/** A five-card hand's line on the paytable. */
export function classify(cards: readonly Card[]): VpHand {
  const score = handScore(cards);
  const cat = categoryOf(score);
  if (cat === "pair") return Math.floor(score / 15 ** 4) % 15 >= 11 ? "jacks_or_better" : "nothing";
  return cat === "high_card" ? "nothing" : cat;
}

/** The final five: held cards stay, each discard is replaced from the top of the rest. */
export function drawn(cards: readonly Card[], hold: readonly boolean[]): Card[] {
  let next = 5;
  return cards.slice(0, 5).map((c, i) => (hold[i] ? c : cards[next++]));
}

/** The hand from ten stacked cards. Tests pass a stacked deck. */
export function dealFrom(cards: readonly Card[], bets: VideoPokerBets): VideoPokerState {
  return { coins: bets.coins, coinValue: bets.coinValue, cards: cards.slice(0, 10), held: null };
}

const finalCards = (s: VideoPokerState) => (s.held ? drawn(s.cards, s.held) : s.cards.slice(0, 5));
const stakeOf = (s: VideoPokerState) => s.coins * s.coinValue;

export const videopoker: GameEngine<VideoPokerBets, VideoPokerState, VideoPokerAction, VideoPokerView> = {
  validateBets(bets) {
    if (!Number.isInteger(bets.coins) || bets.coins < 1 || bets.coins > MAX_COINS) return `bet 1 to ${MAX_COINS} coins`;
    if (!(COIN_VALUES as readonly number[]).includes(bets.coinValue)) return `coins are worth ${COIN_VALUES.join(", ")}`;
    return null;
  },

  deal(bets, rng) {
    return dealFrom(sample(FULL_DECK, 10, rng), bets);
  },

  legalActions: (s) => (s.held ? [] : ["draw"]),

  act(s, action) {
    if (s.held || action.type !== "draw" || action.hold.length !== 5) return null;
    return { ...s, held: [...action.hold] };
  },

  isFinished: (s) => s.held !== null,
  staked: stakeOf,

  expectedReturn(s) {
    return stakeOf(s) * (s.coins === MAX_COINS ? RTP_MAX_COINS : RTP_FEWER_COINS);
  },

  settle(s) {
    const returned = payFor(classify(finalCards(s)), s.coins) * stakeOf(s);
    const stake = stakeOf(s);
    return { returned, results: [{ spot: "hand", stake, returned, outcome: returned > stake ? "win" : returned < stake ? "loss" : "push" }] };
  },

  view(s) {
    const cards = finalCards(s);
    const hand = classify(cards);
    return {
      coins: s.coins,
      coinValue: s.coinValue,
      phase: s.held ? "done" : "hold",
      dealt: s.cards.slice(0, 5),
      cards,
      held: s.held,
      hand,
      returned: s.held ? payFor(hand, s.coins) * stakeOf(s) : null,
    };
  },

  summary(s) {
    return {
      handRank: classify(finalCards(s)),
      dealtRank: classify(s.cards.slice(0, 5)),
      held: s.held ? s.held.filter(Boolean).length : 0,
      coins: s.coins,
    };
  },

  theoreticalRtp: () => RTP_MAX_COINS,
};

// ---------- expected values ----------

const DECK = freshDeck();

/**
 * The expected pay per coin of holding `hold` from `cards`, over every draw
 * from the 47 unseen cards (discards don't come back). Exact; the worst case
 * (hold nothing) is C(47, 5) = 1,533,939 hands.
 */
export function holdValue(cards: readonly Card[], hold: readonly boolean[], coins = MAX_COINS): number {
  const kept = cards.filter((_, i) => hold[i]);
  const rest = DECK.filter((c) => !cards.includes(c));
  const need = 5 - kept.length;
  const hand: Card[] = [...kept, ...Array<Card>(need)];
  let total = 0;
  let n = 0;
  const pays = VP_HANDS.map((h) => payFor(h, coins));
  const index = new Map(VP_HANDS.map((h, i) => [h, i]));
  const choose = (from: number, k: number) => {
    if (k === need) {
      total += pays[index.get(classify(hand))!];
      n++;
      return;
    }
    for (let i = from; i <= rest.length - (need - k); i++) {
      hand[kept.length + k] = rest[i];
      choose(i + 1, k + 1);
    }
  };
  choose(0, 0);
  return total / n;
}

/** All 32 holds by expected pay per coin, best first. */
export function holdValues(cards: readonly Card[], coins = MAX_COINS): { hold: boolean[]; value: number }[] {
  const out: { hold: boolean[]; value: number }[] = [];
  for (let m = 0; m < 32; m++) {
    const hold = [0, 1, 2, 3, 4].map((i) => (m & (1 << i)) !== 0);
    out.push({ hold, value: holdValue(cards, hold, coins) });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** The hold with the highest expected pay. Pure and exact, but a few hundred milliseconds of work. */
export const bestHold = (cards: readonly Card[], coins = MAX_COINS) => holdValues(cards, coins)[0];
