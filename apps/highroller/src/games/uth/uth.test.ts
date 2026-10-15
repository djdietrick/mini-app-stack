import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Card } from "../cards.js";
import { seededRng } from "../rng.js";
import { simulate } from "../simulate.js";
import { HOUSE_EDGE_PER_ANTE, UTH_LIMITS, type UthState, WAGER_PER_ANTE, dealFrom, uth } from "./engine.js";
import { SIMPLE_STRATEGY_EDGE, simpleStrategy } from "./strategy.js";

/** Nine stacked cards: yours, the dealer's, then the board. */
const stack = (you: string, dealer: string, board: string, ante = 10) =>
  dealFrom([...you.split(" "), ...dealer.split(" "), ...board.split(" ")] as Card[], { ante });

function play(s: UthState, ...types: string[]): UthState {
  for (const type of types) {
    const next = uth.act(s, { type } as never);
    assert.ok(next, `${type} should be legal on the ${s.street}`);
    s = next;
  }
  return s;
}

const spots = (s: UthState) => Object.fromEntries(uth.settle(s).results.map((r) => [r.spot, r.returned]));
const BOARD = "2h 7s 9c Jd 3h";

describe("UTH streets", () => {
  it("offers 4× or 3× before the flop, 2× after it, 1× or fold after the river", () => {
    let s = stack("Ac Kd", "Qc 8d", BOARD);
    assert.deepEqual(uth.legalActions(s), ["check", "bet4", "bet3"]);
    assert.equal(uth.act(s, { type: "bet2" }), null);
    assert.deepEqual(uth.view(s).board, []);
    s = play(s, "check");
    assert.deepEqual(uth.legalActions(s), ["check", "bet2"]);
    assert.deepEqual(uth.view(s).board, ["2h", "7s", "9c"]);
    s = play(s, "check");
    assert.deepEqual(uth.legalActions(s), ["fold", "bet1"]);
    assert.equal(uth.view(s).board.length, 5);
    assert.deepEqual(uth.view(s).dealer, [null, null], "the dealer's cards stay down");
    assert.equal(uth.view(s).showdown, null);
  });

  it("sizes the Play bet by street and goes straight to the showdown", () => {
    const at = (types: string[]) => play(stack("Ac Kd", "Qc 8d", BOARD), ...types);
    assert.equal(uth.staked(at(["bet4"])), 20 + 40);
    assert.equal(uth.staked(at(["bet3"])), 20 + 30);
    assert.equal(uth.staked(at(["check", "bet2"])), 20 + 20);
    assert.equal(uth.staked(at(["check", "check", "bet1"])), 20 + 10);
    for (const s of [at(["bet4"]), at(["check", "bet2"])]) {
      assert.ok(uth.isFinished(s));
      assert.deepEqual(uth.legalActions(s), []);
      assert.deepEqual(uth.view(s).dealer, ["Qc", "8d"]);
    }
  });

  it("loses Ante and Blind on a fold", () => {
    const s = play(stack("7c 2d", "Qc 8d", BOARD), "check", "check", "fold");
    assert.deepEqual(spots(s), { ante: 0, blind: 0 });
    assert.equal(uth.staked(s), 20);
    assert.equal(uth.view(s).showdown?.winner, null);
  });
});

describe("UTH settlement", () => {
  it("pays Ante and Play 1:1 on a win against a qualifying dealer; Blind pushes under a straight", () => {
    const s = play(stack("Ac Ad", "Kc Kd", BOARD), "bet4");
    assert.deepEqual(spots(s), { ante: 20, blind: 10, play: 80 });
    assert.equal(uth.view(s).showdown?.player.label, "Pair of aces");
    assert.equal(uth.view(s).showdown?.dealer.label, "Pair of kings");
  });

  it("pushes the Ante when the dealer doesn't qualify", () => {
    assert.deepEqual(spots(play(stack("Ac Kd", "Qc 8d", BOARD), "check", "check", "bet1")), { ante: 10, blind: 10, play: 20 });
    // The dealer wins with queen high but doesn't open: the Ante still pushes.
    assert.deepEqual(spots(play(stack("Tc 5d", "Qc 4d", BOARD), "check", "check", "bet1")), { ante: 10, blind: 0, play: 0 });
  });

  it("loses everything to a qualifying dealer", () => {
    assert.deepEqual(spots(play(stack("Ac Kd", "9h 9d", BOARD), "bet4")), { ante: 0, blind: 0, play: 0 });
  });

  it("pushes everything on a tie", () => {
    const s = play(stack("2c 3d", "4c 5d", "As Ks Qd Jh Tc"), "check", "check", "bet1");
    assert.deepEqual(spots(s), { ante: 10, blind: 10, play: 10 });
    assert.equal(uth.view(s).showdown?.winner, "tie");
  });

  it("pays the Blind by the paytable, rounding 3:2 down", () => {
    const blind = (you: string, board: string, ante = 10) => spots(play(stack(you, "4c 4d", board, ante), "bet4")).blind;
    assert.equal(blind("As Ks", "Qs Js Ts 2d 3c"), 10 + 5000, "royal flush 500:1");
    assert.equal(blind("9s 8s", "7s 6s 5s 2d 3c"), 10 + 500, "straight flush 50:1");
    assert.equal(blind("9s 9h", "9d 9c 5s 2d 3c"), 10 + 100, "quads 10:1");
    assert.equal(blind("9s 9h", "9d 5c 5s 2d Kc"), 10 + 30, "full house 3:1");
    assert.equal(blind("Ah 9h", "2h 5h Kh 7c 8d", 15), 15 + 22, "flush 3:2, rounded down");
    assert.equal(blind("Ah 9h", "Th Jc Qd Kc 8d"), 20, "straight 1:1");
    assert.equal(blind("Ah Ad", "Th Jc 2d Kc 8d"), 10, "a pair pushes");
  });

  it("keeps nine cards and hides the dealer's and the board's until shown", () => {
    const s = uth.deal({ ante: 10 }, seededRng(1), null);
    assert.equal(new Set([...s.player, ...s.dealer, ...s.board]).size, 9);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    const shown = JSON.stringify(uth.view(s));
    for (const c of [...s.dealer, ...s.board]) assert.ok(!shown.includes(c), `${c} leaked`);
  });

  it("reports facts for quests", () => {
    const f = uth.summary(play(stack("As Ks", "4c 4d", "Qs Js Ts 2d 3c"), "bet4"));
    assert.deepEqual(f, { handRank: "royal_flush", raiseStreet: "preflop", dealerQualified: true, folded: false, won: true });
  });

  it("validates the ante against the table limits", () => {
    assert.equal(uth.validateBets({ ante: 25 }, UTH_LIMITS, null), null);
    assert.match(uth.validateBets({ ante: 5 }, UTH_LIMITS, null)!, /minimum/);
  });
});

describe("UTH house edge", () => {
  it("is about 2.4% of the ante with the simple strategy (2.2% with optimal play)", () => {
    const hands = 400_000;
    const ante = 10;
    const r = simulate(uth, { hands, rng: seededRng(44), bets: { ante }, strategy: (s) => ({ type: simpleStrategy(s) }) });
    const edge = (r.wagered - r.returned) / (hands * ante);
    const sigma = (r.stdErr * r.wagered) / (hands * ante);
    assert.ok(Math.abs(edge - SIMPLE_STRATEGY_EDGE) < 4 * sigma, `edge ${edge} ± ${sigma}`);
    assert.ok(SIMPLE_STRATEGY_EDGE - HOUSE_EDGE_PER_ANTE < 0.005, "the simple strategy is close to optimal");
    assert.ok(Math.abs(r.wagered / (hands * ante) - WAGER_PER_ANTE) < 0.02, `wager per ante ${r.wagered / (hands * ante)}`);
  });
});
