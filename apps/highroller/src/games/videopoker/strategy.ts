import { type Card, parseCard } from "../cards.js";
import { classify } from "./engine.js";

/**
 * The Wizard of Odds' simple strategy for 9/6 Jacks or Better, which returns
 * 99.46% against 99.54% for perfect play. It drives the lifecycle and quest
 * tests (where `bestHold`, exact but slow, would take minutes) and is cheap
 * enough for a hint. Hold the first that applies:
 *
 *  1. A royal flush, straight flush or four of a kind
 *  2. Four to a royal flush
 *  3. Three of a kind, a straight, a flush or a full house
 *  4. Two pair
 *  5. A high pair (jacks or better)
 *  6. Three to a royal flush
 *  7. Four to a flush
 *  8. A low pair
 *  9. Four to an outside straight
 * 10. Two suited high cards
 * 11. Three to a straight flush
 * 12. Two unsuited high cards (the lowest two, when there are more)
 * 13. A suited ten with a jack, queen or king
 * 14. One high card
 * 15. Nothing
 */
export function simpleHold(cards: readonly Card[]): boolean[] {
  const ps = cards.map(parseCard);
  const hold = (pick: (i: number) => boolean) => ps.map((_, i) => pick(i));
  const hand = classify(cards);
  const byValue = new Map<number, number[]>();
  ps.forEach((p, i) => byValue.set(p.value, [...(byValue.get(p.value) ?? []), i]));
  const groups = [...byValue.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const suitIdx = (pred: (i: number) => boolean) => {
    const by = new Map<string, number[]>();
    ps.forEach((p, i) => pred(i) && by.set(p.suit, [...(by.get(p.suit) ?? []), i]));
    return [...by.values()].sort((a, b) => b.length - a.length);
  };
  const high = (i: number) => ps[i].value >= 11;
  const royalCards = suitIdx((i) => ps[i].value >= 10)[0] ?? [];
  const only = (idx: number[]) => hold((i) => idx.includes(i));

  if (hand === "royal_flush" || hand === "straight_flush" || hand === "quads") return hold(() => true);
  if (royalCards.length === 4) return only(royalCards);
  if (hand === "trips") return only(groups[0][1]);
  if (hand === "straight" || hand === "flush" || hand === "full_house") return hold(() => true);
  if (groups[0][1].length === 2 && groups[1][1].length === 2) return only([...groups[0][1], ...groups[1][1]]);
  if (hand === "jacks_or_better") return only(groups[0][1]);
  if (royalCards.length === 3) return only(royalCards);
  const flushDraw = suitIdx(() => true)[0];
  if (flushDraw.length === 4) return only(flushDraw);
  if (groups[0][1].length === 2) return only(groups[0][1]);

  // Four to an outside straight: four in a row, open at both ends (2-3-4-5 up to 10-J-Q-K).
  for (let low = 2; low <= 10; low++) {
    const run = [0, 1, 2, 3].map((k) => byValue.get(low + k)?.[0]);
    if (run.every((i) => i !== undefined)) return only(run as number[]);
  }

  const suitedHigh = suitIdx(high).find((g) => g.length >= 2);
  if (suitedHigh) return only(suitedHigh.slice(0, 2));

  // Three to a straight flush: three suited cards inside a five-rank window (the ace low too).
  for (const g of suitIdx(() => true).filter((g) => g.length >= 3)) {
    for (let low = 1; low <= 10; low++) {
      const inWindow = g.filter((i) => {
        const v = ps[i].value === 14 && low <= 1 ? 1 : ps[i].value;
        return v >= low && v <= low + 4;
      });
      if (inWindow.length >= 3) return only(inWindow.slice(0, 3));
    }
  }

  const highs = ps.map((_, i) => i).filter(high).sort((a, b) => ps[a].value - ps[b].value);
  if (highs.length >= 2) return only(highs.slice(0, 2));
  const tenWith = suitIdx((i) => ps[i].value >= 10 && ps[i].value <= 13).find((g) => g.length >= 2 && g.some((i) => ps[i].value === 10));
  if (tenWith) return only(tenWith.slice(0, 2));
  if (highs.length === 1) return only(highs);
  return hold(() => false);
}
