import { z } from "zod";
import type { BetResult } from "../games/engine.js";
import { COSMETIC_KINDS, type Equipped, type ShopItem } from "./catalog.js";

/**
 * Highroller's records, wire rows and request schemas.
 *
 * Records (camelCase) are what the repo port reads and writes; both repos map
 * them to and from their own storage. Wire rows (snake_case, like every app in
 * the stack) are what the routes send, built from records in this module and
 * hands.ts. apps/highroller/web/src/api.ts imports the wire types type-only.
 *
 * Chips are whole numbers everywhere. Days are "YYYY-MM-DD" in the player's
 * time zone; timestamps are ISO 8601.
 */

// ---------- records ----------

export interface PlayerRecord {
  userId: string;
  displayName: string;
  email: string;
  balance: number;
  xp: number;
  /** Consecutive days the daily bonus was claimed, ending on `lastDailyOn`. */
  dailyStreak: number;
  lastDailyOn: string | null;
  lastBailoutOn: string | null;
  /** The last ledger entry's `seq`. Every balance change bumps it. */
  ledgerSeq: number;
  /** Item ids by kind; the defaults until something else is equipped. */
  equipped: Equipped;
  /** Shown on the leaderboards and by name in the feed. Off hides both. */
  leaderboardListed: boolean;
  /** Chips gifted on `giftsSentOn`, the sender's calendar day. */
  giftsSentToday: number;
  giftsSentOn: string | null;
  /** Chips received on `giftsReceivedOn`, a UTC day. */
  giftsReceivedToday: number;
  giftsReceivedOn: string | null;
  createdAt: string;
}

export const LEDGER_KINDS = [
  "initial_grant",
  "bet",
  "payout",
  "daily_bonus",
  "bailout",
  "purchase",
  "gift_in",
  "gift_out",
  "quest_reward",
  "achievement_reward",
  "jackpot",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/**
 * One balance change. `seq` counts up per player from 1 and orders the ledger
 * exactly, even for entries written in the same transaction (a bet and its
 * payout on a roulette spin).
 */
export interface LedgerEntry {
  userId: string;
  seq: number;
  kind: LedgerKind;
  /** Signed: a bet is negative. */
  amount: number;
  balanceAfter: number;
  handId: string | null;
  ref: string | null;
  createdAt: string;
}

export type HandStatus = "active" | "settled";

export interface HandRecord {
  id: string;
  userId: string;
  game: string;
  variant: string | null;
  status: HandStatus;
  /** 0 when dealt, +1 per action. A client acting on an older version gets 409 STALE_HAND. */
  version: number;
  /** The engine's full state, private parts included. Never sent. */
  state: unknown;
  /** engine.view(state), stored so lists need no engine. */
  view: unknown;
  wagered: number;
  returned: number;
  results: BetResult[] | null;
  createdAt: string;
  settledAt: string | null;
}

export interface GameStatsRecord {
  userId: string;
  game: string;
  hands: number;
  wagered: number;
  returned: number;
  wins: number;
  losses: number;
  pushes: number;
  /** Largest net win on one hand (returned − wagered), 0 until one is won. */
  biggestWin: number;
  /** Σ theoretical RTP × wagered: what "average luck" would have returned. */
  expectedReturn: number;
}

export interface WeeklyStatsRecord {
  /** ISO week in UTC, e.g. "2026-W42". */
  week: string;
  userId: string;
  hands: number;
  wagered: number;
  net: number;
  biggestWin: number;
  /** The player's `leaderboardListed`, copied on every write so boards can filter on it. */
  listed: boolean;
}

/**
 * One quest's or achievement's progress in one period (`d:2026-10-15`,
 * `w:2026-W42` or `ever`). There is no row until there is progress.
 */
export interface QuestProgressRecord {
  userId: string;
  questId: string;
  period: string;
  /** Never falls, so a completed tier stays completed. */
  progress: number;
  /** The current run, for streak quests; progress is the longest. */
  run: number;
  /** The keys seen, for distinct quests ("play 3 different games"). */
  marks: string[];
  /** Rewards claimed: 0 or 1 for a quest, tiers claimed for an achievement. */
  claimed: number;
  updatedAt: string;
  claimedAt: string | null;
}

/** One gift between two players. `id` is the client's, so a retry lands once. */
export interface GiftRecord {
  id: string;
  fromUserId: string;
  /** Public names (social.ts `publicName`) at the time of the gift. */
  fromName: string;
  toUserId: string;
  toName: string;
  amount: number;
  message: string | null;
  createdAt: string;
}

export const FEED_KINDS = ["big_win", "jackpot"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

/** A big win or a jackpot hit, written by settlement, kept 7 days. At most one per (hand, kind). */
export interface FeedEventRecord {
  handId: string;
  kind: FeedKind;
  userId: string;
  /** The public name when it was won; the feed shows "A player" for hidden players instead. */
  displayName: string;
  game: string;
  variant: string | null;
  wagered: number;
  /** Chips returned by the hand, stakes included. */
  amount: number;
  /** amount ÷ wagered, two decimals. */
  multiplier: number;
  /** "Straight up 17", "Royal flush"; the game's name when nothing more specific fits. */
  handLabel: string;
  createdAt: string;
  expiresAt: string;
}

/** One jackpot win (#57), kept for `GET /jackpot`'s last hit. At most one per hand. */
export interface JackpotHitRecord {
  handId: string;
  userId: string;
  /** The public name when it was won; shown as "A player" for hidden players, decided on read. */
  displayName: string;
  game: string;
  variant: string | null;
  /** Whole chips paid. */
  amount: number;
  handLabel: string;
  createdAt: string;
}

/** One place on a leaderboard, as the repo reads it. */
export interface BoardEntry {
  userId: string;
  displayName: string;
  email: string;
  xp: number;
  /** The board's figure: net, biggest win or XP. */
  value: number;
}

// ---------- wire ----------

export interface PlayerRow {
  user_id: string;
  display_name: string;
  balance: number;
  xp: number;
  level: number;
  /** XP earned inside the current level, and needed to reach the next. */
  level_xp: number;
  level_xp_needed: number;
  daily: {
    available: boolean;
    /** The streak as it stands: 0 once a day has been missed. */
    streak: number;
    /** What claiming now pays (or would have paid, when already claimed). */
    amount: number;
  };
  bailout: {
    available: boolean;
    claimed_today: boolean;
    floor: number;
    top_up_to: number;
  };
  equipped: Equipped;
  leaderboard_listed: boolean;
  gifting: {
    /** Sent today, in the time zone of the request. */
    sent_today: number;
    send_limit: number;
    receive_limit: number;
    min: number;
    /** You can't gift yourself below this. */
    floor: number;
  };
  created_at: string;
}

export interface LedgerRow {
  seq: number;
  kind: LedgerKind;
  amount: number;
  balance_after: number;
  hand_id: string | null;
  ref: string | null;
  created_at: string;
}

export interface LedgerPage {
  entries: LedgerRow[];
  /** Pass back as `cursor` for the next (older) page; null at the end. */
  next_cursor: string | null;
}

export interface ClaimResponse {
  amount: number;
  player: PlayerRow;
}

export interface HandRow {
  id: string;
  game: string;
  variant: string | null;
  status: HandStatus;
  version: number;
  wagered: number;
  returned: number;
  /** The engine's public view; each game's scene knows its shape. */
  view: unknown;
  legal_actions: string[];
  results: BetResult[] | null;
  created_at: string;
  settled_at: string | null;
}

/** The level badge: the level, and XP into it out of what the next one needs. */
export interface LevelRow {
  level: number;
  level_xp: number;
  level_xp_needed: number;
}

/** A goal just completed: a quest, or one tier of an achievement. */
export interface CompletionRow {
  quest_id: string;
  kind: "daily" | "weekly" | "achievement";
  text: string;
  tier: number | null;
}

/** POST /hands and POST /hands/:id/actions: the hand, and the balance after it. */
export interface HandResponse extends LevelRow {
  hand: HandRow;
  balance: number;
  xp: number;
  /** What settling this hand completed; empty until it settles. */
  completed: CompletionRow[];
  /** The progressive jackpot this hand won, paid on top of `hand.returned` and already in `balance`. */
  jackpot: { amount: number } | null;
}

export interface HandPage {
  hands: HandRow[];
  next_cursor: string | null;
}

// ---------- stats ----------

export interface GameStatsRow {
  /** A game id, or "all" for the totals. */
  game: string;
  hands: number;
  wagered: number;
  returned: number;
  /** returned − wagered. */
  net: number;
  wins: number;
  losses: number;
  pushes: number;
  biggest_win: number;
  /** What average luck would have returned, rounded to whole chips. */
  expected_return: number;
}

export interface StatsResponse {
  total: GameStatsRow;
  /** Games played, most hands first. */
  games: GameStatsRow[];
}

export interface BalancePoint {
  /** The player's calendar day. */
  day: string;
  /** The balance at the end of that day (today: now). */
  balance: number;
}

export interface BalanceSeries {
  range: BalanceRange;
  /** Oldest first, one per day from the first day in range the player existed. */
  points: BalancePoint[];
}

export const BALANCE_RANGES = ["7d", "30d", "90d"] as const;
export type BalanceRange = (typeof BALANCE_RANGES)[number];

// ---------- shop ----------

export type ShopItemRow = ShopItem & { owned: boolean; equipped: boolean; is_default: boolean };

export interface ShopResponse {
  items: ShopItemRow[];
  equipped: Equipped;
}

export interface BuyResponse {
  item: ShopItemRow;
  balance: number;
  completed: CompletionRow[];
}

export interface EquipResponse {
  equipped: Equipped;
}

// ---------- quests ----------

export interface RewardRow {
  chips: number;
  xp: number;
}

export interface QuestRow {
  id: string;
  kind: "daily" | "weekly";
  game: string | null;
  text: string;
  target: number;
  /** Capped at the target. */
  progress: number;
  reward: RewardRow;
  complete: boolean;
  claimed: boolean;
}

export interface AchievementTierRow {
  target: number;
  text: string;
  reward: RewardRow;
  complete: boolean;
  claimed: boolean;
}

export interface AchievementRow {
  id: string;
  name: string;
  game: string | null;
  progress: number;
  tiers: AchievementTierRow[];
  /** True when a completed tier is waiting to be claimed. */
  claimable: boolean;
}

export interface QuestsResponse {
  daily: { period: string; resets_at: string; quests: QuestRow[] };
  weekly: { period: string; resets_at: string; quests: QuestRow[] };
  achievements: AchievementRow[];
  /** Rewards waiting to be claimed, for the tab's badge. */
  claimable: number;
}

export interface QuestClaimResponse extends LevelRow {
  quest_id: string;
  reward: RewardRow;
  balance: number;
  xp: number;
}

// ---------- social ----------

export const BOARDS = ["net", "biggest_win", "level"] as const;
export type Board = (typeof BOARDS)[number];

export interface BoardRow {
  /** Players with the same figure share a rank: 1 + the listed players above. */
  rank: number;
  user_id: string;
  display_name: string;
  value: number;
  level: number;
}

export interface LeaderboardResponse {
  board: Board;
  /** The ISO week (UTC) of a weekly board; null for the level board. */
  week: string | null;
  previous_week: string | null;
  /** The top of the board, listed players only. */
  rows: BoardRow[];
  /** Your own place, even when hidden or below the top; null before you have played that week. */
  me: (BoardRow & { listed: boolean }) | null;
}

export interface GiftRow {
  id: string;
  from_name: string;
  to_name: string;
  amount: number;
  message: string | null;
  created_at: string;
}

export interface GiftResponse {
  gift: GiftRow;
  balance: number;
  sent_today: number;
}

export interface GiftsReceived {
  /** Newest first. */
  gifts: GiftRow[];
}

export interface FeedEventRow {
  /** `${hand_id}:${kind}`. */
  id: string;
  kind: FeedKind;
  /** "A player" when they are hidden from the leaderboards. */
  display_name: string;
  game: string;
  game_name: string;
  variant: string | null;
  wagered: number;
  amount: number;
  multiplier: number;
  hand_label: string;
  created_at: string;
}

export interface FeedResponse {
  /** Newest first. */
  events: FeedEventRow[];
}

export interface JackpotHitRow {
  /** "A player" when they are hidden from the leaderboards. */
  display_name: string;
  game: string;
  game_name: string;
  amount: number;
  hand_label: string;
  created_at: string;
}

/** `GET /jackpot`. */
export interface JackpotResponse {
  /** Whole chips a hit would pay now. */
  amount: number;
  /** Where the jackpot starts again after a hit. */
  seed: number;
  /** The share of each qualifying wager it is fed, 0.02. */
  rate: number;
  last_hit: JackpotHitRow | null;
}

export interface SocialSettings {
  leaderboard_listed: boolean;
}

export function toGiftRow(g: GiftRecord): GiftRow {
  return {
    id: g.id,
    from_name: g.fromName,
    to_name: g.toName,
    amount: g.amount,
    message: g.message,
    created_at: g.createdAt,
  };
}

export function toLedgerRow(e: LedgerEntry): LedgerRow {
  return {
    seq: e.seq,
    kind: e.kind,
    amount: e.amount,
    balance_after: e.balanceAfter,
    hand_id: e.handId,
    ref: e.ref,
    created_at: e.createdAt,
  };
}

// ---------- requests ----------

/** An IANA zone the runtime knows, e.g. "America/New_York". */
export const timeZone = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, { message: "unknown time zone" });

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const meQuery = z.object({ timeZone: timeZone.optional() });
export const claimInput = z.object({ timeZone });

const limit = z.coerce.number().int().min(1).max(100).default(50);

export const ledgerQuery = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,15}$/)
    .optional(),
  limit,
});

export const startHandInput = z.object({
  /** Made by the client, so a retried start is recognised and never debits twice. */
  id: z.string().uuid(),
  game: z.string().min(1).max(40),
  variant: z.string().min(1).max(40).optional(),
  /** Validated by the game's own schema in the registry. */
  bets: z.unknown(),
  timeZone,
});
export type StartHandInput = z.infer<typeof startHandInput>;

export const actionInput = z.object({
  /** Validated by the game's own schema in the registry. */
  action: z.unknown(),
  version: z.number().int().min(0),
  /** For the day a settling hand's quests count toward; UTC when absent. */
  timeZone: timeZone.optional(),
});

export const handsQuery = z.object({
  game: z.string().min(1).max(40).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const handIdParam = z.object({ id: z.string().uuid() });

export const statsBalanceQuery = z.object({
  range: z.enum(BALANCE_RANGES).default("30d"),
  timeZone: timeZone.default("UTC"),
});

export const itemIdParam = z.object({ itemId: z.string().uuid() });

export const equipInput = z.object({
  kind: z.enum(COSMETIC_KINDS),
  itemId: z.string().uuid(),
});

export const questsQuery = z.object({ timeZone: timeZone.default("UTC") });
export const questIdParam = z.object({ id: z.string().min(1).max(60) });
export const questClaimInput = z.object({ timeZone });

const isoWeekString = z.string().regex(/^\d{4}-W\d{2}$/, "an ISO week like 2026-W42");

export const boardParam = z.object({ board: z.enum(BOARDS) });
export const boardQuery = z.object({ week: isoWeekString.optional() });

export const giftInput = z.object({
  /** Made by the client, so a retried gift lands once. */
  id: z.string().uuid(),
  to: z.union([
    z.object({ email: z.string().trim().email().max(320) }).strict(),
    z.object({ userId: z.string().min(1).max(128) }).strict(),
  ]),
  amount: z.number().int().min(100).max(1_000_000),
  /** Plain text; the SPA never renders it as HTML. */
  message: z.string().trim().max(140).optional(),
  /** The sender's day, for the send cap. */
  timeZone,
});
export type GiftInput = z.infer<typeof giftInput>;

export const giftsReceivedQuery = z.object({
  since: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), { message: "an ISO timestamp" })
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const feedQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

export const socialSettingsInput = z.object({ leaderboardListed: z.boolean() }).strict();
