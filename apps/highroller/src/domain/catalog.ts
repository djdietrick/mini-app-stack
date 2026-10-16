/**
 * The shop: every cosmetic on sale, as data. A cosmetic is a parameter set
 * that web/src/table/textures.ts draws from, never an image, so adding one is
 * a new entry here and nothing else.
 *
 * Pure and dependency-free: the SPA imports it by relative path (like the
 * games), so the server's prices and the tables' drawings come from one list.
 *
 * Ids are fixed UUIDs. Never change one: inventories and equipped slots store
 * them. The first item of each kind is the default, free and always owned;
 * defaults have no inventory row.
 */

export const COSMETIC_KINDS = ["card_back", "felt", "chip_set"] as const;
export type CosmeticKind = (typeof COSMETIC_KINDS)[number];

export interface CardBackParams {
  base: string;
  /** Pattern and border colour. */
  accent: string;
  pattern: "lattice" | "dots" | "stripes" | "diamonds" | "rings";
  /** The white margin real decks have. */
  margin: boolean;
}

export interface FeltParams {
  /** Centre of the radial gradient. */
  light: string;
  /** Edge of the radial gradient. */
  dark: string;
  /** Table markings: bet circles, lines, lettering. */
  line: string;
  weave: boolean;
}

export interface ChipColors {
  base: string;
  /** The edge inserts and the inner ring. */
  stripe: string;
  text: string;
}

export interface ChipSetParams {
  edge: "inserts" | "dashes" | "solid";
  /** Colours by denomination; a value takes the largest denomination at or below it. */
  colors: Record<number, ChipColors>;
}

interface ItemBase {
  id: string;
  name: string;
  /** Chips. 0 for the defaults. */
  price: number;
}

export type ShopItem =
  | (ItemBase & { kind: "card_back"; params: CardBackParams })
  | (ItemBase & { kind: "felt"; params: FeltParams })
  | (ItemBase & { kind: "chip_set"; params: ChipSetParams });

/** What a player has equipped: an item id per kind. */
export type Equipped = Record<CosmeticKind, string>;

const chipSet = (
  edge: ChipSetParams["edge"],
  [c5, c25, c100, c500, c1k, c5k]: [string, string, string][],
): ChipSetParams => {
  const c = ([base, stripe, text]: [string, string, string]): ChipColors => ({ base, stripe, text });
  return { edge, colors: { 5: c(c5), 25: c(c25), 100: c(c100), 500: c(c500), 1_000: c(c1k), 5_000: c(c5k) } };
};

const CREAM = "#f8f3e3";
const INK = "#1f1f1f";

export const CATALOG: readonly ShopItem[] = [
  // ---------- card backs ----------
  {
    id: "0b6a6f3e-3c1f-4f0e-9f54-1a7c2d0e0b01",
    kind: "card_back",
    name: "Classic red",
    price: 0,
    params: { base: "#b91c1c", accent: "#fde8e8", pattern: "lattice", margin: true },
  },
  {
    id: "0b6a6f3e-3c1f-4f0e-9f54-1a7c2d0e0b02",
    kind: "card_back",
    name: "Bicycle blue",
    price: 5_000,
    params: { base: "#1e40af", accent: "#dbeafe", pattern: "lattice", margin: true },
  },
  {
    id: "0b6a6f3e-3c1f-4f0e-9f54-1a7c2d0e0b03",
    kind: "card_back",
    name: "Emerald dots",
    price: 15_000,
    params: { base: "#065f46", accent: "#a7f3d0", pattern: "dots", margin: true },
  },
  {
    id: "0b6a6f3e-3c1f-4f0e-9f54-1a7c2d0e0b04",
    kind: "card_back",
    name: "Pinstripe",
    price: 40_000,
    params: { base: "#1c1917", accent: "#d6d3d1", pattern: "stripes", margin: false },
  },
  {
    id: "0b6a6f3e-3c1f-4f0e-9f54-1a7c2d0e0b05",
    kind: "card_back",
    name: "Royal diamonds",
    price: 120_000,
    params: { base: "#581c87", accent: "#f0abfc", pattern: "diamonds", margin: true },
  },
  {
    id: "0b6a6f3e-3c1f-4f0e-9f54-1a7c2d0e0b06",
    kind: "card_back",
    name: "Gilded rings",
    price: 400_000,
    params: { base: "#111111", accent: "#d4af37", pattern: "rings", margin: false },
  },

  // ---------- felts ----------
  {
    id: "5d2e8c1a-7b44-4a39-8e0f-3c6b9a4f0f01",
    kind: "felt",
    name: "Casino green",
    price: 0,
    params: { light: "#1d7a43", dark: "#0c3a20", line: "rgba(243, 239, 226, 0.55)", weave: true },
  },
  {
    id: "5d2e8c1a-7b44-4a39-8e0f-3c6b9a4f0f02",
    kind: "felt",
    name: "Riviera blue",
    price: 10_000,
    params: { light: "#1d5f9a", dark: "#0b2747", line: "rgba(226, 236, 248, 0.55)", weave: true },
  },
  {
    id: "5d2e8c1a-7b44-4a39-8e0f-3c6b9a4f0f03",
    kind: "felt",
    name: "Burgundy",
    price: 30_000,
    params: { light: "#8a1c2b", dark: "#3d0a12", line: "rgba(248, 230, 226, 0.55)", weave: true },
  },
  {
    id: "5d2e8c1a-7b44-4a39-8e0f-3c6b9a4f0f04",
    kind: "felt",
    name: "Teal lagoon",
    price: 75_000,
    params: { light: "#0f8a87", dark: "#053a3a", line: "rgba(226, 248, 244, 0.55)", weave: true },
  },
  {
    id: "5d2e8c1a-7b44-4a39-8e0f-3c6b9a4f0f05",
    kind: "felt",
    name: "Violet hour",
    price: 250_000,
    params: { light: "#5b2a9a", dark: "#1e0b3d", line: "rgba(240, 230, 252, 0.55)", weave: false },
  },
  {
    id: "5d2e8c1a-7b44-4a39-8e0f-3c6b9a4f0f06",
    kind: "felt",
    name: "Black tie",
    price: 1_000_000,
    params: { light: "#2b2b2b", dark: "#050505", line: "rgba(212, 175, 55, 0.7)", weave: false },
  },

  // ---------- chip sets ----------
  {
    id: "9a3f7d2b-1e6c-4b8a-a5d4-6f2e1c8b0c01",
    kind: "chip_set",
    name: "Standard",
    price: 0,
    params: chipSet("inserts", [
      ["#c62828", CREAM, CREAM],
      ["#2e7d32", CREAM, CREAM],
      [INK, "#d4af37", CREAM],
      ["#6a1b9a", CREAM, CREAM],
      ["#f9a825", INK, INK],
      ["#e65100", CREAM, CREAM],
    ]),
  },
  {
    id: "9a3f7d2b-1e6c-4b8a-a5d4-6f2e1c8b0c02",
    kind: "chip_set",
    name: "Monaco pastels",
    price: 8_000,
    params: chipSet("dashes", [
      ["#f4a7b9", "#ffffff", "#5b1a2a"],
      ["#a7d8c9", "#ffffff", "#123d33"],
      ["#b8c4f4", "#ffffff", "#1a2557"],
      ["#e2c4f4", "#ffffff", "#3d1a57"],
      ["#f4e2a7", "#ffffff", "#574a1a"],
      ["#f4c4a7", "#ffffff", "#57301a"],
    ]),
  },
  {
    id: "9a3f7d2b-1e6c-4b8a-a5d4-6f2e1c8b0c03",
    kind: "chip_set",
    name: "Old Vegas",
    price: 25_000,
    params: chipSet("inserts", [
      ["#e53935", "#1565c0", CREAM],
      ["#43a047", "#fdd835", CREAM],
      ["#212121", "#e53935", CREAM],
      ["#8e24aa", "#fdd835", CREAM],
      ["#fdd835", "#e53935", INK],
      ["#fb8c00", "#1565c0", INK],
    ]),
  },
  {
    id: "9a3f7d2b-1e6c-4b8a-a5d4-6f2e1c8b0c04",
    kind: "chip_set",
    name: "Neon",
    price: 60_000,
    params: chipSet("dashes", [
      ["#111111", "#ff2d95", "#ff2d95"],
      ["#111111", "#39ff14", "#39ff14"],
      ["#111111", "#00e5ff", "#00e5ff"],
      ["#111111", "#bf5af2", "#bf5af2"],
      ["#111111", "#ffd60a", "#ffd60a"],
      ["#111111", "#ff9f0a", "#ff9f0a"],
    ]),
  },
  {
    id: "9a3f7d2b-1e6c-4b8a-a5d4-6f2e1c8b0c05",
    kind: "chip_set",
    name: "Ivory",
    price: 200_000,
    params: chipSet("solid", [
      ["#f5efe0", "#b91c1c", "#b91c1c"],
      ["#f5efe0", "#15803d", "#15803d"],
      ["#f5efe0", INK, INK],
      ["#f5efe0", "#6b21a8", "#6b21a8"],
      ["#f5efe0", "#a16207", "#a16207"],
      ["#f5efe0", "#c2410c", "#c2410c"],
    ]),
  },
  {
    id: "9a3f7d2b-1e6c-4b8a-a5d4-6f2e1c8b0c06",
    kind: "chip_set",
    name: "Solid gold",
    price: 750_000,
    params: chipSet("inserts", [
      ["#b8860b", INK, INK],
      ["#c9971c", INK, INK],
      ["#d4af37", INK, INK],
      ["#e0bf4f", INK, INK],
      ["#ecd27a", INK, INK],
      ["#f5e3a3", INK, INK],
    ]),
  },
];

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));

export function shopItem(id: string): ShopItem | undefined {
  return BY_ID.get(id);
}

/** The free item of each kind, which every player owns. */
export const DEFAULT_EQUIPPED: Equipped = {
  card_back: CATALOG.find((i) => i.kind === "card_back")!.id,
  felt: CATALOG.find((i) => i.kind === "felt")!.id,
  chip_set: CATALOG.find((i) => i.kind === "chip_set")!.id,
};

export const isDefaultItem = (id: string) => Object.values(DEFAULT_EQUIPPED).includes(id);

/** The items that cost something, the ones an inventory can hold. */
export const PAID_ITEMS = CATALOG.filter((i) => !isDefaultItem(i.id));

/**
 * A stored equipped map, read leniently: an unknown id or a missing kind (a
 * player from before the shop) falls back to the default.
 */
export function equippedOf(stored: Partial<Record<string, unknown>> | null | undefined): Equipped {
  const out = { ...DEFAULT_EQUIPPED };
  for (const kind of COSMETIC_KINDS) {
    const id = stored?.[kind];
    if (typeof id === "string" && shopItem(id)?.kind === kind) out[kind] = id;
  }
  return out;
}
