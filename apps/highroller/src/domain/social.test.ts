import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "@stack/service-kit";
import { z } from "zod";
import { coinflip } from "../games/coinflip.testkit.js";
import { type GiftPlan, type GiftRead, newPlayer, planGift } from "./economy.js";
import { planStart } from "./hands.js";
import { isoWeek, shiftWeek } from "./progress.js";
import { GAMES, defineGame, handLabel } from "./registry.js";
import { HIDDEN_NAME, TtlCache, isBigWin, publicName, rankRows, toFeedEventRow } from "./social.js";
import type { BoardEntry, PlayerRecord } from "./types.js";

const NOW = "2026-10-15T12:00:00.000Z";

const player = (userId: string, over: Partial<PlayerRecord> = {}): PlayerRecord => ({
  ...newPlayer({ userId, email: `${userId}@example.com`, displayName: userId.toUpperCase() }, NOW).player,
  ...over,
});

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
  throw new Error("did not throw");
}

describe("public names", () => {
  it("uses the display name, never an email", () => {
    assert.equal(publicName({ userId: "u1", displayName: "Pat", email: "pat@example.com" }), "Pat");
    // displayNameOf fell back to the email's local part: that is not a name to show.
    const derived = publicName({ userId: "u1", displayName: "pat", email: "pat@example.com" });
    assert.match(derived, /^Player [0-9A-F]{4}$/);
    assert.equal(derived, publicName({ userId: "u1", displayName: "x@y.z", email: "pat@example.com" }));
    assert.notEqual(derived, publicName({ userId: "u2", displayName: "pat", email: "pat@example.com" }));
  });
});

describe("gifting", () => {
  const plan = (over: Partial<GiftPlan> = {}): GiftPlan => ({
    id: "g1",
    amount: 1_000,
    message: "gl",
    senderDay: "2026-10-15",
    utcDay: "2026-10-15",
    fromName: "A",
    toName: "B",
    now: NOW,
    ...over,
  });
  const read = (over: Partial<GiftRead> = {}): GiftRead => ({ from: player("a"), to: player("b"), existing: null, ...over });

  it("moves the chips, writes both ledger rows and both counters", () => {
    const out = planGift(read(), plan());
    const w = out.writes!;
    assert.equal(w.from.balance, 9_000);
    assert.equal(w.to.balance, 11_000);
    assert.deepEqual(
      w.ledger.map((e) => [e.userId, e.seq, e.kind, e.amount, e.balanceAfter, e.ref]),
      [
        ["a", 2, "gift_out", -1_000, 9_000, "b"],
        ["b", 2, "gift_in", 1_000, 11_000, "a"],
      ],
    );
    assert.deepEqual([w.from.giftsSentToday, w.from.giftsSentOn], [1_000, "2026-10-15"]);
    assert.deepEqual([w.to.giftsReceivedToday, w.to.giftsReceivedOn], [1_000, "2026-10-15"]);
    assert.equal(w.gift.message, "gl");
  });

  it("returns a gift already made under the id, writing nothing", () => {
    const first = planGift(read(), plan()).gift;
    const again = planGift(read({ existing: first }), plan());
    assert.equal(again.writes, null);
    assert.equal(again.gift, first);
    assert.equal(code(() => planGift(read({ from: player("c"), existing: first }), plan())), "GIFT_ID_TAKEN");
  });

  it("refuses a gift to yourself", () => {
    assert.equal(code(() => planGift(read({ to: player("a") }), plan())), "SELF_GIFT");
  });

  it("caps what is sent on the sender's day, and resets on the next", () => {
    const from = player("a", { giftsSentToday: 4_500, giftsSentOn: "2026-10-15" });
    assert.equal(code(() => planGift(read({ from }), plan({ amount: 600 }))), "OVER_SEND_CAP");
    assert.ok(planGift(read({ from }), plan({ amount: 500 })).writes);
    const next = planGift(read({ from }), plan({ amount: 5_000, senderDay: "2026-10-16" })).writes!;
    assert.deepEqual([next.from.giftsSentToday, next.from.giftsSentOn], [5_000, "2026-10-16"]);
  });

  it("caps what is received on the UTC day", () => {
    const to = player("b", { giftsReceivedToday: 9_500, giftsReceivedOn: "2026-10-15" });
    assert.equal(code(() => planGift(read({ to }), plan({ amount: 600 }))), "OVER_RECEIVE_CAP");
    assert.ok(planGift(read({ to }), plan({ amount: 600, utcDay: "2026-10-16" })).writes);
  });

  it("never takes the sender below the bailout floor", () => {
    const from = player("a", { balance: 1_400 });
    assert.equal(code(() => planGift(read({ from }), plan({ amount: 1_000 }))), "BELOW_FLOOR");
    assert.equal(planGift(read({ from }), plan({ amount: 900 })).writes!.from.balance, 500);
  });
});

describe("the big-win feed", () => {
  it("needs 20× the stake and 5,000 chips back", () => {
    assert.equal(isBigWin(200, 7_200), true); // 35:1 straight up
    assert.equal(isBigWin(250, 4_999), false);
    assert.equal(isBigWin(1_000, 19_999), false);
    assert.equal(isBigWin(1_000, 20_000), true);
    assert.equal(isBigWin(0, 10_000), false);
  });

  const game = defineGame({
    name: "Coin flip",
    engine: coinflip,
    bets: z.object({ main: z.number() }),
    action: z.object({ type: z.enum(["double", "heads", "tails"]) }),
    limits: { min: 10, max: 5000, step: 10 },
    label: (f) => (f.landed === "H" ? "Heads" : null),
  });
  const settle = (main: number, rng = { int: () => 1 }) =>
    planStart(
      { player: player("u1"), hand: null, activeHandId: null, gameStats: null, weeklyStats: null },
      {
        userId: "u1",
        handId: "h1",
        gameId: "coinflip",
        game,
        variant: "longshot",
        dealt: coinflip.deal({ main }, rng, "longshot"),
        now: NOW,
        week: "2026-W42",
      },
    ).writes!;

  it("writes an event in the settlement, named and labelled", () => {
    const w = settle(200);
    assert.deepEqual(w.feed, [
      {
        handId: "h1",
        kind: "big_win",
        userId: "u1",
        displayName: "U1",
        game: "coinflip",
        variant: "longshot",
        wagered: 200,
        amount: 7_200,
        multiplier: 36,
        handLabel: "Heads",
        createdAt: NOW,
        expiresAt: "2026-10-22T12:00:00.000Z",
      },
    ]);
    assert.deepEqual(settle(100).feed, [], "3,600 back is under 5,000");
    assert.deepEqual(settle(200, { int: () => 0 }).feed, [], "a loss");
  });

  it("shows a hidden player as 'A player'", () => {
    const [e] = settle(200).feed;
    assert.equal(toFeedEventRow({ ...e, listed: false }, "Coin flip").display_name, HIDDEN_NAME);
    assert.equal(toFeedEventRow({ ...e, listed: true }, "Coin flip").display_name, "U1");
    assert.equal(toFeedEventRow({ ...e, listed: true }, "Coin flip").id, "h1:big_win");
  });

  it("labels real hands from their facts", () => {
    const label = (g: string, facts: Record<string, string | number | boolean>) => handLabel(GAMES[g], facts);
    assert.equal(label("roulette", { straightUp: true, pocket: "17", color: "black" }), "Straight up 17");
    assert.equal(label("roulette", { straightUp: false, pocket: "17", color: "black" }), "Roulette");
    assert.equal(label("videopoker", { handRank: "royal_flush" }), "Royal flush");
    assert.equal(label("uth", { handRank: "flush", tripsHand: "royal_flush" }), "Royal flush on Trips");
    assert.equal(label("blackjack", { suitedTrips: true, blackjack: true }), "Suited trips on 21+3");
    assert.equal(label("slots", { freeSpins: false, fiveOfAKind: true }), "Five of a kind");
    assert.equal(label("baccarat", { tieWon: true, total: 6 }), "Tie on 6");
    assert.equal(label("threecard", { handRank: "straight_flush" }), "Straight flush");
  });

  it("deals a real straight-up win into the feed", () => {
    // Every pocket lands on 17 with this rng; the straight-up 17 pays 35:1.
    const roulette = GAMES.roulette;
    const bets = [{ kind: "straight", numbers: [17], amount: 200 }];
    const rng = { int: (n: number) => (n === 37 ? 17 : 0) };
    const w = planStart(
      { player: player("u1"), hand: null, activeHandId: null, gameStats: null, weeklyStats: null },
      {
        userId: "u1",
        handId: "h2",
        gameId: "roulette",
        game: roulette,
        variant: "european",
        dealt: roulette.engine.deal(bets, rng, "european"),
        now: NOW,
        week: "2026-W42",
      },
    ).writes!;
    assert.equal(w.hand.returned, 7_200);
    assert.deepEqual(
      w.feed.map((e) => [e.handLabel, e.amount, e.multiplier]),
      [["Straight up 17", 7_200, 36]],
    );
  });
});

describe("leaderboards", () => {
  const entry = (userId: string, value: number): BoardEntry => ({ userId, displayName: userId, email: "x@example.com", xp: 400, value });

  it("ranks ties together, as 1 + the players above", () => {
    const rows = rankRows([entry("a", 500), entry("b", 300), entry("c", 300), entry("d", -20)]);
    assert.deepEqual(
      rows.map((r) => [r.user_id, r.rank, r.level]),
      [
        ["a", 1, 3],
        ["b", 2, 3],
        ["c", 2, 3],
        ["d", 4, 3],
      ],
    );
  });

  it("steps ISO weeks across year ends", () => {
    assert.equal(shiftWeek("2026-W42", -1), "2026-W41");
    assert.equal(shiftWeek("2026-W01", -1), "2025-W52");
    assert.equal(shiftWeek("2026-W53", 1), "2027-W01");
    assert.equal(shiftWeek("2021-W01", -1), "2020-W53");
    for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2030, 0, 1); t += 3 * 86_400_000) {
      assert.equal(shiftWeek(isoWeek(new Date(t)), 1), isoWeek(new Date(t + 7 * 86_400_000)));
    }
  });
});

describe("the in-process cache", () => {
  it("serves a load for its lifetime, then loads again", async () => {
    let t = 0;
    let loads = 0;
    const cache = new TtlCache<number>(30_000, () => t);
    const load = async () => ++loads;
    assert.equal(await cache.get("k", load), 1);
    t = 29_999;
    assert.equal(await cache.get("k", load), 1);
    assert.equal(await cache.get("other", load), 2);
    t = 30_000;
    assert.equal(await cache.get("k", load), 3);
    cache.clear();
    assert.equal(await cache.get("k", load), 4);
  });

  it("forgets a failed load, and caches nothing with a ttl of 0", async () => {
    let fail = true;
    const cache = new TtlCache<string>(30_000, () => 0);
    const load = async () => {
      if (fail) throw new Error("down");
      return "ok";
    };
    await assert.rejects(cache.get("k", load));
    fail = false;
    assert.equal(await cache.get("k", load), "ok");

    let n = 0;
    const off = new TtlCache<number>(0, () => 0);
    await off.get("k", async () => ++n);
    await off.get("k", async () => ++n);
    assert.equal(n, 2);
  });
});
