import { z } from "zod";
import type { BetResult } from "../games/engine.js";

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

/** POST /hands and POST /hands/:id/actions: the hand, and the balance after it. */
export interface HandResponse {
  hand: HandRow;
  balance: number;
  xp: number;
}

export interface HandPage {
  hands: HandRow[];
  next_cursor: string | null;
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
});

export const handsQuery = z.object({
  game: z.string().min(1).max(40).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const handIdParam = z.object({ id: z.string().uuid() });
