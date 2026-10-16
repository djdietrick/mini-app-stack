import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Card, freshDeck } from "../cards.js";
import { BLACKJACK_LIMITS, blackjack, dealFrom } from "./engine.js";
import {
  PERFECT_PAIRS_PAYS,
  PERFECT_PAIRS_RTP,
  TWENTY_ONE_PLUS_THREE_PAYS,
  TWENTY_ONE_PLUS_THREE_RTP,
  pairHand,
  threeCardHand,
} from "./sidebets.js";

/** Player, dealer up, player, dealer hole, then twos. */
const stack = (s: string, bets: { main: number; perfectPairs?: number; twentyOnePlusThree?: number }) =>
  dealFrom([...(s.split(" ") as Card[]), ...Array<Card>(40).fill("2c")], bets);

describe("Perfect Pairs and 21+3 hands", () => {
  it("names pairs by suit and colour", () => {
    assert.equal(pairHand("8h", "8h"), "perfect");
    assert.equal(pairHand("8h", "8d"), "coloured");
    assert.equal(pairHand("8s", "8c"), "coloured");
    assert.equal(pairHand("8h", "8s"), "mixed");
    assert.equal(pairHand("8h", "9h"), null);
  });

  it("ranks three cards, aces high or low", () => {
    assert.equal(threeCardHand(["7h", "7h", "7h"]), "suited_trips");
    assert.equal(threeCardHand(["9s", "Ts", "Js"]), "straight_flush");
    assert.equal(threeCardHand(["7h", "7d", "7s"]), "trips");
    assert.equal(threeCardHand(["Ad", "2c", "3h"]), "straight");
    assert.equal(threeCardHand(["Qd", "Kc", "Ah"]), "straight");
    assert.equal(threeCardHand(["Kd", "Ac", "2h"]), null, "no wrap-around");
    assert.equal(threeCardHand(["2d", "9d", "Kd"]), "flush");
    assert.equal(threeCardHand(["2d", "9c", "Kd"]), null);
  });
});

describe("side bet RTP, exactly, for six decks", () => {
  // Every ordered draw of the first cards from 312, by card type: 6 of each of 52.
  const types = freshDeck();
  /** Copies of a type still in the shoe after drawing the ones it matches. */
  const copies = (...same: boolean[]) => 6 - same.filter(Boolean).length;

  it(`Perfect Pairs returns ${PERFECT_PAIRS_RTP.toFixed(4)} (a 6.11% edge)`, () => {
    let rtp = 0;
    for (const a of types) {
      for (const b of types) {
        const p = (6 / 312) * (copies(a === b) / 311);
        const hand = pairHand(a, b);
        if (hand) rtp += p * (PERFECT_PAIRS_PAYS[hand] + 1);
      }
    }
    assert.ok(Math.abs(rtp - PERFECT_PAIRS_RTP) < 1e-12, `rtp ${rtp}`);
    assert.ok(Math.abs(1 - rtp - 0.0611) < 0.0001);
  });

  it(`21+3 returns ${TWENTY_ONE_PLUS_THREE_RTP.toFixed(4)} (a 4.62% edge)`, () => {
    let rtp = 0;
    for (const a of types) {
      for (const b of types) {
        for (const c of types) {
          const p = (6 / 312) * (copies(b === a) / 311) * (copies(c === a, c === b) / 310);
          const hand = threeCardHand([a, b, c]);
          if (hand) rtp += p * (TWENTY_ONE_PLUS_THREE_PAYS[hand] + 1);
        }
      }
    }
    assert.ok(Math.abs(rtp - TWENTY_ONE_PLUS_THREE_RTP) < 1e-12, `rtp ${rtp}`);
    assert.ok(Math.abs(1 - rtp - 0.0462) < 0.0001);
  });
});

describe("side bets on the blackjack table", () => {
  it("settles both on the deal and pays them early, whatever the hand does", () => {
    // You 8h 8d (a coloured pair), dealer shows 9d: 8-8-9 is no 21+3 hand.
    let s = stack("8h 9d 8d Ts", { main: 100, perfectPairs: 10, twentyOnePlusThree: 20 });
    const v = blackjack.view(s);
    assert.deepEqual(v.side.perfectPairs, { stake: 10, hand: "coloured", returned: 130 });
    assert.deepEqual(v.side.twentyOnePlusThree, { stake: 20, hand: null, returned: 0 });
    assert.equal(blackjack.paidEarly!(s), 130);
    assert.equal(blackjack.staked(s), 130);

    // Split the eights: the side bets don't move.
    s = blackjack.act(s, { type: "split" })!;
    assert.equal(blackjack.paidEarly!(s), 130);
    s = blackjack.act(blackjack.act(s, { type: "stand" })!, { type: "stand" })!;
    const settled = blackjack.settle(s);
    const spots = Object.fromEntries(settled.results.map((r) => [r.spot, r.returned]));
    assert.equal(spots.perfect_pairs, 130);
    assert.equal(spots["21+3"], 0);
    assert.ok(settled.returned >= 130, "settle counts what was paid early");
  });

  it("pays 21+3 from the dealer's up card, and flags suited trips for the jackpot", () => {
    const s = stack("7h 7h 7h Ts", { main: 10, perfectPairs: 5, twentyOnePlusThree: 5 });
    assert.equal(blackjack.view(s).side.twentyOnePlusThree?.returned, 5 * 101);
    const f = blackjack.summary(blackjack.act(s, { type: "stand" })!);
    assert.equal(f.suitedTrips, true);
    assert.equal(f.jackpotEligible, true);
    assert.equal(f.perfectPair, true);
  });

  it("still pays when the dealer has blackjack", () => {
    const s = stack("Qs Ad Qs Kd", { main: 10, perfectPairs: 5 });
    const done = blackjack.act(s, { type: "no_insurance" })!;
    assert.ok(blackjack.isFinished(done));
    assert.equal(blackjack.settle(done).returned, 5 * 26);
  });

  it("has its own limits, 5 to 500", () => {
    const check = (bets: { main: number; perfectPairs?: number; twentyOnePlusThree?: number }) => blackjack.validateBets(bets, BLACKJACK_LIMITS, null);
    assert.equal(check({ main: 10, perfectPairs: 5, twentyOnePlusThree: 500 }), null);
    assert.match(check({ main: 10, perfectPairs: 505 })!, /maximum Perfect Pairs bet is 500/);
    assert.match(check({ main: 10, twentyOnePlusThree: 0 })!, /minimum 21\+3 bet is 5/);
    assert.match(check({ main: 10, twentyOnePlusThree: 7 })!, /steps/);
  });

  it("plays a hand stored before side bets existed", () => {
    const s = stack("Tc 6d 9h Ts 5c", { main: 10 });
    delete (s as { side?: unknown }).side;
    assert.equal(blackjack.paidEarly!(s), 0);
    assert.equal(blackjack.staked(s), 10);
    assert.deepEqual(blackjack.view(s).side, { perfectPairs: null, twentyOnePlusThree: null });
  });
});
