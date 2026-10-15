import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "@stack/service-kit";
import { z } from "zod";
import { type CoinflipState, coinflip } from "../games/coinflip.testkit.js";
import { seededRng } from "../games/rng.js";
import { newPlayer } from "./economy.js";
import { type HandTxRead, type HandTxWrites, planAction, planStart, toHandRow } from "./hands.js";
import { xpForHand } from "./progress.js";
import { defineGame } from "./registry.js";
import type { HandRecord, PlayerRecord } from "./types.js";

/**
 * The lifecycle as pure functions: what a hand transaction writes for a given
 * read. The contract test runs the same steps through both repos.
 */

const coinflipGame = defineGame({
  name: "Coin flip",
  engine: coinflip,
  bets: z.object({ main: z.number() }),
  action: z.object({ type: z.enum(["double", "heads", "tails"]) }),
  limits: { min: 10, max: 5000, step: 10 },
});
const games = { coinflip: coinflipGame };

const NOW = "2026-10-15T12:00:00.000Z";
const WEEK = "2026-W42";
const HAND = "6f1c2f9e-6c2e-4b9e-9a51-3c4d2b1a0e01";

const player = (balance = 10_000): PlayerRecord => ({
  ...newPlayer({ userId: "u1", email: "pat@example.com", displayName: "Pat" }, NOW).player,
  balance,
});

const read = (over: Partial<HandTxRead> = {}): HandTxRead => ({
  player: player(),
  hand: null,
  activeHandId: null,
  gameStats: null,
  weeklyStats: null,
  ...over,
});

const start = (r: HandTxRead, opts: { variant?: "call" | "instant"; seed?: number; main?: number } = {}) =>
  planStart(r, {
    userId: "u1",
    handId: HAND,
    gameId: "coinflip",
    game: coinflipGame,
    variant: opts.variant ?? "call",
    dealt: coinflip.deal({ main: opts.main ?? 100 }, seededRng(opts.seed ?? 1), opts.variant ?? "call"),
    now: NOW,
    week: WEEK,
  });

const act = (r: HandTxRead, action: unknown, version: number) =>
  planAction(r, { userId: "u1", handId: HAND, action, version, games, now: NOW, week: WEEK });

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (!isAppError(e)) throw e;
    const d = e.details as { code?: string } | undefined;
    return d?.code ?? e.code;
  }
  throw new Error("did not throw");
}

/** Applies writes to a read, as a repo would, for the next step. */
function after(r: HandTxRead, w: HandTxWrites): HandTxRead {
  return {
    player: w.player,
    hand: w.hand,
    activeHandId: w.hand.status === "active" ? w.hand.id : null,
    gameStats: w.gameStats ?? r.gameStats,
    weeklyStats: w.weeklyStats ?? r.weeklyStats,
  };
}

describe("planStart", () => {
  it("debits the stake and stores an active hand at version 0", () => {
    const out = start(read());
    const w = out.writes!;
    assert.equal(w.player.balance, 9_900);
    assert.deepEqual(
      w.ledger.map((e) => [e.kind, e.amount, e.balanceAfter, e.seq, e.handId]),
      [["bet", -100, 9_900, 2, HAND]],
    );
    assert.equal(w.hand.status, "active");
    assert.equal(w.hand.version, 0);
    assert.equal(w.hand.wagered, 100);
    assert.equal(w.gameStats, null, "no stats until it settles");
  });

  it("computes the same writes when the transaction is retried", () => {
    // The callback a Firestore transaction retries: same read, same answer,
    // because all the randomness was drawn before it.
    const dealt = coinflip.deal({ main: 100 }, seededRng(99), "instant");
    const step = (r: HandTxRead) =>
      planStart(r, { userId: "u1", handId: HAND, gameId: "coinflip", game: coinflipGame, variant: "instant", dealt, now: NOW, week: WEEK });
    const r = read();
    assert.deepEqual(step(r), step(r));
  });

  it("returns the existing hand for a repeated id, with no writes", () => {
    const first = start(read()).writes!;
    const again = start(after(read(), first));
    assert.equal(again.writes, null);
    assert.equal(again.hand.id, HAND);
  });

  it("refuses an id that belongs to someone else's hand", () => {
    const first = start(read()).writes!;
    const theirs = { ...after(read(), first), hand: { ...first.hand, userId: "u2" }, activeHandId: null };
    assert.equal(code(() => start(theirs)), "HAND_ID_TAKEN");
  });

  it("refuses a second active hand in the same game", () => {
    assert.equal(code(() => start(read({ activeHandId: "another" }))), "HAND_IN_PROGRESS");
  });

  it("refuses a stake bigger than the balance", () => {
    assert.equal(code(() => start(read({ player: player(99) }))), "INSUFFICIENT_FUNDS");
    assert.ok(start(read({ player: player(100) })).writes);
  });

  it("settles a single-decision hand in the same writes", () => {
    for (const seed of [1, 2, 3, 4]) {
      const w = start(read(), { variant: "instant", seed }).writes!;
      const won = (w.hand.state as CoinflipState).coins[0] === "H";
      assert.equal(w.hand.status, "settled");
      assert.equal(w.hand.settledAt, NOW);
      assert.equal(w.hand.returned, won ? 200 : 0);
      assert.equal(w.player.balance, won ? 10_100 : 9_900);
      assert.deepEqual(
        w.ledger.map((e) => e.kind),
        won ? ["bet", "payout"] : ["bet"],
      );
      assert.equal(w.ledger.at(-1)!.balanceAfter, w.player.balance);
      assert.equal(w.player.xp, xpForHand(100));
      assert.deepEqual(w.gameStats, {
        userId: "u1",
        game: "coinflip",
        hands: 1,
        wagered: 100,
        returned: won ? 200 : 0,
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
        pushes: 0,
        biggestWin: won ? 100 : 0,
        expectedReturn: 100,
      });
      assert.deepEqual(w.weeklyStats, { week: WEEK, userId: "u1", hands: 1, wagered: 100, net: won ? 100 : -100, biggestWin: won ? 100 : 0 });
    }
  });
});

describe("planAction", () => {
  const dealt = () => after(read(), start(read()).writes!);

  it("debits an extra wager and bumps the version", () => {
    const w = act(dealt(), { type: "double" }, 0).writes!;
    assert.equal(w.hand.version, 1);
    assert.equal(w.hand.wagered, 200);
    assert.equal(w.player.balance, 9_800);
    assert.deepEqual(
      w.ledger.map((e) => [e.kind, e.amount, e.seq]),
      [["bet", -100, 3]],
    );
  });

  it("settles when the engine says the hand is over, and adds onto existing stats", () => {
    let r = dealt();
    r = after(r, act(r, { type: "double" }, 0).writes!);
    const coin = (r.hand!.state as CoinflipState).coins[0];
    r = { ...r, gameStats: { userId: "u1", game: "coinflip", hands: 4, wagered: 400, returned: 300, wins: 1, losses: 3, pushes: 0, biggestWin: 500, expectedReturn: 400 } };
    const w = act(r, { type: coin === "H" ? "heads" : "tails" }, 1).writes!;
    assert.equal(w.hand.status, "settled");
    assert.equal(w.hand.version, 2);
    assert.equal(w.hand.returned, 400);
    assert.equal(w.player.balance, 10_200);
    assert.equal(w.gameStats!.hands, 5);
    assert.equal(w.gameStats!.wagered, 600);
    assert.equal(w.gameStats!.biggestWin, 500, "keeps the bigger earlier win");
    assert.deepEqual(w.hand.results, [{ spot: "main", stake: 200, returned: 400, outcome: "win" }]);
  });

  it("answers a stale version with 409 STALE_HAND", () => {
    const r = dealt();
    assert.equal(code(() => act(r, { type: "heads" }, 1)), "STALE_HAND");
  });

  it("refuses illegal and malformed actions", () => {
    let r = dealt();
    r = after(r, act(r, { type: "double" }, 0).writes!);
    assert.equal(code(() => act(r, { type: "double" }, 1)), "ILLEGAL_ACTION");
    assert.equal(code(() => act(r, { type: "split" }, 1)), "BAD_ACTION");
    const settled = after(r, act(r, { type: "heads" }, 1).writes!);
    assert.equal(code(() => act(settled, { type: "heads" }, 2)), "ILLEGAL_ACTION");
  });

  it("refuses a double the balance cannot cover", () => {
    const r = after(read({ player: player(150) }), start(read({ player: player(150) })).writes!);
    assert.equal(code(() => act(r, { type: "double" }, 0)), "INSUFFICIENT_FUNDS");
  });

  it("does not find someone else's hand", () => {
    const r = dealt();
    assert.equal(code(() => act({ ...r, hand: { ...r.hand!, userId: "u2" } }, { type: "heads" }, 0)), "not found");
  });
});

describe("toHandRow", () => {
  it("sends the view and the legal actions, never the state", () => {
    const hand: HandRecord = start(read()).hand;
    const row = toHandRow(hand, games);
    assert.deepEqual(row.legal_actions, ["double", "heads", "tails"]);
    assert.ok(!("state" in row));
    assert.ok(!JSON.stringify(row).includes("coins"));
  });
});
