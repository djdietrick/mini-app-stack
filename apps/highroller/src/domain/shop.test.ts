import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "@stack/service-kit";
import { CATALOG, COSMETIC_KINDS, DEFAULT_EQUIPPED, PAID_ITEMS, equippedOf, isDefaultItem, shopItem } from "./catalog.js";
import { newPlayer } from "./economy.js";
import { ACHIEVEMENTS } from "./quests.js";
import { planPurchase, toShopItemRow } from "./shop.js";

const NOW = "2026-10-15T12:00:00.000Z";
const player = newPlayer({ userId: "u1", email: "pat@example.com", displayName: "Pat" }, NOW).player;
const collector = [{ def: ACHIEVEMENTS.find((a) => a.id === "a-collector")!, period: "ever" }];

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
  return "no error";
};

describe("the catalog", () => {
  it("has about six of each kind, with unique UUIDs, a free default and prices to save up for", () => {
    assert.equal(new Set(CATALOG.map((i) => i.id)).size, CATALOG.length);
    for (const kind of COSMETIC_KINDS) {
      const items = CATALOG.filter((i) => i.kind === kind);
      assert.equal(items.length, 6, kind);
      assert.equal(items[0].price, 0);
      assert.equal(DEFAULT_EQUIPPED[kind], items[0].id);
      for (const i of items.slice(1)) assert.ok(i.price >= 5_000 && i.price <= 1_000_000, i.name);
    }
    for (const i of CATALOG) assert.match(i.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(Math.max(...CATALOG.map((i) => i.price)), 1_000_000);
    assert.equal(PAID_ITEMS.length, CATALOG.length - 3);
  });

  it("reads a stored equipped map leniently", () => {
    const felt = CATALOG.find((i) => i.kind === "felt" && i.price > 0)!;
    assert.deepEqual(equippedOf(null), DEFAULT_EQUIPPED);
    assert.deepEqual(equippedOf({ felt: felt.id }), { ...DEFAULT_EQUIPPED, felt: felt.id });
    // An id of the wrong kind, or one that no longer exists, falls back.
    assert.deepEqual(equippedOf({ card_back: felt.id, chip_set: "nope" }), DEFAULT_EQUIPPED);
  });
});

describe("buying", () => {
  const item = shopItem(PAID_ITEMS[0].id)!;

  it("debits the price with a purchase row, and moves the collector achievement", () => {
    const out = planPurchase({ player, owned: false, quests: [] }, { item, quests: collector, now: NOW });
    assert.equal(out.player.balance, player.balance - item.price);
    assert.deepEqual(out.ledger.map((e) => [e.kind, e.amount, e.ref]), [["purchase", -item.price, item.id]]);
    assert.equal(out.itemId, item.id);
    assert.equal(out.quests[0].progress, 1);
    assert.equal(out.completed.length, 1);
  });

  it("refuses an item already owned, a default, and one the balance can't cover", () => {
    assert.equal(code(() => planPurchase({ player, owned: true, quests: [] }, { item, quests: [], now: NOW })), "ALREADY_OWNED");
    const def = shopItem(DEFAULT_EQUIPPED.felt)!;
    assert.equal(code(() => planPurchase({ player, owned: false, quests: [] }, { item: def, quests: [], now: NOW })), "ALREADY_OWNED");
    const dear = CATALOG.find((i) => i.price === 1_000_000)!;
    assert.equal(code(() => planPurchase({ player, owned: false, quests: [] }, { item: dear, quests: [], now: NOW })), "INSUFFICIENT_FUNDS");
  });

  it("flags defaults as owned and marks what is equipped", () => {
    const row = toShopItemRow(shopItem(DEFAULT_EQUIPPED.card_back)!, new Set(), DEFAULT_EQUIPPED);
    assert.deepEqual([row.owned, row.equipped, row.is_default], [true, true, true]);
    assert.ok(isDefaultItem(DEFAULT_EQUIPPED.chip_set));
    const bought = toShopItemRow(item, new Set([item.id]), DEFAULT_EQUIPPED);
    assert.deepEqual([bought.owned, bought.equipped, bought.is_default], [true, false, false]);
  });
});
