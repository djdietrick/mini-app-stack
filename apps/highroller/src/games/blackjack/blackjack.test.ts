import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Card } from "../cards.js";
import { seededRng } from "../rng.js";
import { simulate } from "../simulate.js";
import {
  BLACKJACK_LIMITS,
  type BlackjackState,
  CARDS_DRAWN,
  HOUSE_EDGE,
  WAGER_PER_BET,
  blackjack,
  dealFrom,
  handValue,
  totalLabel,
} from "./engine.js";
import { basicStrategy } from "./strategy.js";

/**
 * Rules, edge cases and the house edge. Hands are dealt from stacked cards:
 * player, dealer up, player, dealer hole, then hits in order. The filler
 * after the listed cards is all twos, so a test that runs past them notices.
 */
const stack = (s: string, bet = 100) => dealFrom([...(s.split(" ") as Card[]), ...Array<Card>(40).fill("2c")], { main: bet });

function play(s: BlackjackState, ...types: string[]): BlackjackState {
  for (const type of types) {
    const next = blackjack.act(s, { type } as never);
    assert.ok(next, `${type} should be legal in ${JSON.stringify(blackjack.view(s))}`);
    s = next;
  }
  return s;
}

const returned = (s: BlackjackState) => blackjack.settle(s).returned;

describe("blackjack hand values", () => {
  it("counts aces as 11 when they fit", () => {
    assert.deepEqual(handValue(["Ac", "6d"]), { total: 17, soft: true });
    assert.deepEqual(handValue(["Ac", "6d", "Kh"]), { total: 17, soft: false });
    assert.deepEqual(handValue(["Ac", "Ad", "9h"]), { total: 21, soft: true });
    assert.equal(totalLabel(["Ac", "6d"]), "soft 17");
    assert.equal(totalLabel(["Ac", "Kd"], true), "blackjack");
    assert.equal(totalLabel(["Tc", "6d", "9h"]), "bust");
  });
});

describe("blackjack rules", () => {
  it("dealer stands on soft 17", () => {
    let s = stack("Tc 6d 8h As");
    s = play(s, "stand");
    assert.deepEqual(s.dealer, ["6d", "As"]);
    assert.equal(returned(s), 200, "18 beats soft 17");
  });

  it("dealer draws to 16 and stands on 17+", () => {
    const s = play(stack("Tc 6d 9h Ts 5c"), "stand");
    assert.deepEqual(s.dealer, ["6d", "Ts", "5c"]);
    assert.equal(returned(s), 0, "19 loses to 21");
  });

  it("pays 3:2 on a blackjack, rounded down", () => {
    const s = stack("Ac 9d Kh 7s", 15);
    assert.ok(blackjack.isFinished(s), "no decisions on a natural");
    assert.equal(returned(s), 15 + 22);
    assert.equal(returned(stack("Ac 9d Kh 7s", 10)), 25);
    assert.equal(blackjack.view(s).hands[0].result?.outcome, "blackjack");
  });

  it("peeks under a ten and ends the hand on a dealer blackjack", () => {
    const s = stack("9c Td 7h Ad");
    assert.ok(blackjack.isFinished(s));
    assert.deepEqual(blackjack.legalActions(s), []);
    assert.equal(returned(s), 0);
    assert.equal(blackjack.staked(s), 100, "no chance to double into it");
    assert.equal(returned(stack("Ac Td Kh Ad")), 100, "blackjack against blackjack pushes");
  });

  it("offers insurance on an ace, paying 2:1 on half the bet", () => {
    let s = stack("9c Ad 7h Kd");
    assert.equal(s.phase, "insurance");
    assert.deepEqual(blackjack.legalActions(s), ["insurance", "no_insurance"]);
    s = play(s, "insurance");
    assert.ok(blackjack.isFinished(s));
    assert.equal(blackjack.staked(s), 150);
    assert.equal(returned(s), 150, "main lost, insurance 50 returns 150");
    assert.deepEqual(blackjack.settle(s).results.map((r) => [r.spot, r.outcome]), [["main", "loss"], ["insurance", "win"]]);

    let lost = play(stack("Tc Ad 9h 7d"), "insurance");
    assert.equal(lost.phase, "player", "no dealer blackjack: play on");
    lost = play(lost, "stand");
    assert.equal(returned(lost), 200, "19 beats 18; insurance lost");
    assert.equal(blackjack.staked(lost), 150);
  });

  it("offers even money on a blackjack against an ace", () => {
    const s = stack("Ac Ad Kh 7d");
    assert.deepEqual(blackjack.legalActions(s), ["even_money", "no_insurance"]);
    assert.equal(returned(play(s, "even_money")), 200);
    assert.equal(returned(play(stack("Ac Ad Kh Kd"), "even_money")), 200, "even money whatever the hole card");
    assert.equal(returned(play(s, "no_insurance")), 250);
    assert.equal(returned(play(stack("Ac Ad Kh Kd"), "no_insurance")), 100);
  });

  it("doubles on any two cards for exactly one card", () => {
    let s = stack("5c 6d 6h Ts Tc 9h");
    s = play(s, "double");
    assert.ok(blackjack.isFinished(s), "the double was the only hand");
    assert.deepEqual(s.hands[0].cards, ["5c", "6h", "Tc"]);
    assert.equal(blackjack.staked(s), 200);
    assert.equal(returned(s), 400, "21 against a dealer who draws to 16 and busts");
    assert.equal(blackjack.act(play(stack("5c 6d 4h Ts 2c"), "hit"), { type: "double" }), null, "not on three cards");
  });

  it("splits up to four hands, dealing each its second card when it comes up", () => {
    let s = stack("8c 6d 8h Ts 8d 8s 8c 3c 2h Tc Tc");
    s = play(s, "split");
    assert.equal(s.hands.length, 2);
    assert.deepEqual(s.hands[0].cards, ["8c", "8d"]);
    assert.deepEqual(s.hands[1].cards, ["8h"], "second hand waits for its card");
    s = play(s, "split", "split");
    assert.equal(s.hands.length, 4);
    assert.ok(!blackjack.legalActions(s).includes("split"), "four is the limit");
    assert.equal(blackjack.staked(s), 400);
    assert.ok(!blackjack.legalActions(s).includes("surrender"));
  });

  it("doubles after a split", () => {
    let s = stack("9c 6d 9h Ts 2c 5c 2d Tc 9s");
    s = play(s, "split");
    assert.ok(blackjack.legalActions(s).includes("double"));
    s = play(s, "double");
    assert.equal(s.active, 1);
    assert.equal(blackjack.staked(s), 300);
  });

  it("gives split aces one card each, and 21 there is not a blackjack", () => {
    let s = stack("Ac 6d Ah Ts Kc 9d 4c");
    s = play(s, "split");
    assert.ok(blackjack.isFinished(s), "both aces done after one card");
    assert.deepEqual(s.hands.map((h) => h.cards), [["Ac", "Kc"], ["Ah", "9d"]]);
    assert.deepEqual(s.dealer, ["6d", "Ts", "4c"]);
    assert.equal(returned(s), 200 + 100, "21 pays 1:1 against 20; 20 pushes");
    assert.deepEqual(blackjack.view(s).hands.map((h) => h.result?.outcome), ["win", "push"]);
  });

  it("can't split aces again", () => {
    const s = play(stack("Ac 6d Ah Ts Ad Ks 9c"), "split");
    assert.ok(blackjack.isFinished(s));
    assert.equal(s.hands.length, 2);
  });

  it("surrenders late for half the bet, rounded down, on the first two cards only", () => {
    const s = play(stack("Tc 9d 6h Ts", 15), "surrender");
    assert.ok(blackjack.isFinished(s));
    assert.equal(returned(s), 7);
    assert.deepEqual(s.dealer, ["9d", "Ts"], "the dealer doesn't draw for a surrendered hand");
    assert.ok(!blackjack.legalActions(play(stack("Tc 9d 2h Ts 2s"), "hit")).includes("surrender"));
  });

  it("stands a hand on 21 without asking, and skips the dealer when every hand busts", () => {
    let s = play(stack("Tc 6d 5h Ts 6c"), "hit");
    assert.ok(blackjack.isFinished(s), "21 stands by itself");
    s = play(stack("Tc 6d 5h Ts Kc"), "hit");
    assert.ok(blackjack.isFinished(s));
    assert.deepEqual(s.dealer, ["6d", "Ts"]);
    assert.equal(returned(s), 0);
  });

  it("keeps the shoe and the hole card out of the view until the end", () => {
    const s = stack("Tc 6d 5h Ts");
    const v = blackjack.view(s);
    assert.deepEqual(v.dealer, ["6d", null]);
    assert.ok(!JSON.stringify(v).includes("shoe"));
    assert.equal(v.active, 0);
    assert.deepEqual(blackjack.view(play(s, "stand")).dealer.slice(0, 2), ["6d", "Ts"]);
  });

  it("survives a JSON round trip, as the repos store it", () => {
    const s = blackjack.deal({ main: 50 }, seededRng(3), null);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    assert.equal(s.shoe.length, CARDS_DRAWN);
  });

  it("reports facts for quests", () => {
    const f = blackjack.summary(play(stack("Ac 6d Ah Ts Kc 9d 4c"), "split"));
    assert.equal(f.splits, 1);
    assert.equal(f.blackjack, false);
    assert.equal(blackjack.summary(stack("Ac 9d Kh 7s")).blackjack, true);
  });

  it("validates the stake against the table limits", () => {
    assert.equal(blackjack.validateBets({ main: 10 }, BLACKJACK_LIMITS, null), null);
    assert.match(blackjack.validateBets({ main: 5 }, BLACKJACK_LIMITS, null)!, /minimum/);
    assert.match(blackjack.validateBets({ main: 12 }, BLACKJACK_LIMITS, null)!, /steps/);
    assert.match(blackjack.validateBets({ main: 5005 }, BLACKJACK_LIMITS, null)!, /maximum/);
  });
});

describe("blackjack house edge", () => {
  it("is about 0.31% of the first bet with basic strategy", () => {
    const hands = 300_000;
    const bet = 10;
    const r = simulate(blackjack, {
      hands,
      rng: seededRng(43),
      bets: { main: bet },
      strategy: (s, legal) => ({ type: basicStrategy(s.hands[s.active].cards, s.dealer[0], legal) }),
    });
    const edge = (r.wagered - r.returned) / (hands * bet);
    const sigma = (r.stdErr * r.wagered) / (hands * bet);
    assert.ok(Math.abs(edge - HOUSE_EDGE) < 4 * sigma, `edge ${edge} ± ${sigma}`);
    assert.ok(Math.abs(r.wagered / (hands * bet) - WAGER_PER_BET) < 0.01, `wager per bet ${r.wagered / (hands * bet)}`);
    assert.ok(Math.abs(r.rtp - blackjack.theoreticalRtp(null)) < 4 * r.stdErr);
  });
});
