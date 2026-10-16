import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Card, freshDeck, parseCard } from "../cards.js";
import { evaluate } from "../poker/eval.js";
import { seededRng } from "../rng.js";
import {
  PAYS,
  ROYAL_MAX_COINS,
  VIDEOPOKER_LIMITS,
  type VideoPokerState,
  bestHold,
  classify,
  dealFrom,
  holdValue,
  payFor,
  videopoker,
} from "./engine.js";
import { simpleHold } from "./strategy.js";

const cards = (s: string) => s.split(" ") as Card[];
const holdOf = (mask: string) => [...mask].map((c) => c === "x");
/** Ten stacked cards: the five dealt, then the replacements. */
const stack = (dealt: string, rest = "2c 3d 4h 5s 7c", coins = 5, coinValue = 5) =>
  dealFrom(cards(`${dealt} ${rest}`), { coins, coinValue });
const draw = (s: VideoPokerState, mask: string) => videopoker.act(s, { type: "draw", hold: holdOf(mask) })!;

describe("the 9/6 Jacks or Better paytable", () => {
  it("classifies every line", () => {
    const lines: [string, string][] = [
      ["Ah Kh Qh Jh Th", "royal_flush"],
      ["9s 8s 7s 6s 5s", "straight_flush"],
      ["9s 9h 9d 9c 2s", "quads"],
      ["9s 9h 9d 2c 2s", "full_house"],
      ["2h 7h 9h Jh Kh", "flush"],
      ["Ac 2d 3h 4s 5c", "straight"],
      ["7s 7h 7d 2c Ks", "trips"],
      ["7s 7h 2d 2c Ks", "two_pair"],
      ["Js Jh 2d 3c 9s", "jacks_or_better"],
      ["As Ah 2d 3c 9s", "jacks_or_better"],
      ["Ts Th 2d 3c 9s", "nothing"],
      ["As Kh 2d 3c 9s", "nothing"],
    ];
    for (const [hand, line] of lines) assert.equal(classify(cards(hand)), line, hand);
  });

  it("pays per coin, the stake included, with the royal's bonus at 5 coins", () => {
    assert.deepEqual(PAYS, { royal_flush: 250, straight_flush: 50, quads: 25, full_house: 9, flush: 6, straight: 4, trips: 3, two_pair: 2, jacks_or_better: 1, nothing: 0 });
    assert.equal(payFor("royal_flush", 4), 250);
    assert.equal(payFor("royal_flush", 5), ROYAL_MAX_COINS);
    assert.equal(payFor("full_house", 5), 9);
    const royal = (coins: number, value: number) => videopoker.settle(draw(stack("Ah Kh Qh Jh Th", undefined, coins, value), "xxxxx")).returned;
    assert.equal(royal(5, 25), 800 * 125);
    assert.equal(royal(4, 25), 250 * 100);
    assert.equal(royal(1, 5), 250 * 5);
    const jacks = draw(stack("Js Jh 2d 3c 9s", "4c 6d 8h Ts Kc", 3, 25), "xx___");
    assert.deepEqual(videopoker.settle(jacks).results, [{ spot: "hand", stake: 75, returned: 75, outcome: "push" }]);
  });

  it("validates coins and coin values", () => {
    const check = (coins: number, coinValue: number) => videopoker.validateBets({ coins, coinValue }, VIDEOPOKER_LIMITS, null);
    assert.equal(check(1, 5), null);
    assert.equal(check(5, 100), null);
    assert.match(check(0, 5)!, /1 to 5 coins/);
    assert.match(check(6, 5)!, /1 to 5 coins/);
    assert.match(check(2.5, 5)!, /1 to 5 coins/);
    assert.match(check(1, 10)!, /worth 5, 25, 100/);
  });
});

describe("the deal and the draw", () => {
  it("replaces discards in order from the stored deck", () => {
    const s = stack("Ah 9c Kh 2d 5s", "Qh Jh Th 8c 8d");
    assert.deepEqual(videopoker.legalActions(s), ["draw"]);
    assert.equal(videopoker.isFinished(s), false);
    const done = draw(s, "x_x__");
    assert.deepEqual(videopoker.view(done).cards, ["Ah", "Qh", "Kh", "Jh", "Th"]);
    assert.equal(videopoker.view(done).hand, "royal_flush");
    assert.equal(videopoker.view(done).returned, 800 * 25);
    assert.deepEqual(videopoker.legalActions(done), []);
    assert.equal(videopoker.act(done, { type: "draw", hold: holdOf("xxxxx") }), null);
  });

  it("is deterministic given the stored state: a reload deals the same draw", () => {
    const s = videopoker.deal({ coins: 5, coinValue: 5 }, seededRng(55), null);
    const stored: VideoPokerState = JSON.parse(JSON.stringify(s));
    assert.deepEqual(draw(s, "x___x"), draw(stored, "x___x"));
    assert.equal(new Set(s.cards).size, 10);
  });

  it("keeps the replacements private", () => {
    const s = videopoker.deal({ coins: 1, coinValue: 5 }, seededRng(7), null);
    const live = JSON.stringify(videopoker.view(s));
    for (const c of s.cards.slice(5)) assert.ok(!live.includes(c), `${c} leaked before the draw`);
    // Holding three uses two replacements; the other three never show.
    const done = JSON.stringify(videopoker.view(draw(s, "xxx__")));
    for (const c of s.cards.slice(7)) assert.ok(!done.includes(c), `${c} leaked after the draw`);
  });

  it("refuses a hold of the wrong length", () => {
    assert.equal(videopoker.act(stack("Ah 9c Kh 2d 5s"), { type: "draw", hold: [true] }), null);
  });

  it("reports facts for quests", () => {
    assert.deepEqual(videopoker.summary(draw(stack("Ah 9c Kh 2d 5s", "Qh Jh Th 8c 8d"), "x_x__")), {
      handRank: "royal_flush",
      dealtRank: "nothing",
      held: 2,
      coins: 5,
    });
  });
});

describe("expected values of holds", () => {
  it("are exact for hands worked by hand", () => {
    assert.equal(holdValue(cards("Ah Kh Qh Jh Th"), holdOf("xxxxx")), 800);
    assert.equal(holdValue(cards("Ah Kh Qh Jh Th"), holdOf("xxxxx"), 1), 250);
    assert.equal(holdValue(cards("9s 9h 9d 2c 2s"), holdOf("xxxxx")), 9);
    // Four to a royal with a deuce: 1 royal, 3 other tens (straights), 8 other hearts (flushes)
    // and 12 high pairs among the 47 unseen cards.
    assert.ok(Math.abs(holdValue(cards("Ah Kh Qh Jh 2c"), holdOf("xxxx_")) - (800 + 3 * 4 + 8 * 6 + 12) / 47) < 1e-12);
    assert.ok(Math.abs(holdValue(cards("Ah Kh Qh Jh 2c"), holdOf("xxxx_"), 1) - (250 + 3 * 4 + 8 * 6 + 12) / 47) < 1e-12);
  });

  it("agree with a brute force over the general evaluator", () => {
    const hand = cards("Js Jh 2d 7c 9s");
    const rest = freshDeck().filter((c) => !hand.includes(c));
    const pay = (h: Card[]) => {
      const e = evaluate(h);
      if (e.category === "pair") return parseCard(e.cards[0]).value >= 11 ? 1 : 0;
      return e.category === "high_card" ? 0 : payFor(e.category, 5);
    };
    let total = 0;
    let n = 0;
    for (let a = 0; a < rest.length; a++) {
      for (let b = a + 1; b < rest.length; b++) {
        for (let c = b + 1; c < rest.length; c++) {
          total += pay(["Js", "Jh", rest[a], rest[b], rest[c]]);
          n++;
        }
      }
    }
    assert.equal(n, 16_215);
    assert.ok(Math.abs(holdValue(hand, holdOf("xx___")) - total / n) < 1e-12);
    // About 1.54 a coin: the textbook figure for a high pair.
    assert.ok(Math.abs(total / n - 1.54) < 0.01, `${total / n}`);
  });

  it("pick the textbook holds", () => {
    // Four to a flush beats a low pair; four to a royal beats a pat flush.
    assert.deepEqual(bestHold(cards("2h 2c 7h 9h Kh")).hold, holdOf("x_xxx"));
    assert.deepEqual(bestHold(cards("Ah Kh Qh Jh 9h")).hold, holdOf("xxxx_"));
    assert.deepEqual(bestHold(cards("9s 9h 9d 2c Ks")).hold, holdOf("xxx__"));
  });
});

describe("the simple strategy", () => {
  it("holds what the exact best hold holds on textbook hands", () => {
    for (const hand of ["2h 2c 7h 9h Kh", "Ah Kh Qh Jh 9h", "9s 9h 9d 2c Ks", "Js Jh 2d 7c 9s", "5c 6d 7h 8s Kc", "Kh Qh 4c 7d 2s", "3s 8d Tc 5h 2c"]) {
      assert.deepEqual(simpleHold(cards(hand)), bestHold(cards(hand)).hold, hand);
    }
  });

  it("returns close to 99.5% over many hands", () => {
    const rng = seededRng(5500);
    let back = 0;
    let sq = 0;
    const n = 150_000;
    for (let i = 0; i < n; i++) {
      const s = videopoker.deal({ coins: 5, coinValue: 5 }, rng, null);
      const r = videopoker.settle(videopoker.act(s, { type: "draw", hold: simpleHold(s.cards.slice(0, 5)) })!).returned / 25;
      back += r;
      sq += r * r;
    }
    const mean = back / n;
    const se = Math.sqrt((sq / n - mean * mean) / n);
    // The published return of this strategy is 99.46%; the royal makes the spread wide.
    assert.ok(Math.abs(mean - 0.9946) < 4 * se, `rtp ${mean} ± ${se}`);
  });
});
