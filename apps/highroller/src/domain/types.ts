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
