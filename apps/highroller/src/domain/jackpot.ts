import type { Facts } from "../games/engine.js";
import { applyCreditTo } from "./economy.js";
import type { HandTxOutcome } from "./hands.js";
import { FEED_RETENTION_DAYS, HIDDEN_NAME, publicName } from "./social.js";
import type { FeedEventRecord, JackpotHitRecord, JackpotHitRow, JackpotResponse } from "./types.js";

/**
 * The shared progressive jackpot (#57), pure.
 *
 * Every slot spin and every Perfect Pairs, 21+3 and Trips wager adds 2% of
 * its stake (the engine's `jackpotStake`). The house funds it, so payouts are
 * unchanged. A hand whose summary sets `jackpotEligible` wins the whole pot on
 * top of its paytable win, and the pot goes back to its seed.
 *
 * The pot is kept in hundredths of a chip, so 2% of a whole-chip stake adds
 * exactly and many small side bets lose nothing to rounding. A hit pays whole
 * chips, rounding down; the fraction goes with the reset.
 *
 * Settlement only says what the hand adds and whether it hits (`jackpotOf`).
 * The pot itself is read only on a hit, after the hand's step, by
 * `payJackpot`: that keeps the hot row out of every other transaction's read
 * set (on Firestore, ten shards that contributions only ever increment).
 */
export const JACKPOT_SEED = 250_000;
/** Percent of each qualifying chip, which is also its contribution in hundredths. */
export const JACKPOT_RATE_PERCENT = 2;
/** The seed in the pot's unit, hundredths of a chip. */
export const JACKPOT_SEED_HUNDREDTHS = JACKPOT_SEED * 100;
/** `GET /jackpot` is cached this long in process. */
export const JACKPOT_CACHE_MS = 5_000;

/** What a settled hand does to the pot. */
export interface JackpotWrite {
  /** Added to the pot, in hundredths of a chip. */
  contribution: number;
  /** The hand wins the pot (its own contribution included). */
  hit: boolean;
  /** What the feed calls the winning hand. */
  label: string;
}

/** The pot's write for a settled hand, or null when the hand neither feeds nor wins it. */
export function jackpotOf(stake: number, facts: Facts, label: string): JackpotWrite | null {
  if (!Number.isInteger(stake) || stake < 0) throw new Error(`bad jackpot stake ${stake}`);
  const hit = facts.jackpotEligible === true;
  if (stake === 0 && !hit) return null;
  return { contribution: stake * JACKPOT_RATE_PERCENT, hit, label };
}

/** Whole chips a pot of `hundredths` pays. */
export const potChips = (hundredths: number) => Math.floor(hundredths / 100);

/**
 * Pays a hit: the pot as the transaction read it (`pot`, hundredths, before
 * this hand's contribution), plus that contribution. Credits the player with
 * a `jackpot` ledger row after the hand's own, and adds the hit's record and
 * its feed event. The repo then resets the pot to the seed.
 *
 * Pure, like the step it follows, so a retried transaction pays the same.
 */
export function payJackpot(outcome: HandTxOutcome, pot: number, now: string): HandTxOutcome {
  const w = outcome.writes;
  const jp = w?.jackpot;
  if (!w || !jp?.hit) return outcome;
  if (!Number.isInteger(pot) || pot < JACKPOT_SEED_HUNDREDTHS) throw new Error(`bad jackpot pot ${pot}`);
  const amount = potChips(pot + jp.contribution);
  const hand = w.hand;
  const paid = applyCreditTo(w.player, { kind: "jackpot", amount, handId: hand.id, ref: hand.game }, now)!;
  const displayName = publicName(paid.player);
  const hit: JackpotHitRecord = {
    handId: hand.id,
    userId: hand.userId,
    displayName,
    game: hand.game,
    variant: hand.variant,
    amount,
    handLabel: jp.label,
    createdAt: now,
  };
  const event: FeedEventRecord = {
    handId: hand.id,
    kind: "jackpot",
    userId: hand.userId,
    displayName,
    game: hand.game,
    variant: hand.variant,
    wagered: hand.wagered,
    amount,
    multiplier: hand.wagered > 0 ? Math.floor((amount / hand.wagered) * 100) / 100 : 0,
    handLabel: jp.label,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + FEED_RETENTION_DAYS * 86_400_000).toISOString(),
  };
  return {
    ...outcome,
    writes: { ...w, player: paid.player, ledger: [...w.ledger, paid.entry], feed: [...w.feed, event], jackpotHit: hit },
    player: paid.player,
    jackpot: amount,
  };
}

/** The wire form of `GET /jackpot`. */
export function toJackpotResponse(
  pot: number,
  lastHit: (JackpotHitRecord & { listed: boolean }) | null,
  gameName: (game: string) => string,
): JackpotResponse {
  return {
    amount: potChips(pot),
    seed: JACKPOT_SEED,
    rate: JACKPOT_RATE_PERCENT / 100,
    last_hit: lastHit && toJackpotHitRow(lastHit, gameName(lastHit.game)),
  };
}

function toJackpotHitRow(h: JackpotHitRecord & { listed: boolean }, gameName: string): JackpotHitRow {
  return {
    display_name: h.listed ? h.displayName : HIDDEN_NAME,
    game: h.game,
    game_name: gameName,
    amount: h.amount,
    hand_label: h.handLabel,
    created_at: h.createdAt,
  };
}
