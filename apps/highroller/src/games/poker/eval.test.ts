import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Card, freshDeck } from "../cards.js";
import { sample, seededRng } from "../rng.js";
import { categoryOf, compareHands, describeHand, evaluate, floorOf, handScore } from "./eval.js";

const h = (s: string) => s.split(" ") as Card[];
const ev = (s: string) => evaluate(h(s));

describe("poker hand evaluator", () => {
  it("names every category, best five of seven", () => {
    const cases: [string, string, string][] = [
      ["As Ks Qs Js Ts 2d 3c", "royal_flush", "Royal flush"],
      ["9h 8h 7h 6h 5h Ac Ad", "straight_flush", "Straight flush, nine high"],
      ["Qc Qd Qh Qs 2c 7d 9h", "quads", "Four of a kind, queens"],
      ["Kc Kd Kh 7s 7c 2d 3h", "full_house", "Full house, kings over sevens"],
      ["Ad 9d 7d 4d 2d Kc Kh", "flush", "Flush, ace high"],
      ["Tc 9d 8h 7s 6c 2d 2h", "straight", "Straight, ten high"],
      ["5c 5d 5h Ks 9c 3d 2h", "trips", "Three of a kind, fives"],
      ["Kc Kd 7h 7s 2c 3d 9h", "two_pair", "Two pair, kings and sevens"],
      ["Jc Jd 9h 7s 4c 3d 2h", "pair", "Pair of jacks"],
      ["Ac Qd 9h 7s 4c 3d 2h", "high_card", "Ace high"],
    ];
    for (const [cards, category, label] of cases) {
      const r = ev(cards);
      assert.equal(r.category, category, cards);
      assert.equal(describeHand(r), label);
      assert.equal(r.cards.length, 5);
    }
  });

  it("finds the wheel and ranks it below a six-high straight", () => {
    const wheel = ev("Ac 2d 3h 4s 5c Kd Kh");
    assert.equal(wheel.category, "straight");
    assert.equal(describeHand(wheel), "Straight, five high");
    assert.deepEqual(wheel.cards.map((c) => c[0]), ["5", "4", "3", "2", "A"]);
    assert.ok(compareHands(ev("2d 3h 4s 5c 6c Kd Kh"), wheel) > 0);
    assert.equal(ev("Ah 2h 3h 4h 5h 9c 9d").category, "straight_flush");
  });

  it("decides on kickers, and ties when the best five match", () => {
    assert.ok(compareHands(ev("Ac Ad Kh 7s 4c"), ev("As Ah Qh 7d 4d")) > 0);
    assert.ok(compareHands(ev("Kc Kd 7h 7s Ac"), ev("Kh Ks 7d 7c Qc")) > 0);
    assert.ok(compareHands(ev("9c 9d 9h 5s 5c"), ev("8c 8d 8h As Ac")) > 0);
    // Both play the board.
    const board = "As Ks Qd Jh Tc";
    assert.equal(compareHands(evaluate([...h(board), "2c", "3d"]), evaluate([...h(board), "4c", "5d"])), 0);
    // A third pair's card can be the kicker.
    assert.equal(ev("Kc Kd 7h 7s 5c 5d 2h").cards[4][0], "5");
  });

  it("makes the best full house from two sets of three", () => {
    const r = ev("7c 7d 7h Ks Kc Kd 2h");
    assert.equal(r.category, "full_house");
    assert.equal(describeHand(r), "Full house, kings over sevens");
  });

  it("prefers a straight flush to a bigger flush or straight in the same seven", () => {
    assert.equal(ev("8s 7s 6s 5s 4s As 9d").category, "straight_flush");
    assert.equal(describeHand(ev("8s 7s 6s 5s 4s As 9d")), "Straight flush, eight high");
  });

  it("ranks fewer than five cards, for the pre-flop label", () => {
    assert.equal(describeHand(ev("8c 8d")), "Pair of eights");
    assert.equal(describeHand(ev("Kc 4d")), "King high");
  });

  it("handScore agrees with evaluate on random hands of 5, 6 and 7 cards", () => {
    const rng = seededRng(77);
    const deck = freshDeck();
    for (let i = 0; i < 30_000; i++) {
      const cards = sample(deck, 5 + (i % 3), rng);
      const r = evaluate(cards);
      assert.equal(handScore(cards), r.score, cards.join(" "));
      assert.equal(categoryOf(r.score), r.category);
    }
  });

  it("hits every category at roughly the textbook seven-card frequency", () => {
    // Exact seven-card frequencies: pair 43.8%, two pair 23.5%, flush 3.03%, full house 2.60%.
    const rng = seededRng(5);
    const deck = freshDeck();
    const n = 60_000;
    const seen: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const c = categoryOf(handScore(sample(deck, 7, rng)));
      seen[c] = (seen[c] ?? 0) + 1;
    }
    const near = (cat: string, p: number) => assert.ok(Math.abs(seen[cat] / n - p) < 4 * Math.sqrt((p * (1 - p)) / n), `${cat} ${seen[cat] / n}`);
    near("pair", 0.438);
    near("two_pair", 0.235);
    near("flush", 0.0303);
    near("full_house", 0.026);
    assert.ok(floorOf("pair") > floorOf("high_card"));
  });
});
