import { type Card, shoe } from "../cards.js";
import { type BetResult, type GameEngine, type TableLimits, checkStake, outcomeOf } from "../engine.js";
import { sample } from "../rng.js";

/**
 * Baccarat (#53), punto banco. A single-decision game: you bet on Player,
 * Banker or Tie (any of them, together), the cards are dealt by fixed rules,
 * and the hand settles in the transaction that takes the bets.
 *
 * - Eight decks, shuffled fresh every hand. Aces count 1, tens and court
 *   cards 0, a hand's total is its cards' sum mod 10.
 * - Two cards each, dealt Player, Banker, Player, Banker. An 8 or 9 on either
 *   side (a natural) and both stand.
 * - Player draws a third card on 0–5. Banker then draws by the tableau
 *   (BANKER_DRAWS), or on 0–5 when Player stood.
 * - Player pays 1:1. Banker pays 1:1 less a 5% commission, rounded down (no
 *   half chips). Tie pays 8:1, and Player and Banker bets push on a tie.
 *
 * No hand uses more than six cards, so `deal` draws just those from a
 * shuffled shoe.
 */
export const DECKS = 8;
export const CARDS_DRAWN = 6;
export const BACCARAT_LIMITS: TableLimits = { min: 10, max: 5_000, step: 5 };

const FULL_SHOE: readonly Card[] = shoe(DECKS);

export const SPOTS = ["player", "banker", "tie"] as const;
export type Spot = (typeof SPOTS)[number];
export type Winner = Spot;

export type BaccaratBets = Partial<Record<Spot, number>>;

/** "x to 1", before Banker's commission. */
export const PAYS: Record<Spot, number> = { player: 1, banker: 1, tie: 8 };
export const COMMISSION = 0.05;

/**
 * The tableau when Player drew: for each Banker total, the values of
 * Player's third card on which Banker draws. Banker always draws on 0–2 and
 * always stands on 7. (A ten or court card is 0.)
 */
export const BANKER_DRAWS: Record<number, readonly number[]> = {
  0: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  1: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  2: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  3: [0, 1, 2, 3, 4, 5, 6, 7, 9],
  4: [2, 3, 4, 5, 6, 7],
  5: [4, 5, 6, 7],
  6: [6, 7],
  7: [],
};

/**
 * Exact outcome probabilities for eight decks, dealt without replacement
 * (baccarat.test.ts enumerates every sequence of cards to check them).
 */
export const P_PLAYER = 0.44624660934;
export const P_BANKER = 0.45859742263;
export const P_TIE = 0.09515596802;

export interface BaccaratState {
  bets: Required<BaccaratBets>;
  player: Card[];
  banker: Card[];
}

export interface BaccaratView {
  bets: Required<BaccaratBets>;
  /** In the order dealt: the first two, then the third card if drawn. */
  player: Card[];
  banker: Card[];
  playerTotal: number;
  bankerTotal: number;
  winner: Winner;
  natural: boolean;
  /** Chips back on each spot, stakes included. */
  returned: Record<Spot, number>;
}

/** A card's baccarat value: ace 1, two to nine at face, tens and court cards 0. */
export function pointOf(c: Card): number {
  const r = c[0];
  if (r === "A") return 1;
  if (r === "T" || r === "J" || r === "Q" || r === "K") return 0;
  return Number(r);
}

export const totalOf = (cards: readonly Card[]) => cards.reduce((s, c) => s + pointOf(c), 0) % 10;

/**
 * The coup played out from the top of a stacked shoe: who gets which card.
 * Works on values only, so the enumeration in the test can share it.
 */
export function playCoup(points: readonly number[]): { player: number; banker: number } {
  let p = (points[0] + points[2]) % 10;
  let b = (points[1] + points[3]) % 10;
  let next = 4;
  if (p >= 8 || b >= 8) return { player: 2, banker: 2 };
  let p3: number | null = null;
  if (p <= 5) {
    p3 = points[next++];
    p = (p + p3) % 10;
  }
  const bankerDraws = p3 === null ? b <= 5 : BANKER_DRAWS[b].includes(p3);
  return { player: p3 === null ? 2 : 3, banker: bankerDraws ? 3 : 2 };
}

/** The hand dealt from the top of `cards` (six is enough). Tests pass a stacked shoe. */
export function dealFrom(cards: readonly Card[], bets: BaccaratBets): BaccaratState {
  const n = playCoup(cards.map(pointOf));
  const player = [cards[0], cards[2]];
  const banker = [cards[1], cards[3]];
  // Player's third card comes off first, then Banker's.
  if (n.player === 3) player.push(cards[4]);
  if (n.banker === 3) banker.push(cards[n.player === 3 ? 5 : 4]);
  return { bets: { player: bets.player ?? 0, banker: bets.banker ?? 0, tie: bets.tie ?? 0 }, player, banker };
}

function winnerOf(s: BaccaratState): Winner {
  const p = totalOf(s.player);
  const b = totalOf(s.banker);
  return p > b ? "player" : b > p ? "banker" : "tie";
}

const isNatural = (s: BaccaratState) => totalOf(s.player.slice(0, 2)) >= 8 || totalOf(s.banker.slice(0, 2)) >= 8;

/** Chips back from a spot's stake given the winner, the stake included. */
export function spotReturn(spot: Spot, stake: number, winner: Winner): number {
  if (!stake) return 0;
  if (winner === "tie") return spot === "tie" ? stake * (PAYS.tie + 1) : stake;
  if (spot !== winner) return 0;
  return spot === "banker" ? stake + Math.floor(stake * (1 - COMMISSION)) : stake * (PAYS[spot] + 1);
}

function returns(s: BaccaratState): Record<Spot, number> {
  const w = winnerOf(s);
  return { player: spotReturn("player", s.bets.player, w), banker: spotReturn("banker", s.bets.banker, w), tie: spotReturn("tie", s.bets.tie, w) };
}

/** What a stake on a spot returns on average, its own rounding included. */
export function expectedSpotReturn(spot: Spot, stake: number): number {
  return P_PLAYER * spotReturn(spot, stake, "player") + P_BANKER * spotReturn(spot, stake, "banker") + P_TIE * spotReturn(spot, stake, "tie");
}

/** Return per chip, before rounding: Player 98.76%, Banker 98.94%, Tie 85.64%. */
export const SPOT_RTP: Record<Spot, number> = {
  player: P_PLAYER * 2 + P_TIE,
  banker: P_BANKER * (2 - COMMISSION) + P_TIE,
  tie: P_TIE * (PAYS.tie + 1),
};

export const baccarat: GameEngine<BaccaratBets, BaccaratState, { type: string }, BaccaratView> = {
  validateBets(bets, limits) {
    const placed = SPOTS.filter((s) => bets[s] !== undefined && bets[s] !== 0);
    if (!placed.length) return "place a bet";
    for (const s of placed) {
      const bad = checkStake(bets[s]!, limits);
      if (bad) return bad;
    }
    return null;
  },

  deal(bets, rng) {
    return dealFrom(sample(FULL_SHOE, CARDS_DRAWN, rng), bets);
  },

  legalActions: () => [],
  act: () => null,
  isFinished: () => true,
  staked: (s) => s.bets.player + s.bets.banker + s.bets.tie,

  expectedReturn(s) {
    return SPOTS.reduce((n, spot) => n + expectedSpotReturn(spot, s.bets[spot]), 0);
  },

  settle(s) {
    const r = returns(s);
    const results: BetResult[] = SPOTS.filter((spot) => s.bets[spot] > 0).map((spot) => ({
      spot,
      stake: s.bets[spot],
      returned: r[spot],
      outcome: outcomeOf(s.bets[spot], r[spot]),
    }));
    return { returned: r.player + r.banker + r.tie, results };
  },

  view(s) {
    return {
      bets: s.bets,
      player: s.player,
      banker: s.banker,
      playerTotal: totalOf(s.player),
      bankerTotal: totalOf(s.banker),
      winner: winnerOf(s),
      natural: isNatural(s),
      returned: returns(s),
    };
  },

  summary(s) {
    const winner = winnerOf(s);
    return {
      winner,
      natural: isNatural(s),
      playerTotal: totalOf(s.player),
      bankerTotal: totalOf(s.banker),
      total: winner === "banker" ? totalOf(s.banker) : totalOf(s.player),
      tieWon: winner === "tie" && s.bets.tie > 0,
      backedWinner: winner !== "tie" && s.bets[winner] > 0,
    };
  },

  /** The best bet's (Banker's) return; stats use `expectedReturn`, per spot. */
  theoreticalRtp() {
    return SPOT_RTP.banker;
  },
};
