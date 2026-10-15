/**
 * Cosmetics are parameter sets, not art: textures.ts draws every card back,
 * felt and chip from one of these. The shop (#48) adds items by adding data
 * here (and a catalog entry with a fixed UUID on the server), never images.
 */

export interface CardBackStyle {
  id: string;
  name: string;
  base: string;
  /** Pattern and border colour. */
  accent: string;
  pattern: "lattice" | "dots" | "stripes";
  /** The white margin real decks have. */
  margin: boolean;
}

export interface FeltStyle {
  id: string;
  name: string;
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

export interface ChipSet {
  id: string;
  name: string;
  edge: "inserts" | "dashes" | "solid";
  /** Colours by denomination; a value takes the largest denomination at or below it. */
  colors: Record<number, ChipColors>;
}

/** The chips the bet bar offers, smallest first. */
export const DENOMINATIONS = [5, 25, 100, 500, 1_000, 5_000] as const;

export const CLASSIC_BACK: CardBackStyle = {
  id: "classic-red",
  name: "Classic red",
  base: "#b91c1c",
  accent: "#fde8e8",
  pattern: "lattice",
  margin: true,
};

export const GREEN_FELT: FeltStyle = {
  id: "green",
  name: "Casino green",
  light: "#1d7a43",
  dark: "#0c3a20",
  line: "rgba(243, 239, 226, 0.55)",
  weave: true,
};

export const STANDARD_CHIPS: ChipSet = {
  id: "standard",
  name: "Standard",
  edge: "inserts",
  colors: {
    5: { base: "#c62828", stripe: "#f8f3e3", text: "#f8f3e3" },
    25: { base: "#2e7d32", stripe: "#f8f3e3", text: "#f8f3e3" },
    100: { base: "#1f1f1f", stripe: "#d4af37", text: "#f8f3e3" },
    500: { base: "#6a1b9a", stripe: "#f8f3e3", text: "#f8f3e3" },
    1_000: { base: "#f9a825", stripe: "#1f1f1f", text: "#1f1f1f" },
    5_000: { base: "#e65100", stripe: "#f8f3e3", text: "#f8f3e3" },
  },
};

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

/** What the player has equipped. The shop and Settings change this later (#48). */
export interface Equipped {
  back: CardBackStyle;
  felt: FeltStyle;
  chips: ChipSet;
}

export const DEFAULT_EQUIPPED: Equipped = { back: CLASSIC_BACK, felt: GREEN_FELT, chips: STANDARD_CHIPS };
