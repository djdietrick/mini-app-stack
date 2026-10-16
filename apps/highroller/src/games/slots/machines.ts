/**
 * Slot machines as data (#56). A machine is its reels, its paylines and its
 * paytable; the engine (engine.ts) and the exact RTP (rtp.ts) read nothing
 * else, so a second machine is a new entry here and a test that its RTP
 * lands in range.
 *
 * - Five reels, three rows. A reel is a cyclic strip of symbols; a spin picks
 *   one stop per reel, each stop as likely as its weight (1 when `weights` is
 *   absent), and shows that symbol in the top row with the next two below.
 * - Lines pay left to right from the first reel: 3, 4 or 5 of a symbol in a
 *   row, times the line bet. The wild stands in for every symbol but the
 *   scatter and the jackpot symbol, and a run of wilds pays as itself; each
 *   line pays its best win only.
 * - Scatters pay anywhere on screen, times the total bet, and three or more
 *   start the free spins: drawn with the spin, paid with it, at the same bet
 *   and with a multiplier. Free spins don't retrigger.
 * - Five jackpot symbols on a line, with every line bet, win the progressive
 *   jackpot (#57) on top of the line's pay.
 */
export type SymbolId = string;

export interface SymbolDef {
  id: SymbolId;
  name: string;
  /** Pays for 3, 4 and 5 in a row, times the line bet (times the total bet for a scatter). */
  pays: [number, number, number];
  kind?: "wild" | "scatter" | "jackpot";
}

export interface Reel {
  strip: SymbolId[];
  /** Per stop; absent means every stop is equally likely. */
  weights?: number[];
}

export interface Machine {
  id: string;
  name: string;
  symbols: SymbolDef[];
  reels: Reel[];
  /** Per line, the row (0 top, 2 bottom) on each reel. */
  lines: number[][];
  freeSpins: { count: number; multiplier: number };
}

export const ROWS = 3;
export const LINE_BETS = [1, 5, 25, 100] as const;

/** The usual 20 lines, the middle row first. */
export const LINES_20: number[][] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2],
  [0, 2, 0, 2, 0],
];

/**
 * A strip from symbol counts, each symbol spread evenly round it: the k-th
 * of a symbol that appears n times sits near k/n of the way round, offset per
 * symbol so different symbols interleave instead of clumping. `turn` rotates
 * the result, so reels built from the same counts don't line up.
 */
export function spread(counts: Record<SymbolId, number>, turn = 0): SymbolId[] {
  const slots: { id: SymbolId; at: number }[] = [];
  Object.entries(counts).forEach(([id, n], j) => {
    // The golden ratio's fractions keep the offsets apart for any number of symbols.
    const offset = (j * 0.618034) % 1;
    for (let k = 0; k < n; k++) slots.push({ id, at: (k + offset) / n });
  });
  const out = slots.sort((a, b) => a.at - b.at).map((x) => x.id);
  const t = ((turn % out.length) + out.length) % out.length;
  return [...out.slice(t), ...out.slice(0, t)];
}

const CLASSIC_SYMBOLS: SymbolDef[] = [
  { id: "cherry", name: "Cherry", pays: [5, 20, 60] },
  { id: "lemon", name: "Lemon", pays: [5, 20, 80] },
  { id: "orange", name: "Orange", pays: [10, 30, 100] },
  { id: "plum", name: "Plum", pays: [10, 35, 125] },
  { id: "bell", name: "Bell", pays: [15, 50, 200] },
  { id: "bar", name: "Bar", pays: [25, 100, 400] },
  { id: "seven", name: "Seven", pays: [50, 200, 1_000] },
  { id: "wild", name: "Wild", pays: [100, 500, 2_500], kind: "wild" },
  { id: "jackpot", name: "Jackpot", pays: [50, 250, 5_000], kind: "jackpot" },
  { id: "scatter", name: "Diamond", pays: [2, 10, 50], kind: "scatter" },
];

/**
 * Symbol counts per reel, 32 stops each: the middle reels carry a second
 * wild. Exact return 94.97% (35% of it from free spins and scatters), a win
 * on 62% of spins (most of them less than the bet), free spins 1 in 140 and
 * the jackpot line 1 in 1.68 million spins (slots.test.ts checks all of it).
 */
const CLASSIC_COUNTS: Record<SymbolId, number>[] = [
  { cherry: 7, lemon: 6, orange: 5, plum: 5, bell: 3, bar: 2, seven: 1, wild: 1, jackpot: 1, scatter: 1 },
  { cherry: 7, lemon: 6, orange: 5, plum: 4, bell: 3, bar: 2, seven: 1, wild: 2, jackpot: 1, scatter: 1 },
  { cherry: 7, lemon: 6, orange: 5, plum: 4, bell: 3, bar: 2, seven: 1, wild: 2, jackpot: 1, scatter: 1 },
  { cherry: 7, lemon: 6, orange: 5, plum: 4, bell: 3, bar: 2, seven: 1, wild: 2, jackpot: 1, scatter: 1 },
  { cherry: 7, lemon: 6, orange: 5, plum: 5, bell: 3, bar: 2, seven: 1, wild: 1, jackpot: 1, scatter: 1 },
];

export const CLASSIC: Machine = {
  id: "classic",
  name: "Fruit Classic",
  symbols: CLASSIC_SYMBOLS,
  reels: CLASSIC_COUNTS.map((c, i) => ({ strip: spread(c, i * 7) })),
  lines: LINES_20,
  freeSpins: { count: 8, multiplier: 2 },
};

export const MACHINES: Record<string, Machine> = { classic: CLASSIC };
export const MACHINE_IDS = Object.keys(MACHINES);
