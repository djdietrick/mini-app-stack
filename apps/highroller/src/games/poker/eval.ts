import { type Card, parseCard } from "../cards.js";

/**
 * Poker hand ranking for the games that need it: UTH (#44), and later Trips
 * (#46), Three Card Poker and Video Poker.
 *
 * `evaluate` takes 5 to 7 cards and returns the best five-card hand among
 * them. It works from rank and suit counts rather than trying all 21
 * five-card subsets, so it is fast enough for the Monte Carlo tests (UTH's
 * strategy bot evaluates dozens of hands per decision). With fewer than five
 * cards it ranks what is there (a pair, high card), which the SPA uses for the
 * made-hand label before the flop.
 *
 * `score` orders hands: a higher score wins, equal scores tie. It is the
 * category followed by up to five tiebreak ranks, packed base 15.
 */
export const HAND_CATEGORIES = [
  "high_card",
  "pair",
  "two_pair",
  "trips",
  "straight",
  "flush",
  "full_house",
  "quads",
  "straight_flush",
  "royal_flush",
] as const;

export type HandCategory = (typeof HAND_CATEGORIES)[number];

export interface HandRank {
  category: HandCategory;
  score: number;
  /** The cards that make the hand, the deciding ones first (a straight high to low, the wheel ending on its ace). */
  cards: Card[];
}

interface C {
  card: Card;
  value: number;
  suit: string;
}

export function evaluate(cards: readonly Card[]): HandRank {
  const cs: C[] = cards.map((card) => {
    const p = parseCard(card);
    return { card, value: p.value, suit: p.suit };
  });
  cs.sort((a, b) => b.value - a.value);

  // A flush, and a straight flush inside it.
  const bySuit = new Map<string, C[]>();
  for (const c of cs) {
    const list = bySuit.get(c.suit);
    if (list) list.push(c);
    else bySuit.set(c.suit, [c]);
  }
  let flush: C[] | null = null;
  for (const list of bySuit.values()) if (list.length >= 5) flush = list;
  if (flush) {
    const sf = straightIn(flush);
    if (sf) return make(sf[0].value === 14 ? "royal_flush" : "straight_flush", sf, [straightTop(sf)]);
  }

  // Groups of equal rank, biggest group first, then highest rank.
  const groups: C[][] = [];
  for (const c of cs) {
    const g = groups.find((x) => x[0].value === c.value);
    if (g) g.push(c);
    else groups.push([c]);
  }
  groups.sort((a, b) => b.length - a.length || b[0].value - a[0].value);
  const rest = (used: C[]) => cs.filter((c) => !used.includes(c));

  if (groups[0].length === 4) {
    const used = [...groups[0], ...rest(groups[0]).slice(0, 1)];
    return make("quads", used, [groups[0][0].value, ...kick(used, 4)]);
  }
  if (groups[0].length === 3 && groups[1]?.length >= 2) {
    const used = [...groups[0], ...groups[1].slice(0, 2)];
    return make("full_house", used, [groups[0][0].value, groups[1][0].value]);
  }
  if (flush) {
    const used = flush.slice(0, 5);
    return make("flush", used, used.map((c) => c.value));
  }
  const straight = straightIn(cs);
  if (straight) return make("straight", straight, [straightTop(straight)]);
  if (groups[0].length === 3) {
    const used = [...groups[0], ...rest(groups[0]).slice(0, 2)];
    return make("trips", used, [groups[0][0].value, ...kick(used, 3)]);
  }
  if (groups[0].length === 2 && groups[1]?.length === 2) {
    const pairs = [...groups[0], ...groups[1]];
    const used = [...pairs, ...rest(pairs).slice(0, 1)];
    return make("two_pair", used, [groups[0][0].value, groups[1][0].value, ...kick(used, 4)]);
  }
  if (groups[0].length === 2) {
    const used = [...groups[0], ...rest(groups[0]).slice(0, 3)];
    return make("pair", used, [groups[0][0].value, ...kick(used, 2)]);
  }
  const used = cs.slice(0, 5);
  return make("high_card", used, used.map((c) => c.value));
}

/** The kickers' values: the used cards after the first `from`. */
const kick = (used: C[], from: number) => used.slice(from).map((c) => c.value);

function make(category: HandCategory, used: C[], tiebreak: number[]): HandRank {
  let score = HAND_CATEGORIES.indexOf(category);
  for (let i = 0; i < 5; i++) score = score * 15 + (tiebreak[i] ?? 0);
  return { category, score, cards: used.map((c) => c.card) };
}

/** The highest five-card straight in `cs` (sorted high to low), one card per rank; the wheel's ace goes last. */
function straightIn(cs: C[]): C[] | null {
  const byValue = new Map<number, C>();
  for (const c of cs) if (!byValue.has(c.value)) byValue.set(c.value, c);
  for (let top = 14; top >= 5; top--) {
    const run: C[] = [];
    for (let v = top; v > top - 5; v--) {
      const c = byValue.get(v === 1 ? 14 : v);
      if (!c) break;
      run.push(c);
    }
    if (run.length === 5) return run;
  }
  return null;
}

/** A straight's high card: 5 for the wheel (A-2-3-4-5). */
const straightTop = (run: C[]) => (run[0].value === 14 && run[1].value === 5 ? 5 : run[0].value);

// ---------- the fast path ----------

/** Rank and suit by character code, so the fast path never touches a Map or a string. */
const VALUE_OF = new Int8Array(128);
const SUIT_OF = new Int8Array(128);
for (const [i, r] of "23456789TJQKA".split("").entries()) VALUE_OF[r.charCodeAt(0)] = i + 2;
for (const [i, su] of "cdhs".split("").entries()) SUIT_OF[su.charCodeAt(0)] = i;

const counts = new Int8Array(15);
const suitCounts = new Int8Array(4);
const suitMasks = new Int32Array(4);
const CAT = Object.fromEntries(HAND_CATEGORIES.map((c, i) => [c, i])) as Record<HandCategory, number>;

/** The highest straight's top card in a bitmask of ranks (bit v for rank v), or 0. */
function topOfStraight(mask: number): number {
  if (mask & (1 << 14)) mask |= 1 << 1;
  for (let top = 14; top >= 5; top--) if (((mask >> (top - 4)) & 31) === 31) return top;
  return 0;
}

/** Appends the top `n` ranks of `mask` (high to low) to a packed score that already holds `have` ranks. */
function packTop(score: number, have: number, mask: number, n: number): number {
  for (let v = 14; v >= 2 && n > 0; v--) {
    if (mask & (1 << v)) {
      score = score * 15 + v;
      have++;
      n--;
    }
  }
  for (; have < 5; have++) score *= 15;
  return score;
}

/**
 * `evaluate(cards).score` without building the hand: no objects and no
 * arrays. For strategy bots and simulations, which compare thousands of
 * hands; eval.test.ts checks the two agree.
 */
export function handScore(cards: readonly Card[]): number {
  counts.fill(0);
  suitCounts.fill(0);
  suitMasks.fill(0);
  let rankMask = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const v = VALUE_OF[c.charCodeAt(0)];
    const su = SUIT_OF[c.charCodeAt(1)];
    counts[v]++;
    suitCounts[su]++;
    suitMasks[su] |= 1 << v;
    rankMask |= 1 << v;
  }
  let flushMask = 0;
  for (let su = 0; su < 4; su++) if (suitCounts[su] >= 5) flushMask = suitMasks[su];
  if (flushMask) {
    const top = topOfStraight(flushMask);
    if (top) return packTop(top === 14 ? CAT.royal_flush : CAT.straight_flush, 0, 1 << top, 1);
  }

  let quad = 0;
  let trip = 0;
  let pair1 = 0;
  let pair2 = 0;
  for (let v = 14; v >= 2; v--) {
    const n = counts[v];
    if (n === 4 && !quad) quad = v;
    else if (n === 3 && !trip) trip = v;
    // A second three of a kind lands here: it is the full house's pair.
    else if (n >= 2) {
      if (!pair1) pair1 = v;
      else if (!pair2) pair2 = v;
    }
  }

  if (quad) return packTop(CAT.quads * 15 + quad, 1, rankMask & ~(1 << quad), 1);
  if (trip && pair1) return packTop((CAT.full_house * 15 + trip) * 15 + pair1, 2, 0, 0);
  if (flushMask) return packTop(CAT.flush, 0, flushMask, 5);
  const straight = topOfStraight(rankMask);
  if (straight) return packTop(CAT.straight, 0, 1 << straight, 1);
  if (trip) return packTop(CAT.trips * 15 + trip, 1, rankMask & ~(1 << trip), 2);
  if (pair2) return packTop((CAT.two_pair * 15 + pair1) * 15 + pair2, 2, rankMask & ~(1 << pair1) & ~(1 << pair2), 1);
  if (pair1) return packTop(CAT.pair * 15 + pair1, 1, rankMask & ~(1 << pair1), 3);
  return packTop(CAT.high_card, 0, rankMask, 5);
}

/** The category a score belongs to. */
export const categoryOf = (score: number): HandCategory => HAND_CATEGORIES[Math.floor(score / 15 ** 5)];

/** The lowest possible score in a category: `score >= floorOf("pair")` is a pair or better. */
export const floorOf = (category: HandCategory) => HAND_CATEGORIES.indexOf(category) * 15 ** 5;

/** A > B: positive. Ties are 0. */
export const compareHands = (a: HandRank, b: HandRank) => Math.sign(a.score - b.score);

export const atLeast = (h: HandRank, category: HandCategory) =>
  HAND_CATEGORIES.indexOf(h.category) >= HAND_CATEGORIES.indexOf(category);

// ---------- names ----------

const NAMES: Record<number, [string, string]> = {
  2: ["two", "twos"],
  3: ["three", "threes"],
  4: ["four", "fours"],
  5: ["five", "fives"],
  6: ["six", "sixes"],
  7: ["seven", "sevens"],
  8: ["eight", "eights"],
  9: ["nine", "nines"],
  10: ["ten", "tens"],
  11: ["jack", "jacks"],
  12: ["queen", "queens"],
  13: ["king", "kings"],
  14: ["ace", "aces"],
};

export const CATEGORY_NAMES: Record<HandCategory, string> = {
  high_card: "High card",
  pair: "Pair",
  two_pair: "Two pair",
  trips: "Three of a kind",
  straight: "Straight",
  flush: "Flush",
  full_house: "Full house",
  quads: "Four of a kind",
  straight_flush: "Straight flush",
  royal_flush: "Royal flush",
};

const one = (c: Card) => NAMES[parseCard(c).value][0];
const many = (c: Card) => NAMES[parseCard(c).value][1];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** "Two pair, kings and sevens", "Straight, ten high", "Ace high". */
export function describeHand(h: HandRank): string {
  const [a, , b] = h.cards;
  switch (h.category) {
    case "royal_flush":
      return "Royal flush";
    case "straight_flush":
    case "straight":
      return `${CATEGORY_NAMES[h.category]}, ${h.cards[0][0] === "A" && h.cards[1]?.[0] === "5" ? "five" : one(a)} high`;
    case "quads":
      return `Four of a kind, ${many(a)}`;
    case "full_house":
      return `Full house, ${many(a)} over ${many(h.cards[3])}`;
    case "flush":
      return `Flush, ${one(a)} high`;
    case "trips":
      return `Three of a kind, ${many(a)}`;
    case "two_pair":
      return `Two pair, ${many(a)} and ${many(b)}`;
    case "pair":
      return `Pair of ${many(a)}`;
    case "high_card":
      return `${cap(one(a))} high`;
  }
}
