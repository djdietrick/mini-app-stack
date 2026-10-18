import { conflict } from "@stack/service-kit";
import { DEFAULT_EQUIPPED } from "./catalog.js";
import type { GiftRecord, LedgerEntry, LedgerKind, PlayerRecord } from "./types.js";

/**
 * The chip economy's rules, pure. Tunable here and nowhere else.
 *
 * "Today" is a calendar day in the player's time zone, which the SPA sends
 * with each claim (as crumb does with dates). A player who changes time zone
 * can gain or lose a few hours on one claim; that is fine for fun chips.
 */
export const STARTING_BALANCE = 10_000;
export const DAILY_BONUS_BASE = 1_000;
/** The bonus grows with the streak up to this day, then stays there. */
export const DAILY_STREAK_CAP = 7;
/** A bailout is available below this balance… */
export const BAILOUT_FLOOR = 500;
/** …and tops the balance up to this. */
export const BAILOUT_TOP_UP = 2_000;
/** Gifting: per day, sent (the sender's day) and received (the UTC day). */
export const GIFT_SEND_LIMIT = 5_000;
export const GIFT_RECEIVE_LIMIT = 10_000;
export const GIFT_MIN = 100;

/** "YYYY-MM-DD" for `now` in `timeZone`. */
export function dayIn(now: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The calendar day before `day` ("YYYY-MM-DD"). Zone-free: it is date arithmetic. */
export function previousDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const bonusFor = (streakDay: number) => DAILY_BONUS_BASE * Math.min(Math.max(streakDay, 1), DAILY_STREAK_CAP);

export type Eligibility =
  | { ok: true; amount: number; patch: Partial<PlayerRecord> }
  | { ok: false; code: "ALREADY_CLAIMED" | "NOT_ELIGIBLE" };

/** The streak as it stands on `today`: 0 once a day has been missed. */
export function currentStreak(p: PlayerRecord, today: string): number {
  if (p.lastDailyOn === today || p.lastDailyOn === previousDay(today)) return p.dailyStreak;
  return 0;
}

/**
 * Once per day. Claiming on consecutive days grows the streak; missing a day
 * starts it again from 1.
 */
export function dailyBonus(p: PlayerRecord, today: string): Eligibility {
  if (p.lastDailyOn === today) return { ok: false, code: "ALREADY_CLAIMED" };
  const streak = p.lastDailyOn === previousDay(today) ? p.dailyStreak + 1 : 1;
  return { ok: true, amount: bonusFor(streak), patch: { dailyStreak: streak, lastDailyOn: today } };
}

/** Once per day, only while the balance is under the floor. */
export function bailout(p: PlayerRecord, today: string): Eligibility {
  if (p.lastBailoutOn === today) return { ok: false, code: "ALREADY_CLAIMED" };
  if (p.balance >= BAILOUT_FLOOR) return { ok: false, code: "NOT_ELIGIBLE" };
  return { ok: true, amount: BAILOUT_TOP_UP - p.balance, patch: { lastBailoutOn: today } };
}

/** A change to one player's balance: its ledger kind, signed amount, and any other player fields it sets. */
export interface Credit {
  kind: LedgerKind;
  amount: number;
  handId?: string | null;
  ref?: string | null;
  patch?: Partial<Pick<PlayerRecord, "dailyStreak" | "lastDailyOn" | "lastBailoutOn">>;
}

/**
 * The player and ledger entry after `credit`, or null when it would take the
 * balance below zero. Both repos apply this inside their transaction, so the
 * balance and its ledger row always change together.
 */
export function applyCreditTo(
  p: PlayerRecord,
  credit: Credit,
  now: string,
): { player: PlayerRecord; entry: LedgerEntry } | null {
  if (!Number.isInteger(credit.amount)) throw new Error(`chips are whole numbers, got ${credit.amount}`);
  const balance = p.balance + credit.amount;
  if (balance < 0) return null;
  const seq = p.ledgerSeq + 1;
  return {
    player: { ...p, ...credit.patch, balance, ledgerSeq: seq },
    entry: {
      userId: p.userId,
      seq,
      kind: credit.kind,
      amount: credit.amount,
      balanceAfter: balance,
      handId: credit.handId ?? null,
      ref: credit.ref ?? null,
      createdAt: now,
    },
  };
}

/** A brand-new player and their opening ledger entry. */
export function newPlayer(
  user: { userId: string; email: string; displayName: string | null },
  now: string,
): { player: PlayerRecord; entry: LedgerEntry } {
  const blank: PlayerRecord = {
    userId: user.userId,
    displayName: displayNameOf(user),
    email: user.email,
    balance: 0,
    xp: 0,
    dailyStreak: 0,
    lastDailyOn: null,
    lastBailoutOn: null,
    ledgerSeq: 0,
    equipped: { ...DEFAULT_EQUIPPED },
    leaderboardListed: true,
    giftsSentToday: 0,
    giftsSentOn: null,
    giftsReceivedToday: 0,
    giftsReceivedOn: null,
    createdAt: now,
  };
  return applyCreditTo(blank, { kind: "initial_grant", amount: STARTING_BALANCE }, now)!;
}

/** The session's display name, or the part of the email before the @. */
export function displayNameOf(user: { email: string; displayName: string | null }): string {
  const name = user.displayName?.trim();
  return (name || user.email.split("@")[0] || "Player").slice(0, 80);
}

// ---------- gifting ----------

/** Chips the player has gifted on `today` (their day). */
export const sentOn = (p: PlayerRecord, today: string) => (p.giftsSentOn === today ? p.giftsSentToday : 0);
/** Chips the player has received on `utcDay`. */
export const receivedOn = (p: PlayerRecord, utcDay: string) => (p.giftsReceivedOn === utcDay ? p.giftsReceivedToday : 0);

/** What one gift transaction reads: both players, and a gift already stored under this id. */
export interface GiftRead {
  from: PlayerRecord;
  /** Null when the recipient has no player row. */
  to: PlayerRecord | null;
  existing: GiftRecord | null;
}

export interface GiftPlan {
  id: string;
  amount: number;
  message: string | null;
  /** The sender's calendar day and the UTC day, for the two caps. */
  senderDay: string;
  utcDay: string;
  /** Public names, for the gift record. */
  fromName: string;
  toName: string;
  now: string;
}

export interface GiftOutcome {
  /** Null when the gift was already made (a retry): nothing to write. */
  writes: { from: PlayerRecord; to: PlayerRecord; ledger: LedgerEntry[]; gift: GiftRecord } | null;
  gift: GiftRecord;
  from: PlayerRecord;
}

/**
 * One gift, pure: the debit, the credit, both ledger rows (each naming the
 * other player in `ref`) and both day counters, or an AppError. Both repos run
 * it inside one transaction on what they read, so a Firestore retry
 * recomputes the same writes.
 *
 * The sender can't go below the bailout floor, so a second account can't
 * farm bailouts by passing chips back.
 */
export function planGift(read: GiftRead, plan: GiftPlan): GiftOutcome {
  const { from, to, existing } = read;
  if (existing) {
    if (existing.fromUserId !== from.userId) throw conflict("GIFT_ID_TAKEN");
    return { writes: null, gift: existing, from };
  }
  if (!to) throw new Error("planGift without a recipient");
  if (to.userId === from.userId) throw conflict("SELF_GIFT");
  if (sentOn(from, plan.senderDay) + plan.amount > GIFT_SEND_LIMIT) throw conflict("OVER_SEND_CAP");
  if (receivedOn(to, plan.utcDay) + plan.amount > GIFT_RECEIVE_LIMIT) throw conflict("OVER_RECEIVE_CAP");
  if (from.balance - plan.amount < BAILOUT_FLOOR) throw conflict("BELOW_FLOOR");

  const out = applyCreditTo(
    { ...from, giftsSentToday: sentOn(from, plan.senderDay) + plan.amount, giftsSentOn: plan.senderDay },
    { kind: "gift_out", amount: -plan.amount, ref: to.userId },
    plan.now,
  )!;
  const into = applyCreditTo(
    { ...to, giftsReceivedToday: receivedOn(to, plan.utcDay) + plan.amount, giftsReceivedOn: plan.utcDay },
    { kind: "gift_in", amount: plan.amount, ref: from.userId },
    plan.now,
  )!;
  const gift: GiftRecord = {
    id: plan.id,
    fromUserId: from.userId,
    fromName: plan.fromName,
    toUserId: to.userId,
    toName: plan.toName,
    amount: plan.amount,
    message: plan.message,
    createdAt: plan.now,
  };
  return { writes: { from: out.player, to: into.player, ledger: [out.entry, into.entry], gift }, gift, from: out.player };
}
