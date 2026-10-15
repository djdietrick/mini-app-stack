import type { Card } from "../cards.js";
import { type BlackjackAction, cardPoints, handValue } from "./engine.js";

/**
 * Basic strategy for these rules (six decks, S17, DAS, late surrender, no
 * resplit aces): the play with the best expected value for each hand against
 * each dealer up card, ignoring which other cards are gone. It drives the
 * house-edge test and is exported for later use (a hint, a coach).
 *
 * `legal` is the hand's legal actions; a play that isn't legal (doubling on
 * three cards) falls back the way the printed charts do: double → hit, or
 * stand on soft 18; surrender → hit. Insurance and even money are always
 * declined.
 */
export function basicStrategy(cards: readonly Card[], up: Card, legal: readonly string[]): BlackjackAction["type"] {
  if (legal.includes("no_insurance")) return "no_insurance";
  const d = cardPoints(up) === 1 ? 11 : cardPoints(up);
  const can = (a: string) => legal.includes(a);

  if (can("split")) {
    const p = cardPoints(cards[0]);
    const split =
      p === 1 ||
      p === 8 ||
      (p === 9 && d !== 7 && d < 10) ||
      (p === 7 && d <= 7) ||
      (p === 6 && d <= 6) ||
      (p === 4 && (d === 5 || d === 6)) ||
      ((p === 2 || p === 3) && d <= 7);
    if (split) return "split";
  }

  const { total, soft } = handValue(cards);

  if (can("surrender") && !soft && ((total === 16 && d >= 9) || (total === 15 && d === 10))) return "surrender";

  if (soft) {
    if (total >= 19) return "stand";
    if (total === 18) {
      if (d >= 3 && d <= 6) return can("double") ? "double" : "stand";
      return d <= 8 ? "stand" : "hit";
    }
    const doubleFrom = total === 17 ? 3 : total >= 15 ? 4 : 5;
    if (total >= 13 && d >= doubleFrom && d <= 6 && can("double")) return "double";
    return "hit";
  }

  if (total >= 17) return "stand";
  if (total >= 13) return d <= 6 ? "stand" : "hit";
  if (total === 12) return d >= 4 && d <= 6 ? "stand" : "hit";
  if (total === 11) return d <= 10 && can("double") ? "double" : "hit";
  if (total === 10) return d <= 9 && can("double") ? "double" : "hit";
  if (total === 9) return d >= 3 && d <= 6 && can("double") ? "double" : "hit";
  return "hit";
}
