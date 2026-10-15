import type { LedgerEntry, LedgerKind, PlayerRecord } from "./types.js";

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
    createdAt: now,
  };
  return applyCreditTo(blank, { kind: "initial_grant", amount: STARTING_BALANCE }, now)!;
}

/** The session's display name, or the part of the email before the @. */
export function displayNameOf(user: { email: string; displayName: string | null }): string {
  const name = user.displayName?.trim();
  return (name || user.email.split("@")[0] || "Player").slice(0, 80);
}
