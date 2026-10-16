import { conflict } from "@stack/service-kit";
import { type Equipped, type ShopItem, isDefaultItem } from "./catalog.js";
import { applyCreditTo } from "./economy.js";
import type { QuestKey } from "./hands.js";
import { type ActiveQuest, type Completion, foldQuests } from "./quests.js";
import type { LedgerEntry, PlayerRecord, QuestProgressRecord, ShopItemRow } from "./types.js";

/**
 * Buying a cosmetic: a read set plus a pure step, like a hand. The repo reads
 * the player (locked on Postgres), whether they own the item, and the
 * progress rows of the achievements a purchase moves; `planPurchase` returns
 * every write or throws. One transaction covers the debit, its `purchase`
 * ledger row, the inventory row and the achievement progress.
 */
export interface PurchaseRead {
  player: PlayerRecord;
  owned: boolean;
  quests: QuestProgressRecord[];
}

export interface PurchaseOutcome {
  player: PlayerRecord;
  ledger: LedgerEntry[];
  itemId: string;
  quests: QuestProgressRecord[];
  completed: Completion[];
}

export interface PurchaseKey {
  itemId: string;
  quests: QuestKey[];
}

export function planPurchase(
  read: PurchaseRead,
  plan: { item: ShopItem; quests: readonly ActiveQuest[]; now: string },
): PurchaseOutcome {
  const { item } = plan;
  if (read.owned || isDefaultItem(item.id)) throw conflict("ALREADY_OWNED");
  const debit = applyCreditTo(read.player, { kind: "purchase", amount: -item.price, ref: item.id }, plan.now);
  if (!debit) throw conflict("INSUFFICIENT_FUNDS");
  const quests = foldQuests(plan.quests, read.quests, { purchase: item }, read.player.userId, plan.now);
  return { player: debit.player, ledger: [debit.entry], itemId: item.id, quests: quests.rows, completed: quests.completed };
}

export function toShopItemRow(item: ShopItem, owned: ReadonlySet<string>, equipped: Equipped): ShopItemRow {
  const isDefault = isDefaultItem(item.id);
  return { ...item, owned: isDefault || owned.has(item.id), equipped: equipped[item.kind] === item.id, is_default: isDefault };
}
