import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Card } from "../cards.js";
import { seededRng } from "../rng.js";
import { simulate } from "../simulate.js";
import {
  BACCARAT_LIMITS,
  BANKER_DRAWS,
  type BaccaratBets,
  P_BANKER,
  P_PLAYER,
  P_TIE,
  SPOT_RTP,
  type Spot,
  baccarat,
  dealFrom,
  expectedSpotReturn,
  playCoup,
  pointOf,
  spotReturn,
} from "./engine.js";

/** A stacked shoe, dealt Player, Banker, Player, Banker, then third cards. */
const stack = (cards: string, bets: BaccaratBets = { player: 10 }) => dealFrom(cards.split(" ") as Card[], bets);

describe("baccarat cards", () => {
  it("counts aces 1, tens and court cards 0", () => {
    assert.deepEqual(["Ac", "2d", "9h", "Ts", "Jc", "Qd", "Kh"].map((c) => pointOf(c as Card)), [1, 2, 9, 0, 0, 0, 0]);
  });
});

describe("the third-card tableau", () => {
  /** Banker's total (rows) against Player's third card 0–9 (columns): D draws, S stands. The printed chart. */
  const CHART: Record<number, string> = {
    0: "DDDDDDDDDD",
    1: "DDDDDDDDDD",
    2: "DDDDDDDDDD",
    3: "DDDDDDDDSD",
    4: "SSDDDDDDSS",
    5: "SSSSDDDDSS",
    6: "SSSSSSDDSS",
    7: "SSSSSSSSSS",
  };

  it("matches the printed chart, cell by cell", () => {
    for (const [total, row] of Object.entries(CHART)) {
      for (let p3 = 0; p3 <= 9; p3++) {
        assert.equal(BANKER_DRAWS[Number(total)].includes(p3), row[p3] === "D", `banker ${total} vs a third card of ${p3}`);
      }
    }
  });

  it("plays each case: naturals, Player standing, Player drawing", () => {
    // Values in deal order: P1 B1 P2 B2 then the next cards.
    const cases: [number[], number, number, string][] = [
      [[4, 5, 4, 3, 0, 0], 2, 2, "Player's natural 8: both stand"],
      [[1, 4, 2, 5, 0, 0], 2, 2, "Banker's natural 9: both stand"],
      [[3, 2, 3, 2, 0, 0], 2, 3, "Player stands on 6; Banker draws on 4"],
      [[3, 3, 4, 3, 0, 0], 2, 2, "Player stands on 7; Banker stands on 6"],
      [[2, 1, 3, 2, 8, 0], 3, 2, "Banker 3 stands on Player's third 8"],
      [[2, 1, 3, 2, 9, 0], 3, 3, "Banker 3 draws on Player's third 9"],
      [[2, 3, 3, 3, 1, 0], 3, 2, "Banker 6 stands on Player's third 1"],
      [[2, 3, 3, 3, 7, 0], 3, 3, "Banker 6 draws on Player's third 7"],
      [[2, 3, 0, 4, 4, 0], 3, 2, "Banker 7 always stands"],
    ];
    for (const [points, player, banker, why] of cases) assert.deepEqual(playCoup(points), { player, banker }, why);
  });

  it("deals third cards in order: Player's, then Banker's", () => {
    const s = stack("2c 3d 3h 3s 7c 9d");
    assert.deepEqual(s.player, ["2c", "3h", "7c"]);
    assert.deepEqual(s.banker, ["3d", "3s", "9d"]);
    const v = baccarat.view(s);
    assert.equal(v.playerTotal, 2);
    assert.equal(v.bankerTotal, 5);
    assert.equal(v.winner, "banker");
    // Player stood on 7: Banker's third card is the fifth.
    assert.deepEqual(stack("3c 2d 4h 3s 8c 9d").banker, ["2d", "3s", "8c"]);
  });
});

describe("baccarat payouts", () => {
  it("pays Player 1:1, Banker 1:1 less 5% rounded down, Tie 8:1", () => {
    assert.equal(spotReturn("player", 100, "player"), 200);
    assert.equal(spotReturn("banker", 100, "banker"), 195);
    assert.equal(spotReturn("banker", 10, "banker"), 19, "9.5 rounds down to 9");
    assert.equal(spotReturn("banker", 15, "banker"), 29, "14.25 rounds down to 14");
    assert.equal(spotReturn("tie", 10, "tie"), 90);
    assert.equal(spotReturn("player", 10, "banker"), 0);
    assert.equal(spotReturn("tie", 10, "player"), 0);
  });

  it("pushes Player and Banker on a tie", () => {
    // 9 against 9: two naturals that tie.
    const fixed = stack("Tc 9d 9h Ts 2c 2c", { player: 10, banker: 20, tie: 5 });
    const settled = baccarat.settle(fixed);
    assert.deepEqual(settled.results.map((r) => [r.spot, r.returned, r.outcome]), [["player", 10, "push"], ["banker", 20, "push"], ["tie", 45, "win"]]);
    assert.equal(settled.returned, 75);
    assert.deepEqual(baccarat.summary(fixed), { winner: "tie", natural: true, playerTotal: 9, bankerTotal: 9, total: 9, tieWon: true, backedWinner: false });
  });

  it("settles on the deal", () => {
    const s = baccarat.deal({ banker: 50 }, seededRng(53), null);
    assert.ok(baccarat.isFinished(s));
    assert.deepEqual(baccarat.legalActions(s), []);
    assert.equal(baccarat.staked(s), 50);
    assert.ok(s.player.length >= 2 && s.player.length <= 3 && s.banker.length >= 2 && s.banker.length <= 3);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  });

  it("validates the bets", () => {
    const check = (b: object) => baccarat.validateBets(b, BACCARAT_LIMITS, null);
    assert.equal(check({ player: 10 }), null);
    assert.equal(check({ banker: 5_000, tie: 10 }), null);
    assert.match(check({})!, /place a bet/);
    assert.match(check({ tie: 5 })!, /minimum/);
    assert.match(check({ player: 5_005 })!, /maximum/);
    assert.match(check({ player: 12 })!, /steps of 5/);
  });
});

describe("baccarat house edge", () => {
  it("has the exact eight-deck probabilities, from every sequence of cards", () => {
    // Card values with eight decks: 128 zeros, 32 of each of 1–9.
    const counts = [128, 32, 32, 32, 32, 32, 32, 32, 32, 32];
    const p = { player: 0, banker: 0, tie: 0 };
    const seq: number[] = [];
    const rec = (prob: number, left: number) => {
      if (seq.length === 6) {
        const n = playCoup(seq);
        const pt = (seq[0] + seq[2] + (n.player === 3 ? seq[4] : 0)) % 10;
        const bt = (seq[1] + seq[3] + (n.banker === 3 ? seq[n.player === 3 ? 5 : 4] : 0)) % 10;
        p[pt > bt ? "player" : bt > pt ? "banker" : "tie"] += prob;
        return;
      }
      for (let v = 0; v < 10; v++) {
        if (!counts[v]) continue;
        const next = (prob * counts[v]) / left;
        counts[v]--;
        seq.push(v);
        rec(next, left - 1);
        seq.pop();
        counts[v]++;
      }
    };
    rec(1, 416);
    assert.ok(Math.abs(p.player - P_PLAYER) < 1e-10, `player ${p.player}`);
    assert.ok(Math.abs(p.banker - P_BANKER) < 1e-10, `banker ${p.banker}`);
    assert.ok(Math.abs(p.tie - P_TIE) < 1e-10, `tie ${p.tie}`);
    // The published edges: Player 1.24%, Banker 1.06%, Tie 14.36%.
    assert.ok(Math.abs(1 - SPOT_RTP.player - 0.012351) < 1e-6);
    assert.ok(Math.abs(1 - SPOT_RTP.banker - 0.010579) < 1e-6);
    assert.ok(Math.abs(1 - SPOT_RTP.tie - 0.143596) < 1e-6);
  });

  it("counts the commission's rounding in the expected return", () => {
    assert.ok(Math.abs(expectedSpotReturn("banker", 100) - 100 * SPOT_RTP.banker) < 1e-9);
    // On 10, a win pays 9, not 9.5.
    assert.ok(Math.abs(expectedSpotReturn("banker", 10) - (P_BANKER * 19 + P_TIE * 10)) < 1e-9);
    assert.ok(expectedSpotReturn("banker", 10) < 10 * SPOT_RTP.banker);
  });

  for (const [spot, stake] of [["player", 10], ["banker", 100], ["tie", 10]] as [Spot, number][]) {
    it(`measures the ${spot} edge within tolerance`, () => {
      const r = simulate(baccarat, { hands: 300_000, rng: seededRng(5300 + stake), bets: { [spot]: stake }, strategy: () => ({ type: "none" }) });
      const expected = expectedSpotReturn(spot, stake) / stake;
      assert.ok(Math.abs(r.rtp - expected) < 4 * r.stdErr, `${spot}: rtp ${r.rtp} ± ${r.stdErr}, expected ${expected}`);
    });
  }
});
