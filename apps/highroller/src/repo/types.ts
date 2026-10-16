import type { Closable, SessionUser } from "@stack/service-kit";
import type { Equipped } from "../domain/catalog.js";
import type { Credit } from "../domain/economy.js";
import type { HandTxKey, HandTxOutcome, HandTxRead, QuestKey } from "../domain/hands.js";
import type { ClaimOutcome, ClaimRead } from "../domain/quests.js";
import type { PurchaseKey, PurchaseOutcome, PurchaseRead } from "../domain/shop.js";
import type {
  GameStatsRecord,
  HandRecord,
  LedgerEntry,
  PlayerRecord,
  QuestProgressRecord,
  WeeklyStatsRecord,
} from "../domain/types.js";

/**
 * Highroller's data port. Implemented by postgres.ts (self-hosted) and
 * firestore.ts (cloud); src/domain depends only on this.
 *
 * The transactional methods take a pure function and run it inside the
 * transaction on what it read. That function may run more than once on
 * Firestore (contention retries), so it must not draw randomness or touch
 * anything outside its arguments; the domain makes sure of both.
 */
export interface HighrollerRepo extends Closable {
  /**
   * The player, created on first sight with the starting balance and an
   * `initial_grant` ledger entry. The display name and email are refreshed
   * from the session when they have changed.
   */
  ensurePlayer(user: SessionUser): Promise<PlayerRecord>;
  getPlayer(userId: string): Promise<PlayerRecord | null>;

  /** Newest first, entries with `seq` below `beforeSeq` when given. */
  listLedger(userId: string, opts: { beforeSeq?: number; limit: number }): Promise<LedgerEntry[]>;

  /**
   * One transaction: reads the player, asks `decide` for the credit (it may
   * throw an AppError to refuse), writes the balance and its ledger entry
   * together. Null when the player is missing or the balance would go negative.
   */
  applyCredit(
    userId: string,
    decide: (player: PlayerRecord) => Credit,
  ): Promise<{ player: PlayerRecord; entry: LedgerEntry } | null>;

  /**
   * One hand transaction (see domain/hands.ts): reads the HandTxRead set for
   * `key`, runs `step`, and applies its writes. On Postgres the player row is
   * locked first, which serialises every hand transaction for that player.
   */
  handTransaction(userId: string, key: HandTxKey, step: (read: HandTxRead) => HandTxOutcome): Promise<HandTxOutcome>;

  /** Null when missing or someone else's. */
  getHand(userId: string, id: string): Promise<HandRecord | null>;
  /** The player's unfinished hands, at most one per game. */
  getActiveHands(userId: string): Promise<HandRecord[]>;
  /** Newest first by (created_at, id), strictly after `before` when given. */
  listHands(
    userId: string,
    opts: { game?: string; before?: { createdAt: string; id: string }; limit: number },
  ): Promise<HandRecord[]>;

  getGameStats(userId: string): Promise<GameStatsRecord[]>;
  getWeeklyStats(userId: string, week: string): Promise<WeeklyStatsRecord | null>;

  /**
   * The balance at each instant: `balance_after` of the player's last ledger
   * entry created at or before it, or null before their first.
   */
  balancesAt(userId: string, instants: Date[]): Promise<(number | null)[]>;

  /** Ids of the items the player has bought (defaults are never stored). */
  getInventory(userId: string): Promise<string[]>;
  /**
   * One purchase transaction (domain/shop.ts): reads the PurchaseRead set for
   * `key`, runs `step`, and writes the player, ledger, inventory row and
   * quest progress it returns.
   */
  purchase(userId: string, key: PurchaseKey, step: (read: PurchaseRead) => PurchaseOutcome): Promise<PurchaseOutcome>;
  /** Replaces the player's equipped map. Ownership is the caller's check. */
  setEquipped(userId: string, equipped: Equipped): Promise<void>;

  /** The progress rows that exist among `keys`. */
  getQuestProgress(userId: string, keys: QuestKey[]): Promise<QuestProgressRecord[]>;
  /** One claim transaction (domain/quests.ts `planClaim`): player, progress row, ledger row. */
  claimQuest(userId: string, key: QuestKey, step: (read: ClaimRead) => ClaimOutcome): Promise<ClaimOutcome>;
}
