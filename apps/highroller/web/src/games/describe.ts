import type { BaccaratView } from "../../../src/games/baccarat/engine.js";
import { type BlackjackView, handValue } from "../../../src/games/blackjack/engine.js";
import type { Card } from "../../../src/games/cards.js";
import { pocketColor, pocketLabel } from "../../../src/games/roulette/engine.js";
import type { RouletteView } from "../../../src/games/roulette/engine.js";
import type { SlotsView } from "../../../src/games/slots/engine.js";
import type { ThreeCardView } from "../../../src/games/threecard/engine.js";
import type { UthView } from "../../../src/games/uth/engine.js";
import { HAND_NAMES, type VideoPokerView } from "../../../src/games/videopoker/engine.js";
import type { HandRow } from "../api";
import { chips } from "../format";

/**
 * The tables in words, for screen readers. Each table screen passes one of
 * these to TableFrame, which puts it in an `aria-live` region: the canvas
 * shows the hand, and this says it ("Dealer shows 7. You have 16. Hit or
 * stand?"). Screens describe the hand the canvas has finished showing
 * (useHand's `seen`), so the words never get ahead of the cards.
 */

const RANK_WORDS: Record<string, string> = {
  A: "ace",
  K: "king",
  Q: "queen",
  J: "jack",
  T: "10",
};
const SUIT_WORDS: Record<string, string> = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };

/** "Ah" → "ace of hearts". */
export const cardWords = (c: Card) => `${RANK_WORDS[c[0]] ?? c[0]} of ${SUIT_WORDS[c[1]]}`;
const cardsWords = (cs: readonly Card[]) => cs.map(cardWords).join(", ");

const list = (items: string[], and = "and") =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;

/** "You won 150." / "You lost 100." / "Push." */
export function resultWords(h: HandRow): string {
  const net = h.returned - h.wagered;
  return net > 0 ? `You won ${chips(net)}.` : net < 0 ? `You lost ${chips(-net)}.` : "Push: your bet comes back.";
}

/** What is on the felt between hands: the bets, and how to deal. */
export function betsWords(
  bets: Record<string, number>,
  names: Record<string, string> | ((spot: string) => string),
  deal = "Space to deal",
): string {
  const placed = Object.entries(bets).filter(([, n]) => n > 0);
  if (!placed.length) return "No bets placed. Pick a chip (keys 1 to 6), then a bet spot (Tab to the spots).";
  const name = (k: string) => (typeof names === "function" ? names(k) : (names[k] ?? k));
  return `Your bets: ${list(placed.map(([k, n]) => `${name(k)} ${chips(n)}`))}. ${deal}.`;
}

const ROULETTE_NAMES: Record<string, string> = {
  red: "Red",
  black: "Black",
  odd: "Odd",
  even: "Even",
  low: "1 to 18",
  high: "19 to 36",
  "dozen:1-12": "1st 12",
  "dozen:13-24": "2nd 12",
  "dozen:25-36": "3rd 12",
  "column:1": "Column 1",
  "column:2": "Column 2",
  "column:3": "Column 3",
};

/** The outside bets, for the keyboard's spot buttons, by spot key (engine.ts `spotKey`). */
export const ROULETTE_OUTSIDE = Object.entries(ROULETTE_NAMES).map(([id, label]) => ({ id, label }));

/** A roulette spot key in words: "straight:17" → "straight up 17", "split:0-00" → "split 0 and 00". */
export function rouletteSpotName(key: string): string {
  if (ROULETTE_NAMES[key]) return ROULETTE_NAMES[key];
  const [kind, rest = ""] = key.split(":");
  const numbers = list(rest.split("-"));
  return kind === "straight" ? `straight up ${numbers}` : `${kind} ${numbers}`;
}

const ACTION_WORDS: Record<string, string> = {
  hit: "hit (H)",
  stand: "stand (S)",
  double: "double (D)",
  split: "split (P)",
  surrender: "surrender (R)",
  insurance: "insurance (I)",
  no_insurance: "no insurance (N)",
  even_money: "even money (E)",
  check: "check (C)",
  bet4: "bet 4 times (4)",
  bet3: "bet 3 times (3)",
  bet2: "bet 2 times (2)",
  bet1: "bet once (1)",
  fold: "fold (F)",
  play: "play (P)",
};

const choices = (legal: readonly string[]) => (legal.length ? ` ${list(legal.map((a) => ACTION_WORDS[a] ?? a), "or")}?` : "");
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function describeBlackjack(h: HandRow): string {
  const v = h.view as BlackjackView;
  const up = v.dealer[0];
  const shown = v.dealer.filter((c): c is Card => c !== null);
  const dealerTotal = handValue(shown).total;
  const dealer =
    v.phase === "done"
      ? `Dealer has ${cardsWords(shown)}, ${dealerTotal > 21 ? "bust" : dealerTotal}.`
      : up
        ? `Dealer shows ${cardWords(up)}.`
        : "";
  const hands = v.hands.map((hand, i) => {
    const value = handValue(hand.cards);
    const name = v.hands.length > 1 ? `Hand ${i + 1}` : "You";
    const total = value.total > 21 ? "bust" : `${value.soft ? "soft " : ""}${value.total}`;
    const outcome = hand.result ? `, ${hand.result.outcome}` : "";
    return `${name} ${v.hands.length > 1 ? "has" : "have"} ${cardsWords(hand.cards)}: ${total}${outcome}.`;
  });
  const side = [v.side.perfectPairs, v.side.twentyOnePlusThree]
    .flatMap((s, i) => (s && s.returned > 0 ? [`${i === 0 ? "Perfect Pairs" : "21+3"} pays ${chips(s.returned - s.stake)}.`] : []))
    .join(" ");
  const tail = h.status === "settled" ? resultWords(h) : v.phase === "insurance" ? `Dealer shows an ace.${choices(h.legal_actions)}` : cap(choices(h.legal_actions).trim());
  return [dealer, ...hands, side, tail].filter(Boolean).join(" ");
}

export function describeUth(h: HandRow): string {
  const v = h.view as UthView;
  const parts = [`You have ${cardsWords(v.player)}.`];
  if (v.board.length) parts.push(`Board: ${cardsWords(v.board)}.`);
  if (v.showdown) {
    parts.push(`Dealer has ${v.showdown.dealer.label}${v.showdown.dealerQualifies ? "" : ", not qualifying"}. You have ${v.showdown.player.label}.`);
  }
  if (v.folded) parts.push("You folded.");
  parts.push(h.status === "settled" ? resultWords(h) : cap(choices(h.legal_actions).trim()));
  return parts.join(" ");
}

export function describeThreeCard(h: HandRow): string {
  const v = h.view as ThreeCardView;
  const parts = [`You have ${cardsWords(v.player)}: ${v.label}.`];
  if (v.showdown) parts.push(`Dealer has ${v.showdown.dealer.label}${v.showdown.dealerQualifies ? "" : ", not qualifying"}.`);
  if (v.folded) parts.push("You folded.");
  parts.push(h.status === "settled" ? resultWords(h) : cap(choices(h.legal_actions).trim()));
  return parts.join(" ");
}

export function describeBaccarat(h: HandRow): string {
  const v = h.view as BaccaratView;
  const winner = v.winner === "tie" ? "It's a tie" : `${cap(v.winner)} wins`;
  return `Player has ${cardsWords(v.player)}: ${v.playerTotal}. Banker has ${cardsWords(v.banker)}: ${v.bankerTotal}. ${winner}${v.natural ? " with a natural" : ""}. ${resultWords(h)}`;
}

export function describeRoulette(h: HandRow): string {
  const v = h.view as RouletteView;
  const color = pocketColor(v.pocket);
  return `The ball lands on ${pocketLabel(v.pocket)} ${color}. ${resultWords(h)}`;
}

export function describeVideoPoker(h: HandRow): string {
  const v = h.view as VideoPokerView;
  const cards = v.cards.map((c, i) => `${i + 1}: ${cardWords(c)}${v.held?.[i] ? ", held" : ""}`).join("; ");
  if (v.phase === "hold") {
    return `Dealt ${cards}. ${v.hand === "nothing" ? "" : `${HAND_NAMES[v.hand]}. `}Keys 1 to 5 hold cards, Space draws.`;
  }
  return `Drew ${cards}. ${v.hand === "nothing" ? "Nothing." : `${HAND_NAMES[v.hand]}.`} ${resultWords(h)}`;
}

export function describeSlots(h: HandRow): string {
  const v = h.view as SlotsView;
  const [first, ...free] = v.spins;
  const wins = first.lineWins.length;
  const parts = [
    `Reels stop: ${first.grid.map((reel) => reel[1]).join(", ")} on the middle row.`,
    wins ? `${wins} winning line${wins > 1 ? "s" : ""}.` : "No winning lines.",
  ];
  if (free.length) parts.push(`${free.length} free spins.`);
  parts.push(resultWords(h));
  return parts.join(" ");
}
