import { conflict } from "@stack/service-kit";
import type { HandSummary } from "../games/engine.js";
import { HAND_CATEGORIES, type HandCategory } from "../games/poker/eval.js";
import { THREE_CARD_CATEGORIES, type ThreeCardCategory } from "../games/poker/rank3.js";
import { VP_HANDS, type VpHand } from "../games/videopoker/engine.js";
import { PAID_ITEMS, type ShopItem } from "./catalog.js";
import { applyCreditTo } from "./economy.js";
import type { LedgerEntry, PlayerRecord, QuestProgressRecord } from "./types.js";

/**
 * Quests and achievements: definitions as code, and the pure rules that pick
 * them, fold progress into them and pay them out.
 *
 * - Daily and weekly quests come from the pools below. Each player gets
 *   three of each per period, picked from a hash of (user, period), so they
 *   need no scheduler and no storage until there is progress. The period is
 *   `d:YYYY-MM-DD` (the player's calendar day) or `w:YYYY-Www` (the ISO week
 *   of that day).
 * - Achievements are permanent (period `ever`) and tiered: one progress row
 *   per achievement, a tier is done when progress reaches its target, and
 *   each tier is claimed in turn.
 * - Progress is folded in the transaction that caused it: a settled hand
 *   (settle.ts) or a purchase (the shop). It never falls, so a completed
 *   tier stays completed.
 * - Rewards are claimed, never paid automatically.
 *
 * Ids are fixed. Never change one: progress rows are keyed by them.
 */

export interface Reward {
  chips: number;
  xp: number;
}

/**
 * How an event moves a quest:
 *  - count:     adds what it returns
 *  - best:      progress is the largest value seen
 *  - streak:    true extends the run, false ends it, null leaves it alone;
 *               progress is the longest run
 *  - distinct:  marks a key; progress is how many different keys
 *  - purchases: each shop purchase adds one (achievements)
 */
export type Match =
  | { count: (s: HandSummary) => number }
  | { best: (s: HandSummary) => number }
  | { streak: (s: HandSummary) => boolean | null }
  | { distinct: (s: HandSummary) => string | null }
  | { purchases: true };

export interface QuestDef {
  id: string;
  kind: "daily" | "weekly";
  /** The game it needs; absent when any game counts. Spreads the picks and drops quests for games not on offer. */
  game?: string;
  text: string;
  target: number;
  reward: Reward;
  match: Match;
}

export interface AchievementTier {
  target: number;
  reward: Reward;
}

export interface AchievementDef {
  id: string;
  kind: "achievement";
  name: string;
  game?: string;
  /** The goal for one tier's target. */
  text: (target: number) => string;
  /** Ascending targets. */
  tiers: AchievementTier[];
  match: Match;
}

export type AnyQuest = QuestDef | AchievementDef;

/** What happened: a settled hand, or a purchase. */
export type QuestEvent = { hand: HandSummary } | { purchase: ShopItem };

// ---------- fact readers ----------

const win = (s: HandSummary) => s.outcome === "win";
const one = (b: boolean) => (b ? 1 : 0);
const rankAtLeast = (s: HandSummary, at: HandCategory) =>
  s.game === "uth" &&
  s.facts.folded !== true &&
  HAND_CATEGORIES.indexOf(s.facts.handRank as HandCategory) >= HAND_CATEGORIES.indexOf(at);
/** A played Three Card Poker hand of `at` or better. */
const rank3AtLeast = (s: HandSummary, at: ThreeCardCategory) =>
  s.game === "threecard" &&
  s.facts.folded !== true &&
  THREE_CARD_CATEGORIES.indexOf(s.facts.handRank as ThreeCardCategory) >= THREE_CARD_CATEGORIES.indexOf(at);
/** A final video poker hand of `at` or better (VP_HANDS runs best first). */
const vpAtLeast = (s: HandSummary, at: VpHand) =>
  s.game === "videopoker" && VP_HANDS.indexOf(s.facts.handRank as VpHand) <= VP_HANDS.indexOf(at);
/** A win, a loss, or (for a push) nothing either way. */
const winRun = (s: HandSummary) => (s.outcome === "push" ? null : win(s));

const fmt = (n: number) => n.toLocaleString("en-US");
const r = (chips: number, xp: number): Reward => ({ chips, xp });

// ---------- daily ----------

export const DAILY_QUESTS: readonly QuestDef[] = [
  { id: "d-play-10", kind: "daily", text: "Play 10 hands", target: 10, reward: r(1_000, 40), match: { count: () => 1 } },
  { id: "d-win-5", kind: "daily", text: "Win 5 hands", target: 5, reward: r(1_500, 50), match: { count: (s) => one(win(s)) } },
  { id: "d-wager-10k", kind: "daily", text: "Wager 10,000 chips", target: 10_000, reward: r(1_500, 50), match: { count: (s) => s.wagered } },
  { id: "d-games-2", kind: "daily", text: "Play 2 different games", target: 2, reward: r(1_000, 40), match: { distinct: (s) => s.game } },
  { id: "d-streak-3", kind: "daily", text: "Win 3 hands in a row", target: 3, reward: r(2_000, 60), match: { streak: winRun } },
  { id: "d-big-win", kind: "daily", text: "Win 1,000 chips on one hand", target: 1, reward: r(2_000, 60), match: { count: (s) => one(s.net >= 1_000) } },

  { id: "d-bj-play-15", kind: "daily", game: "blackjack", text: "Play 15 hands of blackjack", target: 15, reward: r(1_000, 40), match: { count: (s) => one(s.game === "blackjack") } },
  { id: "d-bj-natural", kind: "daily", game: "blackjack", text: "Get a blackjack", target: 1, reward: r(1_500, 50), match: { count: (s) => one(s.facts.blackjack === true) } },
  { id: "d-bj-soft-3", kind: "daily", game: "blackjack", text: "Win 3 hands with a soft total", target: 3, reward: r(2_000, 60), match: { count: (s) => one(s.facts.softWin === true) } },
  { id: "d-bj-double-2", kind: "daily", game: "blackjack", text: "Win 2 doubled hands", target: 2, reward: r(2_000, 60), match: { count: (s) => one(s.facts.doubled === true && win(s)) } },
  { id: "d-bj-split-2", kind: "daily", game: "blackjack", text: "Split 2 pairs", target: 2, reward: r(1_500, 50), match: { count: (s) => (s.game === "blackjack" ? Number(s.facts.splits) || 0 : 0) } },
  { id: "d-bj-dealer-bust-3", kind: "daily", game: "blackjack", text: "Win 3 hands when the dealer busts", target: 3, reward: r(1_500, 50), match: { count: (s) => one(s.facts.dealerBust === true && win(s)) } },

  { id: "d-uth-play-10", kind: "daily", game: "uth", text: "Play 10 hands of Ultimate Texas Hold'em", target: 10, reward: r(1_000, 40), match: { count: (s) => one(s.game === "uth") } },
  { id: "d-uth-win-4", kind: "daily", game: "uth", text: "Win 4 hands of Ultimate Texas Hold'em", target: 4, reward: r(1_500, 50), match: { count: (s) => one(s.game === "uth" && s.facts.won === true) } },
  { id: "d-uth-flush", kind: "daily", game: "uth", text: "Make a flush or better in UTH", target: 1, reward: r(2_000, 60), match: { count: (s) => one(rankAtLeast(s, "flush")) } },
  { id: "d-uth-preflop-2", kind: "daily", game: "uth", text: "Raise preflop and win, twice", target: 2, reward: r(2_000, 60), match: { count: (s) => one(s.game === "uth" && s.facts.raiseStreet === "preflop" && s.facts.won === true) } },
  { id: "d-uth-trips", kind: "daily", game: "uth", text: "Win a Trips side bet", target: 1, reward: r(2_000, 60), match: { count: (s) => one(s.game === "uth" && typeof s.facts.tripsHand === "string" && s.facts.tripsHand !== "none") } },

  { id: "d-rl-spins-15", kind: "daily", game: "roulette", text: "Spin the wheel 15 times", target: 15, reward: r(1_000, 40), match: { count: (s) => one(s.game === "roulette") } },
  { id: "d-rl-straight", kind: "daily", game: "roulette", text: "Hit a straight-up number", target: 1, reward: r(2_000, 60), match: { count: (s) => one(s.facts.straightUp === true) } },
  { id: "d-rl-red-5", kind: "daily", game: "roulette", text: "Land on red 5 times", target: 5, reward: r(1_000, 40), match: { count: (s) => one(s.game === "roulette" && s.facts.color === "red") } },
  { id: "d-rl-zero", kind: "daily", game: "roulette", text: "Land on a zero", target: 1, reward: r(1_500, 50), match: { count: (s) => one(s.game === "roulette" && s.facts.color === "green") } },
  { id: "d-rl-win-5", kind: "daily", game: "roulette", text: "Win 5 spins", target: 5, reward: r(1_500, 50), match: { count: (s) => one(s.game === "roulette" && win(s)) } },

  { id: "d-bac-play-10", kind: "daily", game: "baccarat", text: "Play 10 hands of baccarat", target: 10, reward: r(1_000, 40), match: { count: (s) => one(s.game === "baccarat") } },
  { id: "d-bac-natural-3", kind: "daily", game: "baccarat", text: "See 3 naturals at baccarat", target: 3, reward: r(1_000, 40), match: { count: (s) => one(s.game === "baccarat" && s.facts.natural === true) } },
  { id: "d-bac-backed-5", kind: "daily", game: "baccarat", text: "Back the winning side 5 times", target: 5, reward: r(1_500, 50), match: { count: (s) => one(s.game === "baccarat" && s.facts.backedWinner === true) } },
  { id: "d-bac-tie", kind: "daily", game: "baccarat", text: "Win a Tie bet", target: 1, reward: r(2_000, 60), match: { count: (s) => one(s.game === "baccarat" && s.facts.tieWon === true) } },

  { id: "d-3cp-play-10", kind: "daily", game: "threecard", text: "Play 10 hands of Three Card Poker", target: 10, reward: r(1_000, 40), match: { count: (s) => one(s.game === "threecard") } },
  { id: "d-3cp-win-4", kind: "daily", game: "threecard", text: "Win 4 hands of Three Card Poker", target: 4, reward: r(1_500, 50), match: { count: (s) => one(s.game === "threecard" && s.facts.won === true) } },
  { id: "d-3cp-straight", kind: "daily", game: "threecard", text: "Play a straight or better in Three Card Poker", target: 1, reward: r(2_000, 60), match: { count: (s) => one(rank3AtLeast(s, "straight")) } },
  { id: "d-3cp-pair-plus-3", kind: "daily", game: "threecard", text: "Win 3 Pair Plus bets", target: 3, reward: r(1_500, 50), match: { count: (s) => one(s.game === "threecard" && s.facts.pairPlusWon === true) } },

  { id: "d-vp-play-15", kind: "daily", game: "videopoker", text: "Play 15 hands of video poker", target: 15, reward: r(1_000, 40), match: { count: (s) => one(s.game === "videopoker") } },
  { id: "d-vp-two-pair-3", kind: "daily", game: "videopoker", text: "Make two pair or better 3 times in video poker", target: 3, reward: r(1_500, 50), match: { count: (s) => one(vpAtLeast(s, "two_pair")) } },
  { id: "d-vp-full-house", kind: "daily", game: "videopoker", text: "Make a full house or better in video poker", target: 1, reward: r(2_000, 60), match: { count: (s) => one(vpAtLeast(s, "full_house")) } },
  { id: "d-vp-max-5", kind: "daily", game: "videopoker", text: "Play 5 hands of video poker at 5 coins", target: 5, reward: r(1_000, 40), match: { count: (s) => one(s.game === "videopoker" && s.facts.coins === 5) } },

  { id: "d-sl-spins-25", kind: "daily", game: "slots", text: "Spin the slots 25 times", target: 25, reward: r(1_000, 40), match: { count: (s) => one(s.game === "slots") } },
  { id: "d-sl-free", kind: "daily", game: "slots", text: "Trigger free spins", target: 1, reward: r(2_000, 60), match: { count: (s) => one(s.game === "slots" && s.facts.freeSpins === true) } },
  { id: "d-sl-five", kind: "daily", game: "slots", text: "Line up five of a kind on the slots", target: 1, reward: r(1_500, 50), match: { count: (s) => one(s.game === "slots" && s.facts.fiveOfAKind === true) } },
  { id: "d-sl-5x", kind: "daily", game: "slots", text: "Win 5× your bet on one spin", target: 1, reward: r(1_500, 50), match: { count: (s) => one(s.game === "slots" && Number(s.facts.multiple) >= 5) } },
];

// ---------- weekly ----------

export const WEEKLY_QUESTS: readonly QuestDef[] = [
  { id: "w-play-100", kind: "weekly", text: "Play 100 hands", target: 100, reward: r(10_000, 250), match: { count: () => 1 } },
  { id: "w-win-40", kind: "weekly", text: "Win 40 hands", target: 40, reward: r(12_000, 300), match: { count: (s) => one(win(s)) } },
  { id: "w-wager-100k", kind: "weekly", text: "Wager 100,000 chips", target: 100_000, reward: r(15_000, 300), match: { count: (s) => s.wagered } },
  { id: "w-games-3", kind: "weekly", text: "Play 3 different games", target: 3, reward: r(10_000, 250), match: { distinct: (s) => s.game } },
  { id: "w-streak-5", kind: "weekly", text: "Win 5 hands in a row", target: 5, reward: r(15_000, 350), match: { streak: winRun } },
  { id: "w-big-win", kind: "weekly", text: "Win 10,000 chips on one hand", target: 1, reward: r(20_000, 400), match: { count: (s) => one(s.net >= 10_000) } },

  { id: "w-bj-play-75", kind: "weekly", game: "blackjack", text: "Play 75 hands of blackjack", target: 75, reward: r(10_000, 250), match: { count: (s) => one(s.game === "blackjack") } },
  { id: "w-bj-natural-5", kind: "weekly", game: "blackjack", text: "Get 5 blackjacks", target: 5, reward: r(15_000, 300), match: { count: (s) => one(s.facts.blackjack === true) } },
  { id: "w-uth-play-50", kind: "weekly", game: "uth", text: "Play 50 hands of Ultimate Texas Hold'em", target: 50, reward: r(10_000, 250), match: { count: (s) => one(s.game === "uth") } },
  { id: "w-uth-full-house", kind: "weekly", game: "uth", text: "Make a full house or better in UTH", target: 1, reward: r(15_000, 300), match: { count: (s) => one(rankAtLeast(s, "full_house")) } },
  { id: "w-rl-spins-75", kind: "weekly", game: "roulette", text: "Spin the wheel 75 times", target: 75, reward: r(10_000, 250), match: { count: (s) => one(s.game === "roulette") } },
  { id: "w-rl-straight-3", kind: "weekly", game: "roulette", text: "Hit 3 straight-up numbers", target: 3, reward: r(15_000, 300), match: { count: (s) => one(s.facts.straightUp === true) } },
  { id: "w-bac-play-50", kind: "weekly", game: "baccarat", text: "Play 50 hands of baccarat", target: 50, reward: r(10_000, 250), match: { count: (s) => one(s.game === "baccarat") } },
  { id: "w-bac-tie-3", kind: "weekly", game: "baccarat", text: "Win 3 Tie bets", target: 3, reward: r(15_000, 300), match: { count: (s) => one(s.game === "baccarat" && s.facts.tieWon === true) } },
  { id: "w-3cp-play-50", kind: "weekly", game: "threecard", text: "Play 50 hands of Three Card Poker", target: 50, reward: r(10_000, 250), match: { count: (s) => one(s.game === "threecard") } },
  { id: "w-3cp-trips", kind: "weekly", game: "threecard", text: "Play three of a kind or better in Three Card Poker", target: 1, reward: r(15_000, 300), match: { count: (s) => one(rank3AtLeast(s, "trips")) } },
  { id: "w-vp-play-75", kind: "weekly", game: "videopoker", text: "Play 75 hands of video poker", target: 75, reward: r(10_000, 250), match: { count: (s) => one(s.game === "videopoker") } },
  { id: "w-vp-quads", kind: "weekly", game: "videopoker", text: "Make four of a kind or better in video poker", target: 1, reward: r(15_000, 300), match: { count: (s) => one(vpAtLeast(s, "quads")) } },
  { id: "w-sl-spins-150", kind: "weekly", game: "slots", text: "Spin the slots 150 times", target: 150, reward: r(10_000, 250), match: { count: (s) => one(s.game === "slots") } },
  { id: "w-sl-free-3", kind: "weekly", game: "slots", text: "Trigger free spins 3 times", target: 3, reward: r(15_000, 300), match: { count: (s) => one(s.game === "slots" && s.facts.freeSpins === true) } },
];

// ---------- achievements ----------

const tiers = (...t: [number, number, number][]): AchievementTier[] => t.map(([target, chips, xp]) => ({ target, reward: r(chips, xp) }));

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: "a-hands",
    kind: "achievement",
    name: "Regular",
    text: (n) => `Play ${fmt(n)} hands`,
    tiers: tiers([100, 5_000, 200], [1_000, 25_000, 1_000], [10_000, 150_000, 5_000]),
    match: { count: () => 1 },
  },
  {
    id: "a-wins",
    kind: "achievement",
    name: "Winner",
    text: (n) => `Win ${fmt(n)} hands`,
    tiers: tiers([50, 5_000, 200], [500, 25_000, 1_000], [5_000, 150_000, 5_000]),
    match: { count: (s) => one(win(s)) },
  },
  {
    id: "a-wagered",
    kind: "achievement",
    name: "High roller",
    text: (n) => `Wager ${fmt(n)} chips`,
    tiers: tiers([100_000, 5_000, 200], [1_000_000, 25_000, 1_000], [10_000_000, 150_000, 5_000]),
    match: { count: (s) => s.wagered },
  },
  {
    id: "a-big-win",
    kind: "achievement",
    name: "Big score",
    text: (n) => `Win ${fmt(n)} chips on one hand`,
    tiers: tiers([1_000, 2_000, 100], [10_000, 10_000, 500], [100_000, 50_000, 2_000]),
    match: { best: (s) => s.net },
  },
  {
    id: "a-streak",
    kind: "achievement",
    name: "Hot streak",
    text: (n) => `Win ${fmt(n)} hands in a row`,
    tiers: tiers([5, 5_000, 250], [10, 50_000, 2_000]),
    match: { streak: winRun },
  },
  {
    id: "a-games",
    kind: "achievement",
    name: "Tourist",
    text: (n) => `Play ${fmt(n)} different games`,
    tiers: tiers([2, 2_000, 100], [3, 5_000, 250], [7, 25_000, 1_000]),
    match: { distinct: (s) => s.game },
  },
  {
    id: "a-bj-naturals",
    kind: "achievement",
    name: "Natural",
    game: "blackjack",
    text: (n) => `Get ${fmt(n)} blackjacks`,
    tiers: tiers([10, 5_000, 250], [100, 30_000, 1_500], [1_000, 200_000, 6_000]),
    match: { count: (s) => one(s.facts.blackjack === true) },
  },
  {
    id: "a-bj-perfect-pair",
    kind: "achievement",
    name: "Perfect",
    game: "blackjack",
    text: (n) => (n === 1 ? "Hit a perfect pair" : `Hit ${fmt(n)} perfect pairs`),
    tiers: tiers([1, 5_000, 250], [10, 50_000, 2_000]),
    match: { count: (s) => one(s.facts.perfectPair === true) },
  },
  {
    id: "a-uth-quads",
    kind: "achievement",
    name: "Four of a kind",
    game: "uth",
    text: (n) => (n === 1 ? "Make four of a kind or better in UTH" : `Make four of a kind or better ${fmt(n)} times in UTH`),
    tiers: tiers([1, 10_000, 500], [10, 100_000, 4_000]),
    match: { count: (s) => one(rankAtLeast(s, "quads")) },
  },
  {
    id: "a-uth-royal",
    kind: "achievement",
    name: "Royalty",
    game: "uth",
    text: () => "Make a royal flush in UTH",
    tiers: tiers([1, 250_000, 10_000]),
    match: { count: (s) => one(rankAtLeast(s, "royal_flush")) },
  },
  {
    id: "a-rl-straight-ups",
    kind: "achievement",
    name: "Sharpshooter",
    game: "roulette",
    text: (n) => `Hit ${fmt(n)} straight-up numbers`,
    tiers: tiers([5, 5_000, 250], [50, 30_000, 1_500], [500, 200_000, 6_000]),
    match: { count: (s) => one(s.facts.straightUp === true) },
  },
  {
    id: "a-bac-naturals",
    kind: "achievement",
    name: "Le grand",
    game: "baccarat",
    text: (n) => `See ${fmt(n)} naturals at baccarat`,
    tiers: tiers([10, 3_000, 150], [100, 20_000, 1_000], [1_000, 150_000, 5_000]),
    match: { count: (s) => one(s.game === "baccarat" && s.facts.natural === true) },
  },
  {
    id: "a-bac-ties",
    kind: "achievement",
    name: "Dead even",
    game: "baccarat",
    text: (n) => (n === 1 ? "Win a Tie bet" : `Win ${fmt(n)} Tie bets`),
    tiers: tiers([1, 2_000, 100], [25, 30_000, 1_500]),
    match: { count: (s) => one(s.game === "baccarat" && s.facts.tieWon === true) },
  },
  {
    id: "a-3cp-straight-flush",
    kind: "achievement",
    name: "Mini royal",
    game: "threecard",
    text: (n) => (n === 1 ? "Play a straight flush in Three Card Poker" : `Play ${fmt(n)} straight flushes in Three Card Poker`),
    tiers: tiers([1, 10_000, 500], [10, 100_000, 4_000]),
    match: { count: (s) => one(rank3AtLeast(s, "straight_flush")) },
  },
  {
    id: "a-vp-quads",
    kind: "achievement",
    name: "Four on the floor",
    game: "videopoker",
    text: (n) => (n === 1 ? "Make four of a kind or better in video poker" : `Make four of a kind or better ${fmt(n)} times in video poker`),
    tiers: tiers([1, 5_000, 250], [25, 50_000, 2_000]),
    match: { count: (s) => one(vpAtLeast(s, "quads")) },
  },
  {
    id: "a-vp-royal",
    kind: "achievement",
    name: "Royal draw",
    game: "videopoker",
    text: () => "Make a royal flush in video poker",
    tiers: tiers([1, 250_000, 10_000]),
    match: { count: (s) => one(vpAtLeast(s, "royal_flush")) },
  },
  {
    id: "a-sl-free-spins",
    kind: "achievement",
    name: "Free spinner",
    game: "slots",
    text: (n) => `Trigger free spins ${fmt(n)} times`,
    tiers: tiers([5, 5_000, 250], [50, 30_000, 1_500], [500, 200_000, 6_000]),
    match: { count: (s) => one(s.game === "slots" && s.facts.freeSpins === true) },
  },
  {
    id: "a-collector",
    kind: "achievement",
    name: "Collector",
    text: (n) => (n === PAID_ITEMS.length ? "Own every cosmetic" : n === 1 ? "Buy a cosmetic" : `Own ${fmt(n)} cosmetics`),
    tiers: tiers([1, 1_000, 100], [5, 10_000, 500], [PAID_ITEMS.length, 100_000, 5_000]),
    match: { purchases: true },
  },
];

export interface QuestPool {
  daily: readonly QuestDef[];
  weekly: readonly QuestDef[];
  achievements: readonly AchievementDef[];
}

export const QUESTS: QuestPool = { daily: DAILY_QUESTS, weekly: WEEKLY_QUESTS, achievements: ACHIEVEMENTS };

/** How many daily and weekly quests a player gets per period. */
export const PICKS_PER_PERIOD = 3;

// ---------- periods ----------

export const ACHIEVEMENT_PERIOD = "ever";
export const dayPeriod = (day: string) => `d:${day}`;
export const weekPeriod = (week: string) => `w:${week}`;

/** The ISO week ("2026-W42") a calendar day ("YYYY-MM-DD") falls in. */
export function isoWeekOfDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// ---------- picking ----------

/** FNV-1a: a stable 32-bit hash, the same on every server and every run. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32, seeded from the hash. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The quests on offer: those for any game, and those for a game in `games`. */
export function available<T extends { game?: string }>(pool: readonly T[], games: readonly string[]): T[] {
  return pool.filter((q) => q.game === undefined || games.includes(q.game));
}

/**
 * The `n` quests a player has in a period, picked from a hash of (user,
 * period): the same answer every time it is asked, with no storage. Picks
 * are spread across games: at most one per game, and one that any game
 * completes, until the pool runs out of variety.
 *
 * The pool is filtered to the games on offer first, so a new game changes
 * the picks from its first day; a quest dropped mid-period keeps its
 * progress row, unread.
 */
export function pickQuests(pool: readonly QuestDef[], userId: string, period: string, n = PICKS_PER_PERIOD): QuestDef[] {
  const rand = prng(hash(`${userId}|${period}`));
  const order = [...pool];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const picked: QuestDef[] = [];
  const groups = new Set<string>();
  for (const q of order) {
    if (picked.length === n) break;
    const g = q.game ?? "*";
    if (groups.has(g)) continue;
    groups.add(g);
    picked.push(q);
  }
  for (const q of order) {
    if (picked.length === n) break;
    if (!picked.includes(q)) picked.push(q);
  }
  return picked;
}

/** One quest the player has now, and the period its progress is kept under. */
export interface ActiveQuest {
  def: AnyQuest;
  period: string;
}

/**
 * Everything a player has on the go for `day` (their calendar day): today's
 * and this week's picks, and every achievement.
 */
export function activeQuests(pool: QuestPool, games: readonly string[], userId: string, day: string): ActiveQuest[] {
  const d = dayPeriod(day);
  const w = weekPeriod(isoWeekOfDay(day));
  return [
    ...pickQuests(available(pool.daily, games), userId, d).map((def) => ({ def, period: d })),
    ...pickQuests(available(pool.weekly, games), userId, w).map((def) => ({ def, period: w })),
    ...available(pool.achievements, games).map((def) => ({ def, period: ACHIEVEMENT_PERIOD })),
  ];
}

// ---------- progress ----------

export const targets = (q: AnyQuest): number[] => (q.kind === "achievement" ? q.tiers.map((t) => t.target) : [q.target]);
export const finalTarget = (q: AnyQuest) => targets(q).at(-1)!;
/** Tiers (1 for a quest) whose target the progress has reached. */
export const tiersDone = (q: AnyQuest, progress: number) => targets(q).filter((t) => progress >= t).length;
/** The reward the next claim pays, or null when nothing is waiting to be claimed. */
export function claimable(q: AnyQuest, row: Pick<QuestProgressRecord, "progress" | "claimed"> | null): Reward | null {
  const done = tiersDone(q, row?.progress ?? 0);
  const claimed = row?.claimed ?? 0;
  if (claimed >= done) return null;
  return q.kind === "achievement" ? q.tiers[claimed].reward : q.reward;
}

export function emptyProgress(userId: string, questId: string, period: string, now: string): QuestProgressRecord {
  return { userId, questId, period, progress: 0, run: 0, marks: [], claimed: 0, updatedAt: now, claimedAt: null };
}

/** A goal one fold completed (a quest, or one tier of an achievement), for the SPA's toast. */
export interface Completion {
  questId: string;
  kind: AnyQuest["kind"];
  text: string;
  tier: number | null;
}

/**
 * Folds one event into the player's active quests. Pure: takes the rows the
 * transaction read (missing rows count as no progress) and returns only the
 * rows that changed, plus what this event completed. A finished quest or
 * achievement is left alone.
 */
export function foldQuests(
  active: readonly ActiveQuest[],
  rows: readonly QuestProgressRecord[],
  event: QuestEvent,
  userId: string,
  now: string,
): { rows: QuestProgressRecord[]; completed: Completion[] } {
  const byKey = new Map(rows.map((row) => [`${row.questId}|${row.period}`, row]));
  const changed: QuestProgressRecord[] = [];
  const completed: Completion[] = [];

  for (const { def, period } of active) {
    const before = byKey.get(`${def.id}|${period}`) ?? emptyProgress(userId, def.id, period, now);
    if (before.progress >= finalTarget(def)) continue;
    const after = step(def.match, before, event);
    if (!after) continue;
    changed.push({ ...after, updatedAt: now });
    const was = tiersDone(def, before.progress);
    const is = tiersDone(def, after.progress);
    for (let t = was; t < is; t++) {
      completed.push({
        questId: def.id,
        kind: def.kind,
        text: def.kind === "achievement" ? def.text(def.tiers[t].target) : def.text,
        tier: def.kind === "achievement" ? t + 1 : null,
      });
    }
  }
  return { rows: changed, completed };
}

/** One event applied to one row, or null when it changes nothing. */
function step(match: Match, row: QuestProgressRecord, event: QuestEvent): QuestProgressRecord | null {
  if ("purchases" in match) {
    return "purchase" in event ? { ...row, progress: row.progress + 1 } : null;
  }
  if (!("hand" in event)) return null;
  const s = event.hand;
  if ("count" in match) {
    const add = match.count(s);
    return add > 0 ? { ...row, progress: row.progress + add } : null;
  }
  if ("best" in match) {
    const v = match.best(s);
    return v > row.progress ? { ...row, progress: v } : null;
  }
  if ("streak" in match) {
    const hit = match.streak(s);
    if (hit === null) return null;
    if (!hit) return row.run === 0 ? null : { ...row, run: 0 };
    const run = row.run + 1;
    return { ...row, run, progress: Math.max(row.progress, run) };
  }
  const key = match.distinct(s);
  if (key === null || row.marks.includes(key)) return null;
  const marks = [...row.marks, key];
  return { ...row, marks, progress: marks.length };
}

// ---------- claiming ----------

export interface ClaimRead {
  player: PlayerRecord;
  row: QuestProgressRecord | null;
}

export interface ClaimOutcome {
  player: PlayerRecord;
  entry: LedgerEntry;
  row: QuestProgressRecord;
  reward: Reward;
}

/**
 * Pays the next reward waiting on a quest (or achievement tier) in one
 * transaction: the chips with their ledger row, the XP, and the claim on the
 * progress row. Achievement tiers are claimed in order. 409 NOT_COMPLETE
 * before the goal is met, ALREADY_CLAIMED once everything has been paid.
 */
export function planClaim(read: ClaimRead, plan: { quest: AnyQuest; period: string; now: string }): ClaimOutcome {
  const { quest, period, now } = plan;
  const row = read.row ?? emptyProgress(read.player.userId, quest.id, period, now);
  const reward = claimable(quest, row);
  // Every tier paid is ALREADY_CLAIMED; the next one not reached yet is NOT_COMPLETE.
  if (!reward) throw conflict(row.claimed >= targets(quest).length ? "ALREADY_CLAIMED" : "NOT_COMPLETE");
  const tier = row.claimed + 1;
  const credit = applyCreditTo(
    read.player,
    {
      kind: quest.kind === "achievement" ? "achievement_reward" : "quest_reward",
      amount: reward.chips,
      ref: quest.kind === "achievement" ? `${quest.id}:${tier}` : `${quest.id}:${period}`,
    },
    now,
  )!;
  return {
    player: { ...credit.player, xp: credit.player.xp + reward.xp },
    entry: credit.entry,
    row: { ...row, claimed: tier, claimedAt: now, updatedAt: now },
    reward,
  };
}
