import { type Card, parseCard } from "../cards.js";

/**
 * Three-card hand ranking, for Three Card Poker (#54). With three cards a
 * straight is rarer than a flush, so it ranks above one, and three of a kind
 * above both. Straights run A-2-3 (the lowest, three high) up to Q-K-A.
 *
 * `score` orders hands like the five-card `handScore`: the category, then
 * three tiebreak ranks, packed base 15. A higher score wins; equal scores tie.
 */
export const THREE_CARD_CATEGORIES = ["high_card", "pair", "flush", "straight", "trips", "straight_flush"] as const;
export type ThreeCardCategory = (typeof THREE_CARD_CATEGORIES)[number];

export interface ThreeCardRank {
  category: ThreeCardCategory;
  score: number;
}

const pack = (cat: number, a: number, b = 0, c = 0) => ((cat * 15 + a) * 15 + b) * 15 + c;

export function rank3(cards: readonly Card[]): ThreeCardRank {
  if (cards.length !== 3) throw new RangeError(`three cards, not ${cards.length}`);
  const ps = cards.map(parseCard);
  const [a, b, c] = ps.map((p) => p.value).sort((x, y) => y - x);
  const flush = ps[0].suit === ps[1].suit && ps[1].suit === ps[2].suit;
  // A-2-3 counts three high.
  const wheel = a === 14 && b === 3 && c === 2;
  const straight = wheel || (a - b === 1 && b - c === 1);
  const top = wheel ? 3 : a;
  const cat = (name: ThreeCardCategory) => THREE_CARD_CATEGORIES.indexOf(name);

  if (straight && flush) return { category: "straight_flush", score: pack(cat("straight_flush"), top) };
  if (a === c) return { category: "trips", score: pack(cat("trips"), a) };
  if (straight) return { category: "straight", score: pack(cat("straight"), top) };
  if (flush) return { category: "flush", score: pack(cat("flush"), a, b, c) };
  if (a === b || b === c) {
    const pair = b;
    const kicker = a === b ? c : a;
    return { category: "pair", score: pack(cat("pair"), pair, kicker) };
  }
  return { category: "high_card", score: pack(cat("high_card"), a, b, c) };
}

/** The lowest score in a category, or of a high-card hand from its three ranks high to low (Q-6-4: [12, 6, 4]). */
export const floor3 = (category: ThreeCardCategory, ranks: [number, number, number] = [0, 0, 0]) =>
  pack(THREE_CARD_CATEGORIES.indexOf(category), ...ranks);

export const THREE_CARD_NAMES: Record<ThreeCardCategory, string> = {
  high_card: "High card",
  pair: "Pair",
  flush: "Flush",
  straight: "Straight",
  trips: "Three of a kind",
  straight_flush: "Straight flush",
};

const RANK_NAME: Record<number, string> = {
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "jack",
  12: "queen",
  13: "king",
  14: "ace",
};
const PLURAL: Record<number, string> = { 6: "sixes" };
const many = (v: number) => PLURAL[v] ?? `${RANK_NAME[v]}s`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** "Pair of queens", "Straight, ace high", "King high". */
export function describe3(cards: readonly Card[]): string {
  const r = rank3(cards);
  const d = (k: number) => Math.floor(r.score / 15 ** k) % 15;
  switch (r.category) {
    case "straight_flush":
      return `Straight flush, ${RANK_NAME[d(2)]} high`;
    case "trips":
      return `Three ${many(d(2))}`;
    case "straight":
      return `Straight, ${RANK_NAME[d(2)]} high`;
    case "flush":
      return `Flush, ${RANK_NAME[d(2)]} high`;
    case "pair":
      return `Pair of ${many(d(2))}`;
    case "high_card":
      return `${cap(RANK_NAME[d(2)])} high`;
  }
}
