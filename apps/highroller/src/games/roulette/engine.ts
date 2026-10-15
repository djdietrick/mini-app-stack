import { type BetResult, type GameEngine, type TableLimits, checkStake, outcomeOf } from "../engine.js";

/**
 * Roulette (#45), European (one zero) and American (0 and 00). The first
 * single-decision game: the spin is drawn in `deal` and the hand settles in
 * the same transaction that takes the bets.
 *
 * A bet is `{ kind, numbers, amount }`. It is checked against the layout by
 * kind and the numbers it covers (`validBets`), never trusted from the
 * client: a "split" must be two numbers that touch on the felt, and so on.
 * 00 travels as 37.
 *
 * Every bet but the American top line returns 36 per 37 (or 38) chips; the
 * top line (0-00-1-2-3) pays 6:1 and returns 35/38. The exact-RTP test
 * enumerates every bet against every pocket.
 */
export const VARIANTS = ["european", "american"] as const;
export type Variant = (typeof VARIANTS)[number];

export const DOUBLE_ZERO = 37;
/** Per spot 5–1,000; at most 10,000 on the table and 40 spots per spin. */
export const ROULETTE_LIMITS: TableLimits = { min: 5, max: 1_000, step: 5, total: 10_000 };
export const MAX_SPOTS = 40;

export const BET_KINDS = [
  "straight",
  "split",
  "street",
  "corner",
  "sixline",
  "topline",
  "dozen",
  "column",
  "red",
  "black",
  "odd",
  "even",
  "low",
  "high",
] as const;
export type BetKind = (typeof BET_KINDS)[number];

/** "x to 1". Trios (0-1-2) are streets and the first four (0-1-2-3) a corner, at the same price. */
export const PAYS: Record<BetKind, number> = {
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  sixline: 5,
  topline: 6,
  dozen: 2,
  column: 2,
  red: 1,
  black: 1,
  odd: 1,
  even: 1,
  low: 1,
  high: 1,
};

export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

export interface RouletteBet {
  kind: BetKind;
  /** The numbers covered, 37 for 00. */
  numbers: number[];
  amount: number;
}

export type RouletteBets = RouletteBet[];

export interface RouletteState {
  variant: Variant;
  /** Normalised: numbers sorted. */
  bets: RouletteBet[];
  /** 0–36, or 37 for 00. */
  pocket: number;
}

export interface RouletteView {
  variant: Variant;
  pocket: number;
  bets: (RouletteBet & { spot: string; returned: number })[];
}

export const pocketLabel = (n: number) => (n === DOUBLE_ZERO ? "00" : String(n));

export function pocketColor(n: number): "red" | "black" | "green" {
  if (n === 0 || n === DOUBLE_ZERO) return "green";
  return RED_NUMBERS.includes(n) ? "red" : "black";
}

/** Sorted numbers, 00 last. */
export const sortNumbers = (ns: readonly number[]) => [...ns].sort((a, b) => a - b);

const EVEN_MONEY: readonly BetKind[] = ["red", "black", "odd", "even", "low", "high"];

/**
 * One spot's id: "straight:17", "split:0-00", "dozen:13-24", "column:2",
 * "red". The client keys its chips by it, and it is the result's `spot`. It
 * names a spot, it doesn't prove one: validation compares the numbers too.
 */
export function spotKey(kind: BetKind, numbers: readonly number[]): string {
  if (EVEN_MONEY.includes(kind)) return kind;
  const ns = sortNumbers(numbers);
  if (kind === "dozen") return `dozen:${ns[0]}-${ns[ns.length - 1]}`;
  if (kind === "column") return `column:${ns[0]}`;
  return `${kind}:${ns.map(pocketLabel).join("-")}`;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A spot key back to its bet: "split:0-00" → split [0, 37]. The SPA keys chips by spot. */
export function betFromKey(key: string): { kind: BetKind; numbers: number[] } {
  const [kind, rest = ""] = key.split(":") as [BetKind, string?];
  switch (kind) {
    case "red":
      return { kind, numbers: [...RED_NUMBERS] };
    case "black":
      return { kind, numbers: range(1, 36).filter((n) => !RED_NUMBERS.includes(n)) };
    case "odd":
    case "even":
      return { kind, numbers: range(1, 36).filter((n) => n % 2 === (kind === "odd" ? 1 : 0)) };
    case "low":
      return { kind, numbers: range(1, 18) };
    case "high":
      return { kind, numbers: range(19, 36) };
    case "dozen": {
      const [a, b] = rest.split("-").map(Number);
      return { kind, numbers: range(a, b) };
    }
    case "column":
      return { kind, numbers: range(1, 36).filter((n) => n % 3 === Number(rest) % 3) };
    default:
      return { kind, numbers: rest.split("-").map((x) => (x === "00" ? DOUBLE_ZERO : Number(x))) };
  }
}

/** Every bet the felt allows, by spot key. */
function buildLayout(variant: Variant): Map<string, { kind: BetKind; numbers: number[] }> {
  const am = variant === "american";
  const out = new Map<string, { kind: BetKind; numbers: number[] }>();
  const add = (kind: BetKind, numbers: number[]) => {
    const ns = sortNumbers(numbers);
    out.set(spotKey(kind, ns), { kind, numbers: ns });
  };

  for (const n of range(0, 36)) add("straight", [n]);
  if (am) add("straight", [DOUBLE_ZERO]);

  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) add("split", [n, n + 1]);
    if (n <= 33) add("split", [n, n + 3]);
  }
  if (am) {
    for (const ns of [[0, 1], [0, 2], [DOUBLE_ZERO, 2], [DOUBLE_ZERO, 3], [0, DOUBLE_ZERO]]) add("split", ns);
  } else {
    for (const ns of [[0, 1], [0, 2], [0, 3]]) add("split", ns);
  }

  for (let r = 0; r < 12; r++) add("street", [3 * r + 1, 3 * r + 2, 3 * r + 3]);
  for (const ns of am ? [[0, 1, 2], [DOUBLE_ZERO, 2, 3], [0, DOUBLE_ZERO, 2]] : [[0, 1, 2], [0, 2, 3]]) add("street", ns);

  for (let n = 1; n <= 32; n++) if (n % 3 !== 0) add("corner", [n, n + 1, n + 3, n + 4]);
  if (!am) add("corner", [0, 1, 2, 3]);

  for (let r = 0; r < 11; r++) add("sixline", range(3 * r + 1, 3 * r + 6));
  if (am) add("topline", [0, DOUBLE_ZERO, 1, 2, 3]);

  for (let d = 0; d < 3; d++) add("dozen", range(12 * d + 1, 12 * d + 12));
  for (let c = 1; c <= 3; c++) add("column", range(1, 36).filter((n) => n % 3 === c % 3));
  add("red", RED_NUMBERS);
  add("black", range(1, 36).filter((n) => !RED_NUMBERS.includes(n)));
  add("odd", range(1, 36).filter((n) => n % 2 === 1));
  add("even", range(1, 36).filter((n) => n % 2 === 0));
  add("low", range(1, 18));
  add("high", range(19, 36));
  return out;
}

const LAYOUTS: Record<Variant, Map<string, { kind: BetKind; numbers: number[] }>> = {
  european: buildLayout("european"),
  american: buildLayout("american"),
};

/** Every legal bet on a variant's felt. */
export const validBets = (variant: Variant) => [...LAYOUTS[variant].values()];

const asVariant = (v: string | null): Variant => (v === "american" ? "american" : "european");
const pockets = (v: Variant) => (v === "american" ? 38 : 37);

/** Chips back from one bet on one pocket, the stake included. */
export const betReturn = (bet: RouletteBet, pocket: number) =>
  bet.numbers.includes(pocket) ? bet.amount * (PAYS[bet.kind] + 1) : 0;

export const roulette: GameEngine<RouletteBets, RouletteState, { type: string }, RouletteView> = {
  variants: VARIANTS,

  validateBets(bets, limits, variant) {
    if (bets.length === 0) return "place a bet";
    if (bets.length > MAX_SPOTS) return `at most ${MAX_SPOTS} spots`;
    const layout = LAYOUTS[asVariant(variant)];
    const seen = new Set<string>();
    let total = 0;
    for (const b of bets) {
      const key = spotKey(b.kind, b.numbers);
      const spot = layout.get(key);
      const ns = sortNumbers(b.numbers);
      if (!spot || spot.numbers.length !== ns.length || spot.numbers.some((n, i) => n !== ns[i])) {
        return `not a bet on this table: ${b.kind} ${b.numbers.map(pocketLabel).join(",")}`;
      }
      if (seen.has(key)) return `two bets on ${key}`;
      seen.add(key);
      const bad = checkStake(b.amount, limits);
      if (bad) return bad;
      total += b.amount;
    }
    if (limits.total !== undefined && total > limits.total) return `table maximum is ${limits.total}`;
    return null;
  },

  deal(bets, rng, variant) {
    const v = asVariant(variant);
    return {
      variant: v,
      bets: bets.map((b) => ({ kind: b.kind, numbers: sortNumbers(b.numbers), amount: b.amount })),
      pocket: rng.int(pockets(v)),
    };
  },

  legalActions: () => [],
  act: () => null,
  isFinished: () => true,
  staked: (s) => s.bets.reduce((n, b) => n + b.amount, 0),

  settle(s) {
    const results: BetResult[] = s.bets.map((b) => {
      const returned = betReturn(b, s.pocket);
      return { spot: spotKey(b.kind, b.numbers), stake: b.amount, returned, outcome: outcomeOf(b.amount, returned) };
    });
    return { returned: results.reduce((n, r) => n + r.returned, 0), results };
  },

  view(s) {
    return {
      variant: s.variant,
      pocket: s.pocket,
      bets: s.bets.map((b) => ({ ...b, spot: spotKey(b.kind, b.numbers), returned: betReturn(b, s.pocket) })),
    };
  },

  summary(s) {
    return {
      pocket: pocketLabel(s.pocket),
      color: pocketColor(s.pocket),
      straightUp: s.bets.some((b) => b.kind === "straight" && b.numbers[0] === s.pocket),
      spots: s.bets.length,
    };
  },

  theoreticalRtp(variant) {
    return 36 / pockets(asVariant(variant));
  },
};
