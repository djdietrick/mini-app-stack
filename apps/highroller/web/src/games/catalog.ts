/**
 * The lobby's tiles, in the order they appear. `id` is the registry id the
 * server uses (src/domain/registry.ts). A game is playable once its engine is
 * registered and its screen exists; until then its tile says "coming soon".
 */
export interface GameTile {
  id: string;
  name: string;
  blurb: string;
  /** The card art's two colours. */
  colors: [string, string];
  /** A suit or symbol for the tile. */
  glyph: string;
  playable: boolean;
}

export const GAME_TILES: GameTile[] = [
  { id: "blackjack", name: "Blackjack", blurb: "Beat the dealer to 21. Side bets: Perfect Pairs, 21+3.", colors: ["#14532d", "#0f3d24"], glyph: "♠", playable: false },
  { id: "uth", name: "Ultimate Texas Hold'em", blurb: "Your hand against the dealer's, with Trips.", colors: ["#7f1d1d", "#4c0f0f"], glyph: "♥", playable: false },
  { id: "roulette", name: "Roulette", blurb: "European or American wheel.", colors: ["#1e293b", "#0b1220"], glyph: "◎", playable: false },
  { id: "baccarat", name: "Baccarat", blurb: "Player, Banker or Tie.", colors: ["#3b0764", "#21043a"], glyph: "♦", playable: false },
  { id: "threecard", name: "Three Card Poker", blurb: "Ante and play, with Pair Plus.", colors: ["#713f12", "#3f2309"], glyph: "♣", playable: false },
  { id: "videopoker", name: "Video Poker", blurb: "Jacks or Better.", colors: ["#0c4a6e", "#062a40"], glyph: "J", playable: false },
  { id: "slots", name: "Slots", blurb: "Five reels and the shared jackpot.", colors: ["#854d0e", "#4a2b07"], glyph: "7", playable: false },
];
