import type { GameEngine, TableLimits } from "../engine.js";
import { type SpinResult, drawStops, evaluateSpin, machineOf } from "./evaluate.js";
import { LINE_BETS, MACHINE_IDS } from "./machines.js";
import { exactRtp } from "./rtp.js";

/**
 * Slots (#56). A single-decision game: the bet is a line bet on the first
 * `lines` paylines, the stops are drawn in `deal`, and the hand settles in
 * the transaction that takes the bet. When the spin starts free spins, they
 * are drawn in `deal` too and paid with it, so it stays one hand.
 *
 * The machine is the variant (machines.ts): the rules live there as data.
 */
export const SLOTS_LIMITS: TableLimits = { min: 1, max: 100, step: 1 };

export interface SlotsBets {
  lineBet: number;
  lines: number;
}

export interface SlotsState {
  machine: string;
  lineBet: number;
  lines: number;
  /** One stop per reel: the strip index shown in the top row. */
  stops: number[];
  /** The free spins' stops, empty when none were won. */
  free: number[][];
}

export interface SlotsView {
  machine: string;
  lineBet: number;
  lines: number;
  /** The paid spin, then any free spins. */
  spins: SpinResult[];
  /** Chips back: every spin together. */
  returned: number;
  freeSpins: boolean;
  /** Five jackpot symbols on a line with every line bet (#57 pays it). */
  jackpotEligible: boolean;
}

const FREE_AT = 3;

function spins(s: SlotsState): SpinResult[] {
  const m = machineOf(s.machine);
  return [
    evaluateSpin(m, s.stops, s.lineBet, s.lines),
    ...s.free.map((stops) => evaluateSpin(m, stops, s.lineBet, s.lines, m.freeSpins.multiplier)),
  ];
}

const jackpotEligible = (s: SlotsState, results: SpinResult[]) =>
  s.lines === machineOf(s.machine).lines.length && results.some((r) => r.jackpotLine);

export const slots: GameEngine<SlotsBets, SlotsState, { type: string }, SlotsView> = {
  variants: MACHINE_IDS,

  validateBets(bets, _limits, variant) {
    const m = machineOf(variant);
    if (!(LINE_BETS as readonly number[]).includes(bets.lineBet)) return `line bets are ${LINE_BETS.join(", ")}`;
    if (!Number.isInteger(bets.lines) || bets.lines < 1 || bets.lines > m.lines.length) return `play 1 to ${m.lines.length} lines`;
    return null;
  },

  deal(bets, rng, variant) {
    const m = machineOf(variant);
    const stops = drawStops(m, rng);
    const base = evaluateSpin(m, stops, bets.lineBet, bets.lines);
    const free = base.scatters >= FREE_AT ? Array.from({ length: m.freeSpins.count }, () => drawStops(m, rng)) : [];
    return { machine: m.id, lineBet: bets.lineBet, lines: bets.lines, stops, free };
  },

  legalActions: () => [],
  act: () => null,
  isFinished: () => true,
  staked: (s) => s.lineBet * s.lines,

  expectedReturn(s) {
    return s.lineBet * s.lines * exactRtp(machineOf(s.machine), s.lines).rtp;
  },

  settle(s) {
    const returned = spins(s).reduce((n, r) => n + r.total, 0);
    const stake = s.lineBet * s.lines;
    return { returned, results: [{ spot: "spin", stake, returned, outcome: returned > stake ? "win" : returned < stake ? "loss" : "push" }] };
  },

  view(s) {
    const results = spins(s);
    return {
      machine: s.machine,
      lineBet: s.lineBet,
      lines: s.lines,
      spins: results,
      returned: results.reduce((n, r) => n + r.total, 0),
      freeSpins: s.free.length > 0,
      jackpotEligible: jackpotEligible(s, results),
    };
  },

  summary(s) {
    const results = spins(s);
    const returned = results.reduce((n, r) => n + r.total, 0);
    return {
      freeSpins: s.free.length > 0,
      multiple: Math.floor((returned / (s.lineBet * s.lines)) * 100) / 100,
      fiveOfAKind: results.some((r) => r.lineWins.some((w) => w.count === 5)),
      lines: s.lines,
      jackpotEligible: jackpotEligible(s, results),
    };
  },

  /** Per machine, exact (rtp.ts). Line pays are whole multiples of the line bet, so nothing rounds. */
  theoreticalRtp(variant) {
    return exactRtp(machineOf(variant)).rtp;
  },
};
