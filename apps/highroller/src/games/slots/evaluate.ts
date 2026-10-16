import type { Rng } from "../rng.js";
import { MACHINES, MACHINE_IDS, type Machine, ROWS, type SymbolDef, type SymbolId } from "./machines.js";

/**
 * What a spin shows and pays, for any machine (machines.ts). Pure: the
 * engine settles with it, rtp.ts multiplies it out, and the SPA draws with it.
 */
export interface LineWin {
  /** 0-based, into the machine's lines. */
  line: number;
  symbol: SymbolId;
  count: number;
  /** Chips, the free-spin multiplier included. */
  pay: number;
}

export interface SpinResult {
  stops: number[];
  /** By reel, then row: grid[reel][row]. */
  grid: SymbolId[][];
  lineWins: LineWin[];
  scatters: number;
  scatterPay: number;
  /** Line wins plus the scatter pay. */
  total: number;
  /** Five jackpot symbols on a line bet. */
  jackpotLine: boolean;
}

export const machineOf = (variant: string | null): Machine => MACHINES[variant ?? ""] ?? MACHINES[MACHINE_IDS[0]];

/** A machine's symbols by id, built once: line evaluation runs in every simulated spin. */
interface Compiled {
  byId: Map<SymbolId, SymbolDef>;
  scatter: SymbolId | null;
  jackpot: SymbolId | null;
}

const compiledCache = new WeakMap<Machine, Compiled>();

function compiled(m: Machine): Compiled {
  let c = compiledCache.get(m);
  if (!c) {
    c = {
      byId: new Map(m.symbols.map((s) => [s.id, s])),
      scatter: m.symbols.find((s) => s.kind === "scatter")?.id ?? null,
      jackpot: m.symbols.find((s) => s.kind === "jackpot")?.id ?? null,
    };
    compiledCache.set(m, c);
  }
  return c;
}

export function symbolOf(m: Machine, id: SymbolId): SymbolDef {
  const s = compiled(m).byId.get(id);
  if (!s) throw new Error(`no symbol ${id} on ${m.id}`);
  return s;
}

/** The three symbols a reel shows at a stop, top to bottom. */
export function windowAt(m: Machine, reel: number, stop: number): SymbolId[] {
  const strip = m.reels[reel].strip;
  return Array.from({ length: ROWS }, (_, r) => strip[(stop + r) % strip.length]);
}

export const gridAt = (m: Machine, stops: readonly number[]) => stops.map((s, i) => windowAt(m, i, s));

/**
 * One line's best win, in multiples of the line bet: a run of wilds paying
 * as itself, or the first other symbol with the wilds before and among it.
 * The wild doesn't stand in for the jackpot symbol or the scatter, and a
 * scatter ends a line.
 */
export function lineWin(m: Machine, symbols: readonly SymbolId[]): { symbol: SymbolId; count: number; pays: number } | null {
  const { byId } = compiled(m);
  const n = symbols.length;
  let wilds = 0;
  while (wilds < n && byId.get(symbols[wilds])!.kind === "wild") wilds++;
  let best: { symbol: SymbolId; count: number; pays: number } | null = null;
  if (wilds >= 3) {
    const pays = byId.get(symbols[0])!.pays[wilds - 3];
    if (pays > 0) best = { symbol: symbols[0], count: wilds, pays };
  }
  if (wilds < n) {
    const target = byId.get(symbols[wilds])!;
    const subs = target.kind !== "jackpot";
    if (target.kind !== "scatter" && (subs || wilds === 0)) {
      let count = 0;
      while (count < n && (symbols[count] === target.id || (subs && byId.get(symbols[count])!.kind === "wild"))) count++;
      const pays = count >= 3 ? target.pays[count - 3] : 0;
      if (pays > 0 && (!best || pays > best.pays)) best = { symbol: target.id, count, pays };
    }
  }
  return best;
}

/** The symbols under one line. */
export const lineSymbols = (m: Machine, grid: SymbolId[][], line: number) => m.lines[line].map((row, reel) => grid[reel][row]);

/** Every win of one spin on the first `lines` lines, at `lineBet` a line, times `multiplier`. */
export function evaluateSpin(m: Machine, stops: readonly number[], lineBet: number, lines: number, multiplier = 1): SpinResult {
  const { scatter, jackpot, byId } = compiled(m);
  const grid = gridAt(m, stops);
  const lineWins: LineWin[] = [];
  let jackpotLine = false;
  for (let l = 0; l < lines; l++) {
    const syms = lineSymbols(m, grid, l);
    const w = lineWin(m, syms);
    if (w) lineWins.push({ line: l, symbol: w.symbol, count: w.count, pay: w.pays * lineBet * multiplier });
    if (jackpot !== null && syms.every((s) => s === jackpot)) jackpotLine = true;
  }
  let scatters = 0;
  for (const col of grid) for (const s of col) if (s === scatter) scatters++;
  const scatterPay = scatter !== null && scatters >= 3 ? byId.get(scatter)!.pays[Math.min(scatters, 5) - 3] * lineBet * lines * multiplier : 0;
  return {
    stops: [...stops],
    grid,
    lineWins,
    scatters,
    scatterPay,
    total: lineWins.reduce((s, w) => s + w.pay, 0) + scatterPay,
    jackpotLine,
  };
}

/** A stop on each reel, each as likely as its weight. */
export function drawStops(m: Machine, rng: Rng): number[] {
  return m.reels.map((reel) => {
    if (!reel.weights) return rng.int(reel.strip.length);
    const total = reel.weights.reduce((s, w) => s + w, 0);
    let x = rng.int(total);
    for (let i = 0; i < reel.weights.length; i++) {
      x -= reel.weights[i];
      if (x < 0) return i;
    }
    return reel.weights.length - 1;
  });
}
