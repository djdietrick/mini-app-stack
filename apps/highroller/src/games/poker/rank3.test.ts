import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Card, freshDeck } from "../cards.js";
import { THREE_CARD_CATEGORIES, describe3, floor3, rank3 } from "./rank3.js";

const r = (cards: string) => rank3(cards.split(" ") as Card[]);

describe("rank3", () => {
  it("names each category", () => {
    assert.equal(r("Qh Kh Ah").category, "straight_flush");
    assert.equal(r("7c 7d 7h").category, "trips");
    assert.equal(r("4c 5d 6h").category, "straight");
    assert.equal(r("2c 9c Kc").category, "flush");
    assert.equal(r("9c 9d 2h").category, "pair");
    assert.equal(r("Ac 9d 2h").category, "high_card");
  });

  it("ranks a straight above a flush, and three of a kind above both", () => {
    assert.ok(r("4c 5d 6h").score > r("Ac Kc 9c").score);
    assert.ok(r("2c 2d 2h").score > r("Qc Kd Ah").score);
    assert.ok(r("2c 3c 4c").score > r("Ac Ad Ah").score);
  });

  it("counts A-2-3 as the lowest straight and Q-K-A as the highest", () => {
    assert.equal(r("Ac 2d 3h").category, "straight");
    assert.equal(r("Qc Kd Ah").category, "straight");
    assert.equal(r("Kc Ad 2h").category, "high_card", "no wrapping round the ace");
    assert.ok(r("Ac 2d 3h").score < r("2c 3d 4h").score);
    assert.ok(r("Qc Kd Ah").score > r("Jc Qd Kh").score);
    assert.equal(r("As 2s 3s").category, "straight_flush");
    assert.ok(r("As 2s 3s").score < r("2s 3s 4s").score);
    assert.equal(describe3(["Ac", "2d", "3h"]), "Straight, three high");
  });

  it("breaks ties by the pair, then the kicker, then high cards in turn", () => {
    assert.ok(r("9c 9d Ah").score > r("9h 9s Kh").score);
    assert.ok(r("Tc Td 2h").score > r("9h 9s Ah").score);
    assert.ok(r("Ac 7d 3h").score > r("Ah 7s 2c").score);
    assert.equal(r("Ac 7d 3h").score, r("Ah 7s 3c").score);
    assert.ok(r("Qc 6d 4h").score >= floor3("high_card", [12, 6, 4]));
    assert.ok(r("Qc 6d 3h").score < floor3("high_card", [12, 6, 4]));
  });

  it("counts the 22,100 hands of each kind", () => {
    const deck = freshDeck();
    const counts = Object.fromEntries(THREE_CARD_CATEGORIES.map((c) => [c, 0]));
    for (let i = 0; i < 52; i++) for (let j = i + 1; j < 52; j++) for (let k = j + 1; k < 52; k++) counts[rank3([deck[i], deck[j], deck[k]]).category]++;
    assert.deepEqual(counts, { straight_flush: 48, trips: 52, straight: 720, flush: 1_096, pair: 3_744, high_card: 16_440 });
  });

  it("describes hands", () => {
    assert.equal(describe3(["Qh", "Kh", "Ah"]), "Straight flush, ace high");
    assert.equal(describe3(["6c", "6d", "6h"]), "Three sixes");
    assert.equal(describe3(["9c", "9d", "2h"]), "Pair of nines");
    assert.equal(describe3(["Kc", "9d", "2h"]), "King high");
  });
});
