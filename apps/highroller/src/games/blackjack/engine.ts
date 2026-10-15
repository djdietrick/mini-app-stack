import { type Card, shoe } from "../cards.js";
import { type BetResult, type GameEngine, type TableLimits, checkStake, outcomeOf } from "../engine.js";
import { sample } from "../rng.js";

/**
 * Blackjack (#43). The rules are the constants below, so a later change is
 * one line and a re-run of the house-edge test:
 *
 * - Six decks, shuffled fresh every hand. Dealer stands on soft 17.
 * - Blackjack pays 3:2, rounded down (no half chips).
 * - Double on any first two cards, including after a split.
 * - Split pairs of equal value up to four hands. Split aces get one card each
 *   and can't be split again.
 * - Late surrender on the first two cards of an unsplit hand.
 * - Insurance (2:1, half the bet rounded down) when the dealer shows an ace,
 *   or even money on a player blackjack. The dealer then peeks on an ace or a
 *   ten, so a dealer blackjack ends the hand before any extra wager.
 *
 * The state machine is insurance → player hands → dealer → done; the dealer's
 * turn needs no decision, so it runs inside the action that ends the
 * player's last hand.
 *
 * `deal` draws the hand's whole future: the top 80 cards of a shuffled shoe.
 * No hand can use more. Each player hand stops before its total passes 20
 * (aces counted as 1) plus one card, so at most 30 in card values; the dealer
 * stops at 26. Four hands and the dealer come to at most 146, and the 72
 * smallest cards in a six-deck shoe (every ace, two and three) already add up
 * to 144.
 */
export const DECKS = 6;
export const MAX_HANDS = 4;
export const CARDS_DRAWN = 80;
export const BLACKJACK_LIMITS: TableLimits = { min: 10, max: 5_000, step: 5 };

/** Every card of the shoe in a fixed order; `deal` samples from it. */
const FULL_SHOE: readonly Card[] = shoe(DECKS);

export interface BlackjackBets {
  main: number;
}

export interface PlayerHand {
  cards: Card[];
  /** The stake before any double. */
  bet: number;
  doubled: boolean;
  /** Came from a split: 21 on two cards is not a blackjack. */
  split: boolean;
  /** Split aces: one card each, then done. */
  splitAces: boolean;
  surrendered: boolean;
  done: boolean;
}

export type Phase = "insurance" | "player" | "done";

export interface BlackjackState {
  bet: number;
  /** Private: the drawn cards, dealt in order from `next`. */
  shoe: Card[];
  next: number;
  /** [up card, hole card, …hits]. The hole card is private until `holeShown`. */
  dealer: Card[];
  holeShown: boolean;
  hands: PlayerHand[];
  /** The hand being played. */
  active: number;
  phase: Phase;
  /** The insurance stake, 0 when declined or never offered. */
  insurance: number;
  evenMoney: boolean;
}

export const ACTIONS = ["insurance", "no_insurance", "even_money", "hit", "stand", "double", "split", "surrender"] as const;
export type BlackjackAction = { type: (typeof ACTIONS)[number] };

export type HandOutcome = "blackjack" | "win" | "push" | "loss" | "bust" | "surrender";

export interface HandView {
  cards: Card[];
  bet: number;
  doubled: boolean;
  split: boolean;
  surrendered: boolean;
  /** Set once the hand is over. `returned` includes the stake. */
  result: { outcome: HandOutcome; returned: number } | null;
}

export interface BlackjackView {
  phase: Phase;
  /** null is the face-down hole card. */
  dealer: (Card | null)[];
  hands: HandView[];
  /** The hand being played, null outside the player phase. */
  active: number | null;
  insurance: number;
  evenMoney: boolean;
  /** What insurance came back with, once settled. */
  insuranceReturned: number | null;
}

// ---------- hand values ----------

/** 2–10, court cards 10, aces 1 (handValue makes one worth 11 when it fits). */
export function cardPoints(c: Card): number {
  const r = c[0];
  if (r === "A") return 1;
  if (r === "T" || r === "J" || r === "Q" || r === "K") return 10;
  return Number(r);
}

export interface HandValue {
  total: number;
  /** An ace is counting as 11. */
  soft: boolean;
}

export function handValue(cards: readonly Card[]): HandValue {
  let total = 0;
  let aces = false;
  for (const c of cards) {
    const p = cardPoints(c);
    total += p;
    if (p === 1) aces = true;
  }
  return aces && total + 10 <= 21 ? { total: total + 10, soft: true } : { total, soft: false };
}

/** "soft 17", "20", "bust", "blackjack". */
export function totalLabel(cards: readonly Card[], natural = false): string {
  const v = handValue(cards);
  if (v.total > 21) return "bust";
  if (natural && cards.length === 2 && v.total === 21) return "blackjack";
  return v.soft && v.total < 21 ? `soft ${v.total}` : String(v.total);
}

const isNatural = (h: PlayerHand) => !h.split && h.cards.length === 2 && handValue(h.cards).total === 21;
const dealerNatural = (s: BlackjackState) => s.dealer.length === 2 && handValue(s.dealer).total === 21;
const busted = (h: PlayerHand) => handValue(h.cards).total > 21;

// ---------- the state machine ----------

function draw(s: BlackjackState): [Card, BlackjackState] {
  if (s.next >= s.shoe.length) throw new Error("blackjack: shoe exhausted");
  return [s.shoe[s.next], { ...s, next: s.next + 1 }];
}

function withHand(s: BlackjackState, i: number, h: PlayerHand): BlackjackState {
  const hands = s.hands.slice();
  hands[i] = h;
  return { ...s, hands };
}

/** After the insurance decision (or straight after the deal): the peek, then the player's turn. */
function peek(s: BlackjackState): BlackjackState {
  if (dealerNatural(s)) return { ...s, phase: "done", holeShown: true, hands: s.hands.map((h) => ({ ...h, done: true })) };
  if (isNatural(s.hands[0])) return { ...s, phase: "done", holeShown: true, hands: [{ ...s.hands[0], done: true }] };
  return { ...s, phase: "player" };
}

/** Moves to the next hand that needs a decision, dealing split hands their second card; then the dealer. */
function advance(s: BlackjackState): BlackjackState {
  for (;;) {
    let h = s.hands[s.active];
    if (!h) return dealerTurn(s);
    if (!h.done && h.cards.length === 1) {
      const [c, after] = draw(s);
      h = { ...h, cards: [...h.cards, c] };
      s = withHand(after, s.active, h);
    }
    if (!h.done && (h.splitAces || handValue(h.cards).total >= 21)) {
      h = { ...h, done: true };
      s = withHand(s, s.active, h);
    }
    if (!h.done) return s;
    s = { ...s, active: s.active + 1 };
  }
}

function dealerTurn(s: BlackjackState): BlackjackState {
  s = { ...s, holeShown: true, phase: "done", active: s.hands.length - 1 };
  // The dealer only draws when some hand is still waiting on the result.
  if (s.hands.every((h) => h.surrendered || busted(h))) return s;
  while (handValue(s.dealer).total < 17) {
    const [c, after] = draw(s);
    s = { ...after, dealer: [...after.dealer, c] };
  }
  return s;
}

function legal(s: BlackjackState): string[] {
  if (s.phase === "done") return [];
  if (s.phase === "insurance") return isNatural(s.hands[0]) ? ["even_money", "no_insurance"] : ["insurance", "no_insurance"];
  const h = s.hands[s.active];
  const out = ["hit", "stand"];
  const two = h.cards.length === 2;
  if (two) out.push("double");
  if (two && cardPoints(h.cards[0]) === cardPoints(h.cards[1]) && s.hands.length < MAX_HANDS) out.push("split");
  if (two && s.hands.length === 1 && !h.split) out.push("surrender");
  return out;
}

function act(s: BlackjackState, action: BlackjackAction): BlackjackState | null {
  if (!legal(s).includes(action.type)) return null;
  const i = s.active;
  const h = s.hands[i];
  switch (action.type) {
    case "insurance":
      return peek({ ...s, insurance: Math.floor(s.bet / 2) });
    case "no_insurance":
      return peek(s);
    case "even_money":
      return { ...s, evenMoney: true, phase: "done", holeShown: true, hands: [{ ...h, done: true }] };
    case "hit": {
      const [c, after] = draw(s);
      return advance(withHand(after, i, { ...h, cards: [...h.cards, c] }));
    }
    case "stand":
      return advance(withHand(s, i, { ...h, done: true }));
    case "double": {
      const [c, after] = draw(s);
      return advance(withHand(after, i, { ...h, cards: [...h.cards, c], doubled: true, done: true }));
    }
    case "split": {
      const aces = h.cards[0][0] === "A";
      const left: PlayerHand = { ...h, cards: [h.cards[0]], split: true, splitAces: aces };
      const right: PlayerHand = { ...h, cards: [h.cards[1]], split: true, splitAces: aces };
      const hands = [...s.hands.slice(0, i), left, right, ...s.hands.slice(i + 1)];
      return advance({ ...s, hands });
    }
    case "surrender":
      return advance(withHand(s, i, { ...h, surrendered: true, done: true }));
  }
}

// ---------- settlement ----------

const stakeOf = (h: PlayerHand) => h.bet * (h.doubled ? 2 : 1);
const spotName = (s: BlackjackState, i: number) => (s.hands.length === 1 ? "main" : `hand${i + 1}`);

function handResult(s: BlackjackState, h: PlayerHand): { outcome: HandOutcome; returned: number } {
  const stake = stakeOf(h);
  if (s.evenMoney) return { outcome: "win", returned: 2 * stake };
  if (h.surrendered) return { outcome: "surrender", returned: Math.floor(h.bet / 2) };
  const natural = isNatural(h);
  if (dealerNatural(s)) return natural ? { outcome: "push", returned: stake } : { outcome: "loss", returned: 0 };
  if (natural) return { outcome: "blackjack", returned: stake + Math.floor((stake * 3) / 2) };
  const p = handValue(h.cards).total;
  if (p > 21) return { outcome: "bust", returned: 0 };
  const d = handValue(s.dealer).total;
  if (d > 21 || p > d) return { outcome: "win", returned: 2 * stake };
  return p === d ? { outcome: "push", returned: stake } : { outcome: "loss", returned: 0 };
}

const insuranceReturned = (s: BlackjackState) => (s.insurance > 0 && dealerNatural(s) ? s.insurance * 3 : 0);

function settle(s: BlackjackState) {
  const results: BetResult[] = s.hands.map((h, i) => {
    const r = handResult(s, h);
    return { spot: spotName(s, i), stake: stakeOf(h), returned: r.returned, outcome: outcomeOf(stakeOf(h), r.returned) };
  });
  if (s.insurance > 0) {
    const returned = insuranceReturned(s);
    results.push({ spot: "insurance", stake: s.insurance, returned, outcome: outcomeOf(s.insurance, returned) });
  }
  return { returned: results.reduce((n, r) => n + r.returned, 0), results };
}

/**
 * Basic play costs 0.31% (± 0.03%) of the first bet with these rules,
 * measured over 20 million hands with `basicStrategy`; published figures for
 * six decks, S17, DAS and late surrender agree. Doubles and splits make the
 * average hand wager 1.132 first bets, so per chip wagered the return is the
 * figure below.
 */
export const HOUSE_EDGE = 0.0031;
export const WAGER_PER_BET = 1.132;

/**
 * The hand as dealt from `cards` in order: player, dealer up, player, dealer
 * hole, then hits. `deal` passes a shuffled shoe; tests pass a stacked one.
 */
export function dealFrom(cards: Card[], bets: BlackjackBets): BlackjackState {
  const hand: PlayerHand = {
    cards: [cards[0], cards[2]],
    bet: bets.main,
    doubled: false,
    split: false,
    splitAces: false,
    surrendered: false,
    done: false,
  };
  const s: BlackjackState = {
    bet: bets.main,
    shoe: cards,
    next: 4,
    dealer: [cards[1], cards[3]],
    holeShown: false,
    hands: [hand],
    active: 0,
    phase: "insurance",
    insurance: 0,
    evenMoney: false,
  };
  return s.dealer[0][0] === "A" ? s : peek(s);
}

export const blackjack: GameEngine<BlackjackBets, BlackjackState, BlackjackAction, BlackjackView> = {
  validateBets(bets, limits) {
    return checkStake(bets.main, limits);
  },

  deal(bets, rng) {
    return dealFrom(sample(FULL_SHOE, CARDS_DRAWN, rng), bets);
  },

  legalActions: legal,
  act,
  isFinished: (s) => s.phase === "done",
  staked: (s) => s.hands.reduce((n, h) => n + stakeOf(h), 0) + s.insurance,
  settle,

  view(s) {
    const done = s.phase === "done";
    return {
      phase: s.phase,
      dealer: s.holeShown ? s.dealer : [s.dealer[0], null],
      hands: s.hands.map((h) => ({
        cards: h.cards,
        bet: h.bet,
        doubled: h.doubled,
        split: h.split,
        surrendered: h.surrendered,
        result: done ? handResult(s, h) : null,
      })),
      active: s.phase === "player" ? s.active : null,
      insurance: s.insurance,
      evenMoney: s.evenMoney,
      insuranceReturned: done && s.insurance > 0 ? insuranceReturned(s) : null,
    };
  },

  summary(s) {
    const results = s.hands.map((h) => handResult(s, h));
    const won = (o: HandOutcome) => o === "win" || o === "blackjack";
    return {
      blackjack: isNatural(s.hands[0]),
      bust: s.hands.some(busted),
      softWin: s.hands.some((h, i) => won(results[i].outcome) && handValue(h.cards).soft),
      splits: s.hands.length - 1,
      doubled: s.hands.some((h) => h.doubled),
      dealerBust: handValue(s.dealer).total > 21,
      surrendered: s.hands.some((h) => h.surrendered),
      insurance: s.insurance > 0,
      evenMoney: s.evenMoney,
    };
  },

  theoreticalRtp() {
    return 1 - HOUSE_EDGE / WAGER_PER_BET;
  },
};
