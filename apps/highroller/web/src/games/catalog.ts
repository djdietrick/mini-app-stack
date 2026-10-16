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
  /** For a game with variants: the lobby offers each, the first the default. */
  variants?: { id: string; name: string }[];
}

export const GAME_TILES: GameTile[] = [
  { id: "blackjack", name: "Blackjack", blurb: "Beat the dealer to 21. Pays 3 to 2.", colors: ["#14532d", "#0f3d24"], glyph: "♠", playable: true },
  { id: "uth", name: "Ultimate Texas Hold'em", blurb: "Your hold'em hand against the dealer's.", colors: ["#7f1d1d", "#4c0f0f"], glyph: "♥", playable: true },
  {
    id: "roulette",
    name: "Roulette",
    blurb: "European or American wheel.",
    colors: ["#1e293b", "#0b1220"],
    glyph: "◎",
    playable: true,
    variants: [
      { id: "european", name: "European" },
      { id: "american", name: "American" },
    ],
  },
  { id: "baccarat", name: "Baccarat", blurb: "Player, Banker or Tie.", colors: ["#3b0764", "#21043a"], glyph: "♦", playable: true },
  { id: "threecard", name: "Three Card Poker", blurb: "Ante and play, with Pair Plus.", colors: ["#713f12", "#3f2309"], glyph: "♣", playable: true },
  { id: "videopoker", name: "Video Poker", blurb: "Jacks or Better.", colors: ["#0c4a6e", "#062a40"], glyph: "J", playable: true },
  { id: "slots", name: "Slots", blurb: "Five reels, 20 lines and free spins.", colors: ["#854d0e", "#4a2b07"], glyph: "7", playable: true },
];
