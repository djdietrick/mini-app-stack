import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seededRng } from "../rng.js";
import { simulate } from "../simulate.js";
import { SLOTS_LIMITS, type SlotsState, slots } from "./engine.js";
import { evaluateSpin, gridAt, lineWin } from "./evaluate.js";
import { CLASSIC, LINES_20, MACHINES, type Machine, type SymbolId } from "./machines.js";
import { exactRtp } from "./rtp.js";

const syms = (s: string) => s.split(" ") as SymbolId[];
const win = (s: string) => lineWin(CLASSIC, syms(s));

/** A machine whose reels are just the columns given: stop 0 shows each column, top to bottom. */
function fixed(columns: string[], base: Machine = CLASSIC): Machine {
  return { ...base, id: "fixed", reels: columns.map((c) => ({ strip: syms(c) })) };
}

describe("line evaluation", () => {
  it("pays 3, 4 or 5 in a row from the left", () => {
    assert.deepEqual(win("bell bell bell cherry lemon"), { symbol: "bell", count: 3, pays: 15 });
    assert.deepEqual(win("bell bell bell bell lemon"), { symbol: "bell", count: 4, pays: 50 });
    assert.deepEqual(win("seven seven seven seven seven"), { symbol: "seven", count: 5, pays: 1_000 });
    assert.equal(win("cherry bell bell bell bell"), null, "the run must start on the first reel");
    assert.equal(win("bell bell lemon bell bell"), null);
  });

  it("lets the wild stand in, anywhere in the run", () => {
    assert.deepEqual(win("wild bell bell lemon lemon"), { symbol: "bell", count: 3, pays: 15 });
    assert.deepEqual(win("bell wild wild bell cherry"), { symbol: "bell", count: 4, pays: 50 });
    assert.deepEqual(win("cherry wild cherry wild cherry"), { symbol: "cherry", count: 5, pays: 60 });
  });

  it("pays each line's best win only", () => {
    // Four wilds (500) against five sevens (1,000): the sevens.
    assert.deepEqual(win("wild wild wild wild seven"), { symbol: "seven", count: 5, pays: 1_000 });
    // Three wilds (100) against four cherries (20): the wilds.
    assert.deepEqual(win("wild wild wild cherry lemon"), { symbol: "wild", count: 3, pays: 100 });
    assert.deepEqual(win("wild wild wild wild wild"), { symbol: "wild", count: 5, pays: 2_500 });
  });

  it("never substitutes for the scatter or the jackpot symbol", () => {
    assert.equal(win("scatter scatter scatter lemon lemon"), null, "scatters pay as scatters, not on lines");
    assert.equal(win("wild scatter bell bell bell"), null);
    assert.equal(win("wild jackpot jackpot jackpot jackpot"), null);
    assert.deepEqual(win("jackpot jackpot jackpot wild cherry"), { symbol: "jackpot", count: 3, pays: 50 });
    assert.deepEqual(win("wild wild wild jackpot jackpot"), { symbol: "wild", count: 3, pays: 100 });
  });
});

describe("a spin", () => {
  const m = fixed([
    "bell scatter cherry",
    "bell lemon scatter",
    "bell wild plum",
    "seven lemon scatter",
    "orange lemon plum",
  ]);

  it("pays lines times the line bet and scatters times the total bet", () => {
    const r = evaluateSpin(m, [0, 0, 0, 0, 0], 5, 20);
    assert.deepEqual(gridAt(m, [0, 0, 0, 0, 0])[2], ["bell", "wild", "plum"]);
    // Line 2 (the top row): bell bell bell seven orange. Line 1 (the middle) starts on a scatter.
    const top = r.lineWins.find((w) => w.line === 1);
    assert.deepEqual(top, { line: 1, symbol: "bell", count: 3, pay: 15 * 5 });
    assert.equal(r.scatters, 3);
    assert.equal(r.scatterPay, 2 * 5 * 20);
    assert.equal(r.total, r.lineWins.reduce((s, w) => s + w.pay, 0) + 200);
  });

  it("only plays the lines bet", () => {
    const one = evaluateSpin(m, [0, 0, 0, 0, 0], 5, 1);
    assert.deepEqual(one.lineWins, [], "line 1 is the middle row, which pays nothing");
    assert.equal(one.scatterPay, 2 * 5, "scatters still pay, on the total bet");
  });

  it("starts 8 free spins at 2× on three scatters, drawn with the spin", () => {
    let found: SlotsState | null = null;
    const rng = seededRng(56);
    for (let i = 0; i < 5_000 && !found; i++) {
      const d = slots.deal({ lineBet: 5, lines: 20 }, rng, null);
      if (d.free.length) found = d;
    }
    assert.ok(found, "free spins within 5,000 spins");
    assert.equal(found.free.length, 8);
    const v = slots.view(found);
    assert.equal(v.spins.length, 9);
    assert.ok(v.spins[0].scatters >= 3);
    for (const fs of v.spins.slice(1)) {
      const plain = evaluateSpin(CLASSIC, fs.stops, 5, 20);
      assert.equal(fs.total, plain.total * 2, "free spins pay double");
    }
    assert.equal(slots.settle(found).returned, v.spins.reduce((n, r) => n + r.total, 0));
    assert.equal(slots.summary(found).freeSpins, true);
  });

  it("flags the jackpot only on five jackpot symbols with every line bet", () => {
    const jm = fixed(Array(5).fill("jackpot cherry lemon"));
    const state = (lines: number): SlotsState => ({ machine: "classic", lineBet: 1, lines, stops: [0, 0, 0, 0, 0], free: [] });
    // Swap the fixed reels in for the view: the engine looks machines up by id.
    const saved = MACHINES.classic;
    MACHINES.classic = jm;
    try {
      assert.equal(slots.view(state(20)).jackpotEligible, true);
      assert.equal(slots.view(state(20)).spins[0].lineWins.find((w) => w.line === 1)?.pay, 5_000);
      assert.equal(slots.view(state(19)).jackpotEligible, false);
      assert.equal(slots.summary(state(19)).jackpotEligible, false);
    } finally {
      MACHINES.classic = saved;
    }
  });

  it("settles in the deal, with stops on the strips", () => {
    const s = slots.deal({ lineBet: 25, lines: 10 }, seededRng(3), "classic");
    assert.ok(slots.isFinished(s));
    assert.deepEqual(slots.legalActions(s), []);
    assert.equal(slots.staked(s), 250);
    s.stops.forEach((stop, i) => assert.ok(stop >= 0 && stop < CLASSIC.reels[i].strip.length));
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  });

  it("validates line bets and lines", () => {
    const check = (lineBet: number, lines: number) => slots.validateBets({ lineBet, lines }, SLOTS_LIMITS, null);
    assert.equal(check(1, 20), null);
    assert.equal(check(100, 1), null);
    assert.match(check(2, 20)!, /line bets are 1, 5, 25, 100/);
    assert.match(check(5, 21)!, /1 to 20 lines/);
    assert.match(check(5, 0)!, /1 to 20 lines/);
  });
});

describe("the classic machine's return", () => {
  it("has 20 distinct lines and five reels of 32 stops", () => {
    assert.equal(new Set(LINES_20.map((l) => l.join())).size, 20);
    assert.deepEqual(CLASSIC.reels.map((r) => r.strip.length), [32, 32, 32, 32, 32]);
    for (const r of CLASSIC.reels) for (const s of r.strip) assert.ok(CLASSIC.symbols.some((x) => x.id === s), s);
  });

  it("lands between 94% and 96%, exactly", () => {
    const r = exactRtp(CLASSIC);
    assert.ok(r.rtp > 0.94 && r.rtp < 0.96, `rtp ${r.rtp}`);
    assert.ok(Math.abs(r.rtp - 0.94969) < 1e-5, `rtp ${r.rtp}`);
    assert.equal(slots.theoreticalRtp("classic"), r.rtp);
    assert.ok(Math.abs(r.freeSpins - r.trigger * 8 * 2 * (r.lines + r.scatter)) < 1e-12);
  });

  it("matches a brute force over every symbol on a line", () => {
    const line = CLASSIC.lines[0];
    const odds = line.map((row, reel) => {
      const strip = CLASSIC.reels[reel].strip;
      const by = new Map<SymbolId, number>();
      strip.forEach((_, stop) => by.set(strip[(stop + row) % strip.length], (by.get(strip[(stop + row) % strip.length]) ?? 0) + 1 / strip.length));
      return [...by.entries()];
    });
    let ev = 0;
    for (const [a, pa] of odds[0]) for (const [b, pb] of odds[1]) for (const [c, pc] of odds[2]) for (const [d, pd] of odds[3]) for (const [e, pe] of odds[4]) {
      ev += pa * pb * pc * pd * pe * (lineWin(CLASSIC, [a, b, c, d, e])?.pays ?? 0);
    }
    assert.ok(Math.abs(exactRtp(CLASSIC, 1).lines - ev) < 1e-12, `${exactRtp(CLASSIC, 1).lines} vs ${ev}`);
  });

  it("puts the jackpot line at 20 in 32⁵ spins, about 1 in 1.68 million", () => {
    // One jackpot symbol a reel: each row shows it 1 time in 32, and no two lines can both hold five.
    const { jackpot, trigger } = exactRtp(CLASSIC);
    assert.ok(Math.abs(jackpot - 20 / 32 ** 5) < 1e-15, `${jackpot}`);
    assert.equal(Math.round(1 / jackpot), 1_677_722);
    assert.ok(trigger > 1 / 150 && trigger < 1 / 130, `free spins 1 in ${1 / trigger}`);
  });

  it("and the engine pays what the sum says, by Monte Carlo", () => {
    const r = simulate(slots, { hands: 100_000, rng: seededRng(5600), bets: { lineBet: 1, lines: 20 }, strategy: () => ({ type: "none" }) });
    assert.ok(Math.abs(r.rtp - exactRtp(CLASSIC).rtp) < 4 * r.stdErr, `rtp ${r.rtp} ± ${r.stdErr}`);
  });
});
