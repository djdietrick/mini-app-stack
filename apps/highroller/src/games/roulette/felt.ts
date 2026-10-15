import { type BetKind, DOUBLE_ZERO, type Variant, sortNumbers, spotKey, validBets } from "./engine.js";

/**
 * The betting felt's geometry, for the SPA's portrait layout: which bet a tap
 * lands on, and where a bet's chips sit. Pure so it can be tested here
 * (felt.test.ts checks every legal bet can be hit, with room for a thumb);
 * the server never uses it.
 *
 * The felt runs top to bottom, as on a phone held upright: the zero row, the
 * twelve rows of three numbers (1-2-3 at the top), then the three column
 * bets. Left of the numbers sit the even-money bets and the dozens.
 *
 *   ┌────┬────┬───────────────────────┐
 *   │    │    │       0  (or 0 | 00)  │  ZERO_H
 *   ├────┼────┼───────┬───────┬───────┤
 *   │1-18│    │   1   │   2   │   3   │  ROW_H × 12
 *   │EVEN│1st │   4   │   5   │   6   │
 *   │ …  │12  │  …    │       │       │
 *   ├────┴────┼───────┼───────┼───────┤
 *   │         │  2:1  │  2:1  │  2:1  │  COLBET_H
 *   └─────────┴───────┴───────┴───────┘
 *
 * Units are felt units at zoom 1, the size the scene draws them; zoomed to
 * 2× on a 360 px phone a felt unit is about 1.85 CSS pixels. Bets on a line
 * (splits, streets, corners) are hit within BAND of it, so every spot is at
 * least 2 × BAND across.
 */
export const FELT = { width: 380, height: 540 } as const;
const OUT_W = 46;
export const GRID_X = 2 * OUT_W;
export const COL_W = 96;
export const ZERO_H = 36;
export const GRID_Y = ZERO_H;
export const ROW_H = 39;
export const GRID_BOTTOM = GRID_Y + 12 * ROW_H;
export const COLBET_H = 36;
export const BAND = 8;

const GRID_RIGHT = GRID_X + 3 * COL_W;
/** The American 0 | 00 divide, in the middle of the second column. */
const MID_X = GRID_X + 1.5 * COL_W;

export interface Spot {
  kind: BetKind;
  numbers: number[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const spot = (kind: BetKind, numbers: number[]): Spot => ({ kind, numbers: sortNumbers(numbers) });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const num = (row: number, col: number) => 3 * row + col + 1;

/** The even-money bets, top to bottom, two rows each. */
export const EVEN_MONEY = [
  { kind: "low", label: "1–18", numbers: range(1, 18) },
  { kind: "even", label: "EVEN", numbers: range(1, 36).filter((n) => n % 2 === 0) },
  { kind: "red", label: "RED", numbers: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36] },
  { kind: "black", label: "BLACK", numbers: [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35] },
  { kind: "odd", label: "ODD", numbers: range(1, 36).filter((n) => n % 2 === 1) },
  { kind: "high", label: "19–36", numbers: range(19, 36) },
] as const satisfies readonly { kind: BetKind; label: string; numbers: readonly number[] }[];

/** The bet a tap at (x, y) places, or null for a tap on nothing. */
export function hitTest(variant: Variant, x: number, y: number): Spot | null {
  const am = variant === "american";
  if (x < 0 || x >= FELT.width || y < 0 || y >= FELT.height) return null;

  // Outside bets, left of the numbers. The street band reaches BAND into the dozens.
  if (x < GRID_X - BAND) {
    if (y < GRID_Y || y >= GRID_BOTTOM) return null;
    if (x < OUT_W) {
      const e = EVEN_MONEY[Math.floor((y - GRID_Y) / (2 * ROW_H))];
      return spot(e.kind, [...e.numbers]);
    }
    const d = Math.floor((y - GRID_Y) / (4 * ROW_H));
    return spot("dozen", range(12 * d + 1, 12 * d + 12));
  }
  if (x >= GRID_RIGHT) return null;

  // Column bets, under the numbers.
  if (y >= GRID_BOTTOM) {
    if (x < GRID_X) return null;
    const c = Math.floor((x - GRID_X) / COL_W);
    return spot("column", range(1, 36).filter((n) => n % 3 === (c + 1) % 3));
  }

  // The zero row.
  if (y < GRID_Y - BAND) {
    if (x < GRID_X) return null;
    if (!am) return spot("straight", [0]);
    if (Math.abs(x - MID_X) < BAND) return spot("split", [0, DOUBLE_ZERO]);
    return spot("straight", [x < MID_X ? 0 : DOUBLE_ZERO]);
  }

  // The line between the zero row and 1-2-3.
  if (y < GRID_Y + BAND) {
    if (x < GRID_X + BAND) return am ? spot("topline", [0, DOUBLE_ZERO, 1, 2, 3]) : spot("corner", [0, 1, 2, 3]);
    const line1 = GRID_X + COL_W;
    const line2 = GRID_X + 2 * COL_W;
    if (Math.abs(x - line1) < BAND) return spot("street", [0, 1, 2]);
    if (Math.abs(x - line2) < BAND) return spot("street", [am ? DOUBLE_ZERO : 0, 2, 3]);
    if (am && Math.abs(x - MID_X) < BAND) return spot("street", [0, DOUBLE_ZERO, 2]);
    const c = Math.floor((x - GRID_X) / COL_W);
    if (c === 0) return spot("split", [0, 1]);
    if (c === 1) return spot("split", [am && x > MID_X ? DOUBLE_ZERO : 0, 2]);
    return spot("split", [am ? DOUBLE_ZERO : 0, 3]);
  }

  // The numbers.
  const r = Math.min(11, Math.floor((y - GRID_Y) / ROW_H));
  const fy = y - (GRID_Y + r * ROW_H);
  /** The upper row of the horizontal line the tap is on, or null. */
  const hRow = fy < BAND && r > 0 ? r - 1 : fy > ROW_H - BAND && r < 11 ? r : null;

  if (x < GRID_X + BAND) {
    return hRow === null ? spot("street", range(num(r, 0), num(r, 2))) : spot("sixline", range(num(hRow, 0), num(hRow + 1, 2)));
  }

  const c = Math.min(2, Math.floor((x - GRID_X) / COL_W));
  const fx = x - (GRID_X + c * COL_W);
  /** The left column of the vertical line the tap is on, or null. */
  const vCol = fx < BAND && c > 0 ? c - 1 : fx > COL_W - BAND && c < 2 ? c : null;

  if (vCol !== null && hRow !== null) {
    const n = num(hRow, vCol);
    return spot("corner", [n, n + 1, n + 3, n + 4]);
  }
  if (vCol !== null) return spot("split", [num(r, vCol), num(r, vCol) + 1]);
  if (hRow !== null) return spot("split", [num(hRow, c), num(hRow, c) + 3]);
  return spot("straight", [num(r, c)]);
}

const rowOf = (n: number) => Math.floor((n - 1) / 3);
const colOf = (n: number) => (n - 1) % 3;
const colCentre = (c: number) => GRID_X + (c + 0.5) * COL_W;
const rowCentre = (r: number) => GRID_Y + (r + 0.5) * ROW_H;
const rowLine = (upperRow: number) => GRID_Y + (upperRow + 1) * ROW_H;
const colLine = (leftCol: number) => GRID_X + (leftCol + 1) * COL_W;

/** Where a bet's chips sit: the middle of the cell, line or corner it covers. */
export function anchorOf(variant: Variant, s: Spot): { x: number; y: number } {
  const am = variant === "american";
  const ns = sortNumbers(s.numbers);
  const hasZero = ns[0] === 0 || ns.includes(DOUBLE_ZERO);
  switch (s.kind) {
    case "straight": {
      const n = ns[0];
      if (n === 0) return { x: am ? GRID_X + 0.75 * COL_W : MID_X, y: (GRID_Y - BAND) / 2 };
      if (n === DOUBLE_ZERO) return { x: GRID_X + 2.25 * COL_W, y: (GRID_Y - BAND) / 2 };
      return { x: colCentre(colOf(n)), y: rowCentre(rowOf(n)) };
    }
    case "split": {
      if (ns[0] === 0 && ns[1] === DOUBLE_ZERO) return { x: MID_X, y: (GRID_Y - BAND) / 2 };
      if (hasZero) {
        const n = ns[0] === 0 ? ns[1] : ns[0];
        const zero = ns.includes(DOUBLE_ZERO) ? DOUBLE_ZERO : 0;
        const c = colOf(n);
        // The American middle column splits two ways: 0-2 on its left half, 00-2 on its right.
        const x = am && c === 1 ? (zero === 0 ? (GRID_X + COL_W + BAND + MID_X - BAND) / 2 : (MID_X + BAND + GRID_X + 2 * COL_W - BAND) / 2) : colCentre(c);
        return { x, y: GRID_Y };
      }
      const [a, b] = ns;
      if (b - a === 1) return { x: colLine(colOf(a)), y: rowCentre(rowOf(a)) };
      return { x: colCentre(colOf(a)), y: rowLine(rowOf(a)) };
    }
    case "street":
      if (hasZero) {
        if (ns.includes(0) && ns.includes(DOUBLE_ZERO)) return { x: MID_X, y: GRID_Y };
        return { x: ns.includes(1) ? colLine(0) : colLine(1), y: GRID_Y };
      }
      return { x: GRID_X, y: rowCentre(rowOf(ns[0])) };
    case "corner":
      if (hasZero) return { x: GRID_X, y: GRID_Y };
      return { x: colLine(colOf(ns[0])), y: rowLine(rowOf(ns[0])) };
    case "topline":
      return { x: GRID_X, y: GRID_Y };
    case "sixline":
      return { x: GRID_X, y: rowLine(rowOf(ns[0])) };
    case "dozen": {
      const d = Math.floor((ns[0] - 1) / 12);
      return { x: OUT_W + (OUT_W - BAND) / 2, y: GRID_Y + (d + 0.5) * 4 * ROW_H };
    }
    case "column": {
      const c = colOf(ns[0]);
      return { x: colCentre(c), y: GRID_BOTTOM + COLBET_H / 2 };
    }
    default: {
      const i = EVEN_MONEY.findIndex((e) => e.kind === s.kind);
      return { x: OUT_W / 2, y: GRID_Y + (i + 0.5) * 2 * ROW_H };
    }
  }
}

/**
 * The three zones a tap zooms into from the whole felt, as felt rects: the
 * numbers 1–12 with the zero row, 13–24 and 25–36.
 */
export function zoneAt(y: number): Rect | null {
  if (y >= GRID_BOTTOM) return null;
  const z = y < GRID_Y ? 0 : Math.min(2, Math.floor((y - GRID_Y) / (4 * ROW_H)));
  const top = z === 0 ? 0 : GRID_Y + z * 4 * ROW_H - ROW_H / 2;
  const bottom = GRID_Y + (z + 1) * 4 * ROW_H + (z < 2 ? ROW_H / 2 : 0);
  return { x: GRID_X - BAND, y: top, width: GRID_RIGHT - GRID_X + BAND, height: bottom - top };
}

/** Every spot on a variant's felt with its anchor, for drawing and for tests. */
export function feltSpots(variant: Variant) {
  return validBets(variant).map((b) => ({ ...b, key: spotKey(b.kind, b.numbers), anchor: anchorOf(variant, b) }));
}
