import { type Rng, shuffle } from "./rng.js";

/**
 * Playing cards. A card travels as its compact string ("Ah", "Td", "2c"):
 * that is what hand state, views and the wire carry, so a stored shoe stays
 * small and readable. `parseCard` turns one back into rank and suit.
 */
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const SUITS = ["c", "d", "h", "s"] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
/** Compact form: rank then suit, e.g. "Ah", "Td". */
export type Card = `${Rank}${Suit}`;

export interface ParsedCard {
  rank: Rank;
  suit: Suit;
  /** 2–14, ace high. */
  value: number;
}

export function card(rank: Rank, suit: Suit): Card {
  return `${rank}${suit}`;
}

export function isCard(s: string): s is Card {
  return s.length === 2 && (RANKS as readonly string[]).includes(s[0]) && (SUITS as readonly string[]).includes(s[1]);
}

export function parseCard(c: Card): ParsedCard {
  const rank = c[0] as Rank;
  return { rank, suit: c[1] as Suit, value: RANKS.indexOf(rank) + 2 };
}

export const isRed = (c: Card) => c[1] === "h" || c[1] === "d";

/** One 52-card deck in a fixed order (by suit, then rank). */
export function freshDeck(): Card[] {
  return SUITS.flatMap((s) => RANKS.map((r) => card(r, s)));
}

/** `decks` fresh decks together, shuffled when an rng is given. */
export function shoe(decks: number, rng?: Rng): Card[] {
  const cards = Array.from({ length: decks }, freshDeck).flat();
  return rng ? shuffle(cards, rng) : cards;
}
