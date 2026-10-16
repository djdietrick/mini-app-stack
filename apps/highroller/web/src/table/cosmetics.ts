import {
  type CardBackParams,
  CATALOG,
  type ChipColors,
  type ChipSetParams,
  DEFAULT_EQUIPPED as DEFAULT_IDS,
  type Equipped as EquippedIds,
  type FeltParams,
  shopItem,
} from "../../../src/domain/catalog.js";

/**
 * Cosmetics are parameter sets, not art: textures.ts draws every card back,
 * felt and chip from one of these. They come from the server's catalog
 * (src/domain/catalog.ts, pure, imported here by relative path), so the shop
 * adds an item by adding data there, never images. A style is the item's
 * params plus its id, which keys the texture cache.
 */

export type { ChipColors };

export type CardBackStyle = CardBackParams & { id: string; name: string };
export type FeltStyle = FeltParams & { id: string; name: string };
export type ChipSet = ChipSetParams & { id: string; name: string };

/** The chips the bet bar offers, smallest first. */
export const DENOMINATIONS = [5, 25, 100, 500, 1_000, 5_000] as const;

type Params = { card_back: CardBackParams; felt: FeltParams; chip_set: ChipSetParams };

function style<K extends keyof Params>(id: string, kind: K): Params[K] & { id: string; name: string } {
  const item = shopItem(id);
  // An id the catalog doesn't know (or of another kind) draws the default.
  const found = item && item.kind === kind ? item : shopItem(DEFAULT_IDS[kind])!;
  return { ...(found.params as Params[K]), id: found.id, name: found.name };
}

export const cardBackStyle = (id: string): CardBackStyle => style(id, "card_back");
export const feltStyle = (id: string): FeltStyle => style(id, "felt");
export const chipSetStyle = (id: string): ChipSet => style(id, "chip_set");

export const CLASSIC_BACK = cardBackStyle(DEFAULT_IDS.card_back);
export const GREEN_FELT = feltStyle(DEFAULT_IDS.felt);
export const STANDARD_CHIPS = chipSetStyle(DEFAULT_IDS.chip_set);

export { CATALOG };

export function chipColors(set: ChipSet, value: number): ChipColors {
  const denoms = Object.keys(set.colors)
    .map(Number)
    .sort((a, b) => a - b);
  let pick = denoms[0];
  for (const d of denoms) if (d <= value) pick = d;
  return set.colors[pick];
}

/**
 * Breaks an amount into chips, largest first, for drawing a stack. Capped so
 * a huge bet draws a tidy stack rather than hundreds of chips.
 */
export function chipBreakdown(amount: number, max = 12): number[] {
  const out: number[] = [];
  let rest = amount;
  for (let i = DENOMINATIONS.length - 1; i >= 0 && out.length < max; i--) {
    const d = DENOMINATIONS[i];
    while (rest >= d && out.length < max) {
      out.push(d);
      rest -= d;
    }
  }
  return out;
}

/** What the player has equipped, as styles the textures draw. */
export interface Equipped {
  back: CardBackStyle;
  felt: FeltStyle;
  chips: ChipSet;
}

export const DEFAULT_EQUIPPED: Equipped = { back: CLASSIC_BACK, felt: GREEN_FELT, chips: STANDARD_CHIPS };

/** The styles for a player's equipped item ids (PlayerRow.equipped). */
export function equippedStyles(ids: EquippedIds): Equipped {
  return { back: cardBackStyle(ids.card_back), felt: feltStyle(ids.felt), chips: chipSetStyle(ids.chip_set) };
}
