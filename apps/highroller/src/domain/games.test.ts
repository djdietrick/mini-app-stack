import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { isAppError } from "@stack/service-kit";
import { type BlackjackState, dealFrom } from "../games/blackjack/index.js";
import type { Card } from "../games/cards.js";
import { seededRng } from "../games/rng.js";
import { DOUBLE_ZERO, validBets } from "../games/roulette/engine.js";
import type { ThreeCardState } from "../games/threecard/index.js";
import type { UthState } from "../games/uth/index.js";
import type { VideoPokerState } from "../games/videopoker/index.js";
import { botAction } from "./bots.testkit.js";
import { newPlayer } from "./economy.js";
import { type HandTxRead, planAction, planStart, toHandRow } from "./hands.js";
import { GAMES } from "./registry.js";
import type { HandRecord, PlayerRecord } from "./types.js";

/**
 * Every game through the real registry and the pure lifecycle steps:
 * the request schemas the SPA's bodies must pass, and many hands played the
 * way the routes play them, with the state round-tripped through JSON between
 * steps as the repos store it. Chips must balance to the ledger, and nothing
 * private may reach a wire row while the hand is live.
 */

const NOW = "2026-10-15T12:00:00.000Z";
const WEEK = "2026-W42";

describe("the registry's request schemas", () => {
  it("accepts what the SPA sends", () => {
    assert.ok(GAMES.blackjack.bets.safeParse({ main: 25 }).success);
    assert.ok(GAMES.blackjack.action.safeParse({ type: "double" }).success);
    assert.ok(GAMES.uth.bets.safeParse({ ante: 25 }).success);
    assert.ok(GAMES.uth.action.safeParse({ type: "bet4" }).success);
    assert.ok(GAMES.roulette.bets.safeParse([{ kind: "split", numbers: [0, DOUBLE_ZERO], amount: 5 }]).success);
    assert.ok(GAMES.baccarat.bets.safeParse({ banker: 25, tie: 5 }).success);
    assert.ok(GAMES.threecard.bets.safeParse({ ante: 25, pairPlus: 5 }).success);
    assert.ok(GAMES.threecard.action.safeParse({ type: "play" }).success);
    assert.ok(GAMES.videopoker.bets.safeParse({ coins: 5, coinValue: 25 }).success);
    assert.ok(GAMES.videopoker.action.safeParse({ type: "draw", hold: [true, false, false, true, false] }).success);
    assert.ok(GAMES.slots.bets.safeParse({ lineBet: 5, lines: 20 }).success);
  });

  it("takes the side bets, and refuses unknown spots and anything that isn't an action", () => {
    assert.ok(GAMES.blackjack.bets.safeParse({ main: 25, perfectPairs: 5, twentyOnePlusThree: 10 }).success);
    assert.ok(GAMES.uth.bets.safeParse({ ante: 25, trips: 5 }).success);
    assert.ok(!GAMES.blackjack.bets.safeParse({ main: 25, luckyLadies: 5 }).success);
    assert.ok(!GAMES.uth.bets.safeParse({ ante: 25, pairPlus: 5 }).success);
    assert.ok(!GAMES.blackjack.action.safeParse({ type: "peek" }).success);
    assert.ok(!GAMES.roulette.bets.safeParse([]).success);
    assert.ok(!GAMES.roulette.bets.safeParse([{ kind: "straight", numbers: [38], amount: 5 }]).success);
    assert.ok(!GAMES.baccarat.bets.safeParse({ dragon: 5 }).success);
    assert.ok(!GAMES.videopoker.action.safeParse({ type: "draw", hold: [true] }).success);
    assert.ok(!GAMES.videopoker.action.safeParse({ type: "draw" }).success);
    assert.ok(!GAMES.threecard.action.safeParse({ type: "check" }).success);
  });
});

function betsFor(game: string, i: number, variant: string | null): unknown {
  // Side bets on some hands, so early payouts and their ledger rows are exercised.
  if (game === "blackjack") return { main: 10 + 5 * (i % 7), ...(i % 2 ? { perfectPairs: 5, twentyOnePlusThree: 10 } : {}) };
  if (game === "uth") return { ante: 10 + 5 * (i % 3), ...(i % 3 === 0 ? { trips: 5 } : {}) };
  if (game === "baccarat") return [{ player: 10 }, { banker: 15 }, { tie: 10 }, { player: 20, tie: 5 * 2 }][i % 4];
  if (game === "threecard") return { ante: 10 + 5 * (i % 3), ...(i % 2 ? { pairPlus: 5 } : {}) };
  if (game === "videopoker") return { coins: 1 + (i % 5), coinValue: [5, 25, 100][i % 3] };
  if (game === "slots") return { lineBet: [1, 5, 25][i % 3], lines: i % 4 ? 20 : 1 + (i % 20) };
  const spots = validBets(variant as "european" | "american");
  return [0, 1, 2].map((k) => {
    const b = spots[(i * 7 + k * 31) % spots.length];
    return { kind: b.kind, numbers: b.numbers, amount: 5 * (k + 1) };
  });
}

/**
 * Strings a live hand's wire row must never contain. Blackjack's six decks
 * repeat cards, so there it is the shoe itself (the hole card is checked in
 * blackjack.test.ts); UTH's one deck doesn't, so there it is every unseen card.
 */
function hidden(game: string, state: unknown): string[] {
  if (game === "blackjack") return (state as BlackjackState).phase === "done" ? [] : ['"shoe"', '"next"'];
  if (game === "uth") {
    const s = state as UthState;
    const unseen = [...s.dealer, ...s.board.slice(s.street === "preflop" ? 0 : s.street === "flop" ? 3 : 5)];
    return s.street === "done" ? [] : unseen.map((c) => JSON.stringify(c));
  }
  if (game === "threecard") {
    const s = state as ThreeCardState;
    return s.done ? [] : s.dealer.map((c) => JSON.stringify(c));
  }
  if (game === "videopoker") {
    const s = state as VideoPokerState;
    // The replacements; once drawn, only those never used.
    const used = s.held ? s.held.filter((h) => !h).length : 0;
    return s.cards.slice(5 + used).map((c) => JSON.stringify(c));
  }
  return [];
}

for (const [gameId, game] of Object.entries(GAMES)) {
  describe(`${game.name} through the lifecycle`, () => {
    it("balances every chip to the ledger and keeps private state off the wire", () => {
      const rng = seededRng(2026);
      let player: PlayerRecord = newPlayer({ userId: "u1", email: "pat@example.com", displayName: "Pat" }, NOW).player;
      const start = player.balance;
      let wagered = 0;
      let returned = 0;
      let ledgerSum = 0;

      for (let i = 0; i < 200; i++) {
        const variant = game.engine.variants ? game.engine.variants[i % game.engine.variants.length] : null;
        const bets = game.bets.parse(betsFor(gameId, i, variant));
        assert.equal(game.engine.validateBets(bets, game.limits, variant), null);
        const id = randomUUID();
        const read = (hand: HandRecord | null): HandTxRead => ({ player, hand, activeHandId: null, gameStats: null, weeklyStats: null });

        let out = planStart(read(null), {
          userId: "u1",
          handId: id,
          gameId,
          game,
          variant,
          dealt: game.engine.deal(bets, rng, variant),
          now: NOW,
          week: WEEK,
        });
        for (let n = 0; ; n++) {
          assert.ok(n < 30, "hand never finished");
          player = out.player;
          ledgerSum += out.writes!.ledger.reduce((s, e) => s + e.amount, 0);
          // The repos store state as JSON; the next step must work from that.
          const stored: HandRecord = JSON.parse(JSON.stringify(out.hand));
          const row = JSON.stringify(toHandRow(stored, GAMES));
          for (const secret of hidden(gameId, stored.state)) assert.ok(!row.includes(secret), `${secret} on the wire`);
          if (stored.status === "settled") {
            wagered += stored.wagered;
            returned += stored.returned;
            assert.equal(stored.returned, stored.results!.reduce((s, r) => s + r.returned, 0));
            break;
          }
          const legal = game.engine.legalActions(stored.state);
          const action = botAction(gameId, stored.state, legal);
          out = planAction(read(stored), { userId: "u1", handId: id, action, version: stored.version, games: GAMES, now: NOW, week: WEEK });
        }
      }

      assert.equal(player.balance, start - wagered + returned);
      assert.equal(ledgerSum, returned - wagered);
      assert.ok(wagered > 0);
    });

    it("refuses an action that isn't legal now", () => {
      const variant = game.engine.variants?.[0] ?? null;
      const bets = game.bets.parse(betsFor(gameId, 0, variant));
      const id = randomUUID();
      const player = newPlayer({ userId: "u1", email: "pat@example.com", displayName: "Pat" }, NOW).player;
      const started = planStart(
        { player, hand: null, activeHandId: null, gameStats: null, weeklyStats: null },
        { userId: "u1", handId: id, gameId, game, variant, dealt: game.engine.deal(bets, seededRng(1), variant), now: NOW, week: WEEK },
      );
      // Seed 1 deals blackjack a plain hand against a non-ace: even money isn't on offer. Three Card
      // Poker and video poker allow every well-formed action on the deal, so they are asked again once done.
      let hand = started.hand;
      let illegal: unknown = { type: gameId === "uth" ? "bet1" : gameId === "blackjack" ? "even_money" : "spin" };
      if (gameId === "threecard" || gameId === "videopoker") {
        illegal = botAction(gameId, hand.state, game.engine.legalActions(hand.state));
        hand = planAction(
          { player: started.player, hand, activeHandId: null, gameStats: null, weeklyStats: null },
          { userId: "u1", handId: id, action: illegal, version: hand.version, games: GAMES, now: NOW, week: WEEK },
        ).hand;
        assert.equal(hand.status, "settled");
      }
      let code = "";
      try {
        planAction(
          { player: started.player, hand, activeHandId: null, gameStats: null, weeklyStats: null },
          { userId: "u1", handId: id, action: illegal, version: hand.version, games: GAMES, now: NOW, week: WEEK },
        );
      } catch (e) {
        if (!isAppError(e)) throw e;
        code = e.code;
      }
      assert.equal(code, "ILLEGAL_ACTION");
    });
  });
}

describe("side bets through the lifecycle", () => {
  it("pays blackjack's side bets in the start transaction, and only the rest at settlement", () => {
    const player = newPlayer({ userId: "u1", email: "pat@example.com", displayName: "Pat" }, NOW).player;
    const id = randomUUID();
    // You 8h 8d (a coloured pair, 12:1), dealer 9d Ts; twos after.
    const dealt = dealFrom([..."8h 9d 8d Ts".split(" "), ...Array(40).fill("2c")] as Card[], { main: 100, perfectPairs: 10, twentyOnePlusThree: 10 });
    const started = planStart(
      { player, hand: null, activeHandId: null, gameStats: null, weeklyStats: null },
      { userId: "u1", handId: id, gameId: "blackjack", game: GAMES.blackjack, variant: null, dealt, now: NOW, week: WEEK },
    );
    assert.deepEqual(started.writes!.ledger.map((e) => [e.kind, e.amount]), [["bet", -120], ["payout", 130]]);
    assert.equal(started.player.balance, player.balance - 120 + 130);
    assert.equal(started.hand.status, "active");

    const done = planAction(
      { player: started.player, hand: started.hand, activeHandId: id, gameStats: null, weeklyStats: null },
      { userId: "u1", handId: id, action: { type: "stand" }, version: 0, games: GAMES, now: NOW, week: WEEK },
    );
    // 16 against 19: the main bet loses, so settlement has nothing left to pay.
    assert.equal(done.hand.status, "settled");
    assert.equal(done.hand.returned, 130);
    assert.deepEqual(done.writes!.ledger, []);
    assert.equal(done.player.balance, player.balance - 120 + 130);
    assert.equal(done.writes!.gameStats!.returned, 130);
  });
});
