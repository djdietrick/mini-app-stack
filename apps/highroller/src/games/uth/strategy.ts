import { type Card, freshDeck, parseCard } from "../cards.js";
import { HAND_CATEGORIES, categoryOf, handScore } from "../poker/eval.js";
import type { UthAction, UthState } from "./engine.js";

/**
 * The Wizard of Odds' simple strategy for UTH, which gives up only a few
 * hundredths of a percent against optimal play. It drives the house-edge
 * test and is exported for later use (a hint, a coach). It reads only what a
 * player can see: its own cards and the board so far.
 *
 * - Preflop, 4×: any pair but deuces; any ace; king with a suited card or a
 *   five or better; queen-six suited or queen-eight; jack-eight suited or
 *   jack-ten. Otherwise check.
 * - Flop, 2×: two pair or better; a hidden pair (one using a hole card)
 *   except pocket deuces; four to a flush with a hidden ten or better of the
 *   suit. Otherwise check.
 * - River, 1×: a hidden pair or better, or fewer than 21 dealer outs (unseen
 *   cards that with the board would beat you). Otherwise fold.
 */
/** What the simple strategy gives up: 2.43% (± 0.14%) of the ante over 12 million hands, against 2.19% for optimal play. */
export const SIMPLE_STRATEGY_EDGE = 0.0243;

export function simpleStrategy(s: UthState): UthAction["type"] {
  const [a, b] = s.player.map(parseCard).sort((x, y) => y.value - x.value);
  const suited = a.suit === b.suit;

  if (s.street === "preflop") {
    if (a.value === b.value) return a.value > 2 ? "bet4" : "check";
    if (a.value === 14) return "bet4";
    if (a.value === 13) return suited || b.value >= 5 ? "bet4" : "check";
    if (a.value === 12) return b.value >= (suited ? 6 : 8) ? "bet4" : "check";
    if (a.value === 11) return b.value >= (suited ? 8 : 10) ? "bet4" : "check";
    return "check";
  }

  const board = s.board.slice(0, s.street === "flop" ? 3 : 5);
  const hand = handScore([...s.player, ...board]);
  /** The made hand's category, when the hole cards lift it above what the board makes alone. */
  const lifted = rankOf(hand) > rankOf(handScore(board)) ? rankOf(hand) : -1;
  const boardRanks = board.map((c) => c[0]);
  const pocketPair = a.value === b.value;
  const hiddenPair = (pocketPair && a.value > 2) || s.player.some((c) => boardRanks.includes(c[0]));

  if (s.street === "flop") {
    if (lifted >= TWO_PAIR) return "bet2";
    if (hiddenPair) return "bet2";
    for (const hole of s.player) {
      const p = parseCard(hole);
      const suitCount = [...s.player, ...board].filter((c) => c[1] === p.suit).length;
      if (suitCount >= 4 && p.value >= 10) return "bet2";
    }
    return "check";
  }

  // River.
  if (hiddenPair || lifted >= PAIR) return "bet1";
  const seen = new Set<Card>([...s.player, ...board]);
  let outs = 0;
  for (const c of DECK) {
    if (seen.has(c)) continue;
    board.push(c);
    if (handScore(board) > hand) outs++;
    board.pop();
  }
  return outs < 21 ? "bet1" : "fold";
}

const DECK = freshDeck();
const rankOf = (score: number) => HAND_CATEGORIES.indexOf(categoryOf(score));
const PAIR = HAND_CATEGORIES.indexOf("pair");
const TWO_PAIR = HAND_CATEGORIES.indexOf("two_pair");
