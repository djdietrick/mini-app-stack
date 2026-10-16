import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Card, freshDeck } from "../cards.js";
import { THREE_CARD_CATEGORIES, rank3 } from "../poker/rank3.js";
import { seededRng } from "../rng.js";
import { simulate } from "../simulate.js";
import {
  HOUSE_EDGE_PER_ANTE,
  PAIR_PLUS_PAYS,
  PAIR_PLUS_RTP,
  THREECARD_LIMITS,
  type ThreeCardState,
  WAGER_PER_ANTE,
  dealFrom,
  threecard,
} from "./engine.js";
import { optimalStrategy } from "./strategy.js";

const stack = (you: string, dealer: string, ante = 10, pairPlus?: number) =>
  dealFrom([...you.split(" "), ...dealer.split(" ")] as Card[], { ante, pairPlus });
const act = (s: ThreeCardState, type: "play" | "fold") => threecard.act(s, { type })!;
const spots = (s: ThreeCardState) => Object.fromEntries(threecard.settle(s).results.map((r) => [r.spot, r.returned]));

describe("Three Card Poker", () => {
  it("offers play or fold once, and hides the dealer's cards until then", () => {
    const s = stack("Ac Kd 2h", "Qc 8d 3s");
    assert.deepEqual(threecard.legalActions(s), ["play", "fold"]);
    assert.deepEqual(threecard.view(s).dealer, [null, null, null]);
    assert.equal(threecard.view(s).returned, null);
    const played = act(s, "play");
    assert.ok(threecard.isFinished(played));
    assert.deepEqual(threecard.legalActions(played), []);
    assert.equal(threecard.act(played, { type: "fold" }), null);
    assert.deepEqual(threecard.view(played).dealer, ["Qc", "8d", "3s"]);
    assert.equal(threecard.staked(played), 20);
  });

  it("pays the Ante 1:1 and pushes the Play when the dealer doesn't qualify", () => {
    assert.deepEqual(spots(act(stack("4c 5d 9h", "Jc 8d 3s"), "play")), { ante: 20, play: 10 });
    // Losing to a dealer who doesn't qualify still pays the Ante.
    assert.deepEqual(spots(act(stack("4c 5d 9h", "Jc Td 3s"), "play")), { ante: 20, play: 10 });
  });

  it("compares hands against a qualifying dealer", () => {
    assert.deepEqual(spots(act(stack("Ac Kd 2h", "Qc 8d 3s"), "play")), { ante: 20, play: 20 });
    assert.deepEqual(spots(act(stack("Kc Jd 2h", "Qc Ad 3s"), "play")), { ante: 0, play: 0 });
    assert.deepEqual(spots(act(stack("Ac Kd 2h", "As Kh 2c"), "play")), { ante: 10, play: 10 });
    assert.equal(threecard.view(act(stack("Ac Kd 2h", "As Kh 2c"), "play")).showdown?.winner, "tie");
  });

  it("pays the Ante bonus on a played straight or better, whatever the dealer has", () => {
    // A straight loses to a dealer's straight flush but still collects 1:1 on the bonus.
    assert.deepEqual(spots(act(stack("4c 5d 6h", "7s 8s 9s"), "play")), { ante: 10, play: 0 });
    assert.equal(spots(act(stack("7c 7d 7h", "Qc 8d 3s"), "play")).ante, 20 + 40, "trips 4:1");
    assert.equal(spots(act(stack("Qh Kh Ah", "Qc 8d 3s"), "play")).ante, 20 + 50, "straight flush 5:1");
    assert.equal(threecard.view(act(stack("Qh Kh Ah", "Qc 8d 3s"), "play")).returned?.anteBonus, 50);
    assert.equal(spots(act(stack("7c 7d 7h", "Qc 8d 3s"), "fold")).ante, 0, "no bonus on a fold");
  });

  it("loses the Ante on a fold, and pays Pair Plus on your hand anyway", () => {
    const s = act(stack("9c 9d 2h", "As Ad 3c", 10, 5), "fold");
    assert.deepEqual(spots(s), { ante: 0, pairPlus: 10 });
    assert.equal(threecard.staked(s), 15);
    assert.equal(threecard.view(s).showdown?.winner, null);
    assert.deepEqual(threecard.summary(s), { handRank: "pair", dealerQualified: true, folded: true, won: false, pairPlusWon: true });
  });

  it("pays Pair Plus by its table", () => {
    const pp = (you: string) => spots(act(stack(you, "2c 3d 7s", 10, 10), "play")).pairPlus;
    assert.equal(pp("Qh Kh Ah"), 410);
    assert.equal(pp("8c 8d 8h"), 310);
    assert.equal(pp("4c 5d 6h"), 70);
    assert.equal(pp("2h 9h Kh"), 50);
    assert.equal(pp("9c 9d Kh"), 20);
    assert.equal(pp("Ac 9d Kh"), 0);
  });

  it("keeps six cards, the dealer's hidden until the end", () => {
    const s = threecard.deal({ ante: 10 }, seededRng(54), null);
    assert.equal(new Set([...s.player, ...s.dealer]).size, 6);
    const shown = JSON.stringify(threecard.view(s));
    for (const c of s.dealer) assert.ok(!shown.includes(c), `${c} leaked`);
  });

  it("validates the ante and Pair Plus against the limits", () => {
    assert.equal(threecard.validateBets({ ante: 2_500, pairPlus: 500 }, THREECARD_LIMITS, null), null);
    assert.match(threecard.validateBets({ ante: 5 }, THREECARD_LIMITS, null)!, /minimum/);
    assert.match(threecard.validateBets({ ante: 10, pairPlus: 505 }, THREECARD_LIMITS, null)!, /maximum Pair Plus bet is 500/);
  });
});

describe("Three Card Poker house edge", () => {
  it("returns 97.68% on Pair Plus (a 2.32% edge), exactly from the 22,100 hands", () => {
    const deck = freshDeck();
    let back = 0;
    let n = 0;
    for (let i = 0; i < 52; i++) {
      for (let j = i + 1; j < 52; j++) {
        for (let k = j + 1; k < 52; k++) {
          const pays = PAIR_PLUS_PAYS[rank3([deck[i], deck[j], deck[k]]).category];
          back += pays === undefined ? 0 : pays + 1;
          n++;
        }
      }
    }
    assert.equal(n, 22_100);
    assert.ok(Math.abs(back / n - PAIR_PLUS_RTP) < 1e-12);
    assert.ok(Math.abs(1 - PAIR_PLUS_RTP - 0.0232) < 0.0001);
    assert.deepEqual(Object.keys(PAIR_PLUS_PAYS).sort(), THREE_CARD_CATEGORIES.filter((c) => c !== "high_card").sort());
  });

  it("is about 3.37% of the ante with the optimal strategy", () => {
    const hands = 400_000;
    const ante = 10;
    const r = simulate(threecard, { hands, rng: seededRng(54), bets: { ante }, strategy: (s) => ({ type: optimalStrategy(s) }) });
    const edge = (r.wagered - r.returned) / (hands * ante);
    const sigma = (r.stdErr * r.wagered) / (hands * ante);
    assert.ok(Math.abs(edge - HOUSE_EDGE_PER_ANTE) < 4 * sigma, `edge ${edge} ± ${sigma}`);
    assert.ok(Math.abs(r.wagered / (hands * ante) - WAGER_PER_ANTE) < 0.005, `wager per ante ${r.wagered / (hands * ante)}`);
  });
});
