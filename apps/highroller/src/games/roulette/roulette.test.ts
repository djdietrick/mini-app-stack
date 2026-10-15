import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Rng } from "../rng.js";
import {
  type BetKind,
  DOUBLE_ZERO,
  PAYS,
  ROULETTE_LIMITS,
  type RouletteBet,
  VARIANTS,
  betFromKey,
  betReturn,
  pocketColor,
  roulette,
  spotKey,
  validBets,
} from "./engine.js";
import { BAND, FELT, anchorOf, hitTest } from "./felt.js";

const landOn = (pocket: number): Rng => ({ int: () => pocket });
const bet = (kind: BetKind, numbers: number[], amount = 10): RouletteBet => ({ kind, numbers, amount });
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("roulette layout", () => {
  it("has the standard number of spots of each kind", () => {
    const count = (v: (typeof VARIANTS)[number], k: BetKind) => validBets(v).filter((b) => b.kind === k).length;
    // 57 splits inside 1–36, plus the ones on zero.
    assert.equal(count("european", "straight"), 37);
    assert.equal(count("european", "split"), 60);
    assert.equal(count("american", "split"), 62);
    assert.equal(count("european", "street"), 14);
    assert.equal(count("american", "street"), 15);
    assert.equal(count("european", "corner"), 23);
    assert.equal(count("american", "corner"), 22);
    assert.equal(count("european", "sixline"), 11);
    assert.equal(count("american", "topline"), 1);
    assert.equal(count("european", "topline"), 0);
    assert.equal(count("american", "straight"), 38);
  });

  it("turns every spot key back into its bet", () => {
    for (const variant of VARIANTS) {
      for (const b of validBets(variant)) assert.deepEqual(betFromKey(spotKey(b.kind, b.numbers)), b);
    }
  });
});

describe("roulette RTP, exactly", () => {
  for (const variant of VARIANTS) {
    it(`returns 36/${variant === "american" ? 38 : 37} on every ${variant} bet but the top line`, () => {
      const pockets = variant === "american" ? 38 : 37;
      for (const b of validBets(variant)) {
        let back = 0;
        for (let p = 0; p < pockets; p++) back += betReturn({ ...b, amount: 1 }, p);
        const expected = b.kind === "topline" ? 35 : 36;
        assert.equal(back, expected, `${spotKey(b.kind, b.numbers)} returns ${back}/${pockets}`);
        assert.equal(b.numbers.length * (PAYS[b.kind] + 1), expected);
      }
      assert.equal(roulette.theoreticalRtp(variant), 36 / pockets);
    });
  }
});

describe("roulette spins", () => {
  it("settles in the deal: the spin is the hand", () => {
    const bets = [bet("straight", [17], 10), bet("red", range(1, 36).filter((n) => [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(n)), 20), bet("split", [17, 20], 5)];
    const s = roulette.deal(bets, landOn(17), "european");
    assert.ok(roulette.isFinished(s));
    assert.deepEqual(roulette.legalActions(s), []);
    assert.equal(roulette.staked(s), 35);
    const settled = roulette.settle(s);
    assert.deepEqual(settled.results.map((r) => [r.spot, r.returned]), [["straight:17", 360], ["red", 0], ["split:17-20", 90]]);
    assert.equal(settled.returned, 450);
    assert.deepEqual(roulette.summary(s), { pocket: "17", color: "black", straightUp: true, spots: 3 });
  });

  it("draws 0–36 on a European wheel and 0–37 (00) on an American one", () => {
    const max = (variant: string) => {
      let seen = 0;
      roulette.deal([bet("straight", [1])], { int: (n) => ((seen = n), n - 1) }, variant);
      return seen;
    };
    assert.equal(max("european"), 37);
    assert.equal(max("american"), 38);
    const s = roulette.deal([bet("straight", [DOUBLE_ZERO])], landOn(DOUBLE_ZERO), "american");
    assert.equal(roulette.settle(s).returned, 360);
    assert.equal(roulette.summary(s).pocket, "00");
    assert.equal(pocketColor(DOUBLE_ZERO), "green");
  });

  it("checks each bet by kind and the numbers it covers", () => {
    const check = (bets: RouletteBet[], variant = "european") => roulette.validateBets(bets, ROULETTE_LIMITS, variant);
    assert.equal(check([bet("split", [2, 1]), bet("corner", [5, 1, 4, 2]), bet("dozen", range(13, 24))]), null);
    assert.match(check([bet("split", [1, 5])])!, /not a bet/);
    assert.match(check([bet("street", [1, 2, 4])])!, /not a bet/);
    assert.match(check([bet("straight", [DOUBLE_ZERO])])!, /not a bet/, "no 00 on a European wheel");
    assert.match(check([bet("topline", [0, DOUBLE_ZERO, 1, 2, 3])])!, /not a bet/);
    assert.equal(check([bet("topline", [0, DOUBLE_ZERO, 1, 2, 3])], "american"), null);
    // The key alone doesn't make a bet: "red" with the black numbers is refused.
    assert.match(check([bet("red", [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35])])!, /not a bet/);
    assert.match(check([bet("dozen", [1, ...range(14, 24)])])!, /not a bet/);
    assert.match(check([bet("straight", [7]), bet("straight", [7])])!, /two bets/);
    assert.match(check([bet("straight", [7], 3)])!, /minimum/);
    assert.match(check([bet("straight", [7], 1005)])!, /maximum/);
    assert.match(check(range(1, 11).map((n) => bet("straight", [n], 1000)))!, /table maximum/);
    assert.match(check([])!, /place a bet/);
  });
});

describe("roulette felt", () => {
  for (const variant of VARIANTS) {
    it(`puts every ${variant} bet under a thumb: its anchor and a square around it hit that bet`, () => {
      const r = BAND - 1;
      for (const b of validBets(variant)) {
        const a = anchorOf(variant, b);
        const key = spotKey(b.kind, b.numbers);
        for (const [dx, dy] of [[0, 0], [-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [r, r], [-r, r], [r, -r]]) {
          const hit = hitTest(variant, a.x + dx, a.y + dy);
          assert.ok(hit, `${key} at ${dx},${dy}`);
          assert.equal(spotKey(hit.kind, hit.numbers), key, `tap ${dx},${dy} from ${key}`);
        }
      }
    });

    it(`only ever hits legal ${variant} bets`, () => {
      const legal = new Set(validBets(variant).map((b) => spotKey(b.kind, b.numbers)));
      const hits = new Set<string>();
      for (let x = 0; x < FELT.width; x += 1.5) {
        for (let y = 0; y < FELT.height; y += 1.5) {
          const hit = hitTest(variant, x, y);
          if (!hit) continue;
          const key = spotKey(hit.kind, hit.numbers);
          assert.ok(legal.has(key), `${key} at ${x},${y}`);
          const valid = roulette.validateBets([{ ...hit, amount: 10 }], ROULETTE_LIMITS, variant);
          assert.equal(valid, null, key);
          hits.add(key);
        }
      }
      assert.equal(hits.size, legal.size, "every bet is reachable");
    });
  }
});
