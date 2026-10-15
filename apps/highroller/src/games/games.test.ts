import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { freshDeck, isCard, parseCard, shoe } from "./cards.js";
import { coinflip } from "./coinflip.testkit.js";
import { checkStake } from "./engine.js";
import { seededRng, shuffle } from "./rng.js";
import { simulate } from "./simulate.js";

describe("rng", () => {
  it("is deterministic per seed and stays in bounds", () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const xs = Array.from({ length: 1000 }, () => a.int(7));
    assert.deepEqual(xs, Array.from({ length: 1000 }, () => b.int(7)));
    assert.ok(xs.every((x) => Number.isInteger(x) && x >= 0 && x < 7));
    assert.notDeepEqual(xs.slice(0, 20), Array.from({ length: 20 }, () => seededRng(43).int(7)));
  });

  it("is roughly uniform", () => {
    const rng = seededRng(7);
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) counts[rng.int(10)]++;
    for (const c of counts) assert.ok(Math.abs(c - 10_000) < 400, `bucket ${c}`);
  });

  it("rejects a bad bound", () => {
    assert.throws(() => seededRng(1).int(0));
    assert.throws(() => seededRng(1).int(2.5));
  });

  it("shuffles into a permutation without touching the input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(input, seededRng(3));
    assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual([...out].sort(), input);
    assert.notDeepEqual(out, input);
  });

  it("puts every card in every position about equally often", () => {
    const rng = seededRng(11);
    const firstSeen = new Array(5).fill(0);
    for (let i = 0; i < 50_000; i++) firstSeen[shuffle([0, 1, 2, 3, 4], rng)[0]]++;
    for (const c of firstSeen) assert.ok(Math.abs(c - 10_000) < 400, `position count ${c}`);
  });
});

describe("cards", () => {
  it("has 52 distinct cards in a deck", () => {
    const deck = freshDeck();
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck).size, 52);
    assert.ok(deck.every(isCard));
  });

  it("builds a shoe of several decks, shuffled when given an rng", () => {
    assert.equal(shoe(6).length, 312);
    const shuffled = shoe(6, seededRng(1));
    assert.deepEqual([...shuffled].sort(), [...shoe(6)].sort());
    assert.notDeepEqual(shuffled, shoe(6));
  });

  it("parses the compact form", () => {
    assert.deepEqual(parseCard("Ah"), { rank: "A", suit: "h", value: 14 });
    assert.deepEqual(parseCard("Td"), { rank: "T", suit: "d", value: 10 });
    assert.deepEqual(parseCard("2c"), { rank: "2", suit: "c", value: 2 });
    assert.equal(isCard("1x"), false);
    assert.equal(isCard("Ahh"), false);
  });
});

describe("checkStake", () => {
  const limits = { min: 10, max: 1000, step: 5 };
  it("accepts whole multiples of the step inside the limits", () => {
    assert.equal(checkStake(10, limits), null);
    assert.equal(checkStake(1000, limits), null);
    assert.equal(checkStake(5, limits, 5), null);
  });
  it("says why it refuses", () => {
    assert.match(checkStake(5, limits)!, /minimum/);
    assert.match(checkStake(1005, limits)!, /maximum/);
    assert.match(checkStake(12, limits)!, /steps/);
    assert.match(checkStake(10.5, limits)!, /whole/);
  });
});

describe("the toy coinflip engine", () => {
  it("adds the double to what is staked and pays even money", () => {
    let s = coinflip.deal({ main: 100 }, seededRng(5), "call");
    assert.deepEqual(coinflip.legalActions(s), ["double", "heads", "tails"]);
    s = coinflip.act(s, { type: "double" })!;
    assert.equal(coinflip.staked(s), 200);
    assert.equal(coinflip.act(s, { type: "double" }), null, "only once");
    s = coinflip.act(s, { type: s.coins[0] === "H" ? "heads" : "tails" })!;
    assert.ok(coinflip.isFinished(s));
    assert.deepEqual(coinflip.settle(s), {
      returned: 400,
      results: [{ spot: "main", stake: 200, returned: 400, outcome: "win" }],
    });
  });

  it("settles an instant hand as it is dealt, and hides the coins until then", () => {
    const s = coinflip.deal({ main: 50 }, seededRng(9), "instant");
    assert.ok(coinflip.isFinished(s));
    assert.equal(coinflip.view(s).landed, s.coins[0]);
    const live = coinflip.deal({ main: 50 }, seededRng(9), "call");
    assert.equal(coinflip.view(live).landed, null);
    assert.ok(!("coins" in coinflip.view(live)));
  });
});

describe("simulate", () => {
  it("measures the coinflip's RTP within a few standard errors of 1", () => {
    const r = simulate(coinflip, {
      hands: 20_000,
      rng: seededRng(2026),
      bets: { main: 10 },
      strategy: () => ({ type: "heads" }),
    });
    assert.equal(r.hands, 20_000);
    assert.equal(r.wagered, 200_000);
    assert.ok(r.stdErr > 0.005 && r.stdErr < 0.01, `stdErr ${r.stdErr}`);
    assert.ok(Math.abs(r.rtp - coinflip.theoreticalRtp(null)) < 4 * r.stdErr, `rtp ${r.rtp} ± ${r.stdErr}`);
  });

  it("weights extra wagers", () => {
    const r = simulate(coinflip, {
      hands: 1000,
      rng: seededRng(1),
      bets: (i) => ({ main: i % 2 ? 10 : 20 }),
      strategy: (_s, legal) => ({ type: legal.includes("double") ? "double" : "tails" }),
    });
    assert.equal(r.wagered, 500 * 20 + 500 * 40);
  });

  it("stops a strategy that never finishes", () => {
    assert.throws(
      () =>
        simulate(coinflip, {
          hands: 1,
          rng: seededRng(1),
          bets: { main: 10 },
          strategy: () => ({ type: "double" }),
        }),
      /illegal/,
    );
  });
});
