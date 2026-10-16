import { type Card, isRed, parseCard } from "../cards.js";

/**
 * Blackjack's side bets (#46). Both settle on the deal, from cards already
 * dealt, so the lifecycle pays them straight away (`paidEarly`).
 *
 * - Perfect Pairs: your first two cards.
 * - 21+3: your first two cards and the dealer's up card, as a three-card
 *   poker hand.
 *
 * The edges below are exact for six decks (sidebets.test.ts enumerates every
 * draw). A suited three of a kind on 21+3 is the jackpot's (#57) trigger;
 * `summary` flags it as `jackpotEligible`.
 */
export type PairHand = "perfect" | "coloured" | "mixed";
export type ThreeCardHand = "suited_trips" | "straight_flush" | "trips" | "straight" | "flush";

/** "x to 1". */
export const PERFECT_PAIRS_PAYS: Record<PairHand, number> = { perfect: 25, coloured: 12, mixed: 6 };
export const TWENTY_ONE_PLUS_THREE_PAYS: Record<ThreeCardHand, number> = {
  suited_trips: 100,
  straight_flush: 40,
  trips: 30,
  straight: 10,
  flush: 5,
};

/** Return per chip, exact for six decks: Perfect Pairs 292/311 (a 6.11% edge), 21+3 a 4.62% edge. */
export const PERFECT_PAIRS_RTP = 292 / 311;
export const TWENTY_ONE_PLUS_THREE_RTP = 0.9537903026337836;

export const PAIR_NAMES: Record<PairHand, string> = { perfect: "Perfect pair", coloured: "Coloured pair", mixed: "Mixed pair" };
export const THREE_CARD_NAMES: Record<ThreeCardHand, string> = {
  suited_trips: "Suited trips",
  straight_flush: "Straight flush",
  trips: "Three of a kind",
  straight: "Straight",
  flush: "Flush",
};

/** Same rank: same suit, same colour, or neither. */
export function pairHand(a: Card, b: Card): PairHand | null {
  if (a[0] !== b[0]) return null;
  if (a[1] === b[1]) return "perfect";
  return isRed(a) === isRed(b) ? "coloured" : "mixed";
}

/** A three-card poker hand; aces run high (Q-K-A) or low (A-2-3). */
export function threeCardHand(cards: readonly [Card, Card, Card]): ThreeCardHand | null {
  const v = cards.map((c) => parseCard(c).value).sort((x, y) => x - y);
  const suited = cards[0][1] === cards[1][1] && cards[1][1] === cards[2][1];
  const trips = v[0] === v[2];
  const straight = (v[1] === v[0] + 1 && v[2] === v[1] + 1) || (v[0] === 2 && v[1] === 3 && v[2] === 14);
  if (trips && suited) return "suited_trips";
  if (straight && suited) return "straight_flush";
  if (trips) return "trips";
  if (straight) return "straight";
  if (suited) return "flush";
  return null;
}

export interface SideBets {
  perfectPairs: number;
  twentyOnePlusThree: number;
}

export interface SideResult {
  stake: number;
  /** The winning hand, or null on a loss. */
  hand: PairHand | ThreeCardHand | null;
  /** Chips back, the stake included. */
  returned: number;
}

/** Both side bets' results from the opening cards; null where nothing was staked. */
export function sideResults(side: SideBets, player: readonly Card[], up: Card) {
  const pair = pairHand(player[0], player[1]);
  const three = threeCardHand([player[0], player[1], up]);
  const result = (stake: number, hand: PairHand | ThreeCardHand | null, pays: number | undefined): SideResult | null =>
    stake > 0 ? { stake, hand, returned: hand && pays !== undefined ? stake * (pays + 1) : 0 } : null;
  return {
    perfectPairs: result(side.perfectPairs, pair, pair ? PERFECT_PAIRS_PAYS[pair] : undefined),
    twentyOnePlusThree: result(side.twentyOnePlusThree, three, three ? TWENTY_ONE_PLUS_THREE_PAYS[three] : undefined),
  };
}
