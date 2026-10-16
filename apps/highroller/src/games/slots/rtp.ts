import { type Machine, ROWS, type SymbolId } from "./machines.js";
import { lineWin, symbolOf } from "./evaluate.js";

/**
 * A machine's exact return, by multiplying out the reel strips: no
 * simulation. The reels stop independently, so:
 *
 * - each line's expected pay is a sum over the symbols each reel can show in
 *   that line's row (at most ten a reel, so 10⁵ terms a line);
 * - the scatter count is a convolution of each reel's count in its window;
 * - free spins are `count` independent spins at the multiplier, which never
 *   retrigger, so they add P(trigger) × count × multiplier × one spin.
 *
 * The jackpot's odds come out the same way: for each reel, which rows show
 * the jackpot symbol, then whether any line passes through one on every reel.
 */
export interface MachineReturn {
  /** Per chip wagered, free spins included. */
  rtp: number;
  /** One spin's line pays per chip wagered. */
  lines: number;
  /** One spin's scatter pays per chip wagered. */
  scatter: number;
  /** What the free spins add per chip wagered. */
  freeSpins: number;
  /** Chance a spin starts free spins. */
  trigger: number;
  /** Chance a spin with every line bet shows five jackpot symbols on a line (free spins aside). */
  jackpot: number;
}

const cache = new Map<string, MachineReturn>();

/**
 * Whether a line's first `n` symbols already fix its pay: the run of wilds
 * has ended, and so has the run of the first other symbol (or it is one no
 * wild can extend).
 */
function decided(m: Machine, syms: readonly SymbolId[], n: number): boolean {
  let wilds = 0;
  while (wilds < n && symbolOf(m, syms[wilds]).kind === "wild") wilds++;
  if (wilds === n) return false;
  const target = syms[wilds];
  const kind = symbolOf(m, target).kind;
  if (kind === "scatter" || (kind === "jackpot" && wilds > 0)) return true;
  const subs = kind !== "jackpot";
  let run = 0;
  while (run < n && (syms[run] === target || (subs && symbolOf(m, syms[run]).kind === "wild"))) run++;
  return run < n;
}

/** Each stop's probability on a reel. */
function stopOdds(m: Machine, reel: number): number[] {
  const r = m.reels[reel];
  const w = r.weights ?? r.strip.map(() => 1);
  const total = w.reduce((s, x) => s + x, 0);
  return w.map((x) => x / total);
}

/** The symbol in row `row` of reel `reel`: its probability by symbol. */
function rowOdds(m: Machine, reel: number, row: number): [SymbolId, number][] {
  const strip = m.reels[reel].strip;
  const out = new Map<SymbolId, number>();
  stopOdds(m, reel).forEach((p, stop) => {
    const s = strip[(stop + row) % strip.length];
    out.set(s, (out.get(s) ?? 0) + p);
  });
  return [...out.entries()];
}

export function exactRtp(m: Machine, lines = m.lines.length): MachineReturn {
  const key = `${m.id}:${lines}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // Lines: in multiples of the line bet, averaged over the lines played.
  let linePays = 0;
  const syms: SymbolId[] = [];
  for (let l = 0; l < lines; l++) {
    const odds = m.lines[l].map((row, reel) => rowOdds(m, reel, row));
    const walk = (reel: number, p: number) => {
      for (const [s, q] of odds[reel]) {
        syms[reel] = s;
        // Once the line's runs have ended, the reels after can't change its pay.
        if (reel + 1 === odds.length || decided(m, syms, reel + 1)) linePays += p * q * (lineWin(m, syms.slice(0, reel + 1))?.pays ?? 0);
        else walk(reel + 1, p * q);
      }
    };
    walk(0, 1);
  }
  const lineRtp = linePays / lines;

  // Scatters: per reel, how many show in the window; then all reels together.
  const scatter = m.symbols.find((s) => s.kind === "scatter");
  let counts = [1];
  if (scatter) {
    for (let reel = 0; reel < m.reels.length; reel++) {
      const per = new Array(ROWS + 1).fill(0);
      const strip = m.reels[reel].strip;
      stopOdds(m, reel).forEach((p, stop) => {
        let n = 0;
        for (let r = 0; r < ROWS; r++) if (strip[(stop + r) % strip.length] === scatter.id) n++;
        per[n] += p;
      });
      const next = new Array(counts.length + ROWS).fill(0);
      counts.forEach((a, i) => per.forEach((b, j) => (next[i + j] += a * b)));
      counts = next;
    }
  }
  let scatterRtp = 0;
  let trigger = 0;
  counts.forEach((p, n) => {
    if (n < 3 || !scatter) return;
    scatterRtp += p * scatter.pays[Math.min(n, 5) - 3];
    trigger += p;
  });

  const spin = lineRtp + scatterRtp;
  const freeSpins = trigger * m.freeSpins.count * m.freeSpins.multiplier * spin;

  // The jackpot: per reel, the rows showing the jackpot symbol as a bitmask.
  const jackpotSym = m.symbols.find((s) => s.kind === "jackpot");
  let jackpot = 0;
  if (jackpotSym) {
    const masks = m.reels.map((reel, i) => {
      const by = new Map<number, number>();
      stopOdds(m, i).forEach((p, stop) => {
        let mask = 0;
        for (let r = 0; r < ROWS; r++) if (reel.strip[(stop + r) % reel.strip.length] === jackpotSym.id) mask |= 1 << r;
        by.set(mask, (by.get(mask) ?? 0) + p);
      });
      return [...by.entries()];
    });
    const chosen: number[] = [];
    const walk = (reel: number, p: number) => {
      if (reel === masks.length) {
        if (m.lines.some((line) => line.every((row, i) => chosen[i] & (1 << row)))) jackpot += p;
        return;
      }
      for (const [mask, q] of masks[reel]) {
        if (mask === 0) continue;
        chosen[reel] = mask;
        walk(reel + 1, p * q);
      }
    };
    walk(0, 1);
  }

  const out = { rtp: spin + freeSpins, lines: lineRtp, scatter: scatterRtp, freeSpins, trigger, jackpot };
  cache.set(key, out);
  return out;
}
