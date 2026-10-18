import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { coinflip } from "../games/coinflip.testkit.js";
import { seededRng } from "../games/rng.js";
import { slots } from "../games/slots/engine.js";
import { newPlayer } from "./economy.js";
import { type HandTxRead, planStart } from "./hands.js";
import { JACKPOT_SEED, JACKPOT_SEED_HUNDREDTHS, jackpotOf, payJackpot, potChips, toJackpotResponse } from "./jackpot.js";
import { defineGame } from "./registry.js";

/**
 * The jackpot's rules, pure. The contract test runs them through both repos,
 * concurrently, and checks nothing is lost or paid twice.
 */

const game = defineGame({
  name: "Coin flip",
  engine: coinflip,
  bets: z.object({ main: z.number(), hit: z.boolean().optional() }),
  action: z.object({ type: z.enum(["double", "heads", "tails"]) }),
  limits: { min: 10, max: 5000, step: 10 },
});

const NOW = "2026-10-15T12:00:00.000Z";
const HAND = "6f1c2f9e-6c2e-4b9e-9a51-3c4d2b1a0e01";

const read = (): HandTxRead => ({
  player: newPlayer({ userId: "u1", email: "pat@example.com", displayName: "Pat" }, NOW).player,
  hand: null,
  activeHandId: null,
  gameStats: null,
  weeklyStats: null,
});

const start = (variant: string, bets: { main: number; hit?: boolean }) =>
  planStart(read(), {
    userId: "u1",
    handId: HAND,
    gameId: "coinflip",
    game,
    variant,
    // Tails: the hand itself loses, so only the jackpot can pay.
    dealt: coinflip.deal(bets, { int: () => 0 }, variant),
    now: NOW,
    week: "2026-W42",
  });

describe("jackpotOf", () => {
  it("adds 2% of the qualifying stake, in hundredths of a chip, so nothing rounds", () => {
    assert.deepEqual(jackpotOf(5, {}, "x"), { contribution: 10, hit: false, label: "x" });
    assert.deepEqual(jackpotOf(2_000, { jackpotEligible: true }, "x"), { contribution: 4_000, hit: true, label: "x" });
    assert.equal(jackpotOf(0, {}, "x"), null, "a hand that doesn't feed it writes nothing");
    assert.throws(() => jackpotOf(1.5, {}, "x"));
  });

  it("is fed by slots and side bets only", () => {
    const spin = slots.deal({ lineBet: 5, lines: 20 }, seededRng(3), null);
    assert.equal(slots.jackpotStake!(spin), 100);
    const flip = coinflip.deal({ main: 100 }, seededRng(3), "instant");
    assert.equal(coinflip.jackpotStake!(flip), 0);
  });
});

describe("settlement and payJackpot", () => {
  it("leaves a plain hand's writes without a jackpot", () => {
    const out = start("instant", { main: 100 });
    assert.equal(out.writes!.jackpot, null);
    assert.equal(payJackpot(out, JACKPOT_SEED_HUNDREDTHS, NOW), out);
  });

  it("carries a contribution, and pays nothing until a hit", () => {
    const out = start("jackpot", { main: 150 });
    assert.deepEqual(out.writes!.jackpot, { contribution: 300, hit: false, label: "Coin flip" });
    assert.equal(payJackpot(out, JACKPOT_SEED_HUNDREDTHS, NOW), out);
  });

  it("pays the pot plus the hand's own contribution, rounding down, after the hand's rows", () => {
    const out = start("jackpot", { main: 150, hit: true });
    const w = out.writes!;
    assert.equal(w.jackpot!.hit, true);
    assert.equal(out.jackpot, null, "not paid until the pot is read");

    const pot = JACKPOT_SEED_HUNDREDTHS + 1_234_567; // 262,345.67 chips
    const paid = payJackpot(out, pot, NOW);
    const amount = potChips(pot + 300);
    assert.equal(amount, 262_348);
    assert.equal(paid.jackpot, amount);
    assert.equal(paid.player.balance, w.player.balance + amount);
    const entry = paid.writes!.ledger.at(-1)!;
    assert.deepEqual([entry.kind, entry.amount, entry.handId, entry.seq], ["jackpot", amount, HAND, w.player.ledgerSeq + 1]);
    assert.deepEqual(paid.writes!.jackpotHit, {
      handId: HAND,
      userId: "u1",
      displayName: "Pat",
      game: "coinflip",
      variant: "jackpot",
      amount,
      handLabel: "Coin flip",
      createdAt: NOW,
    });
    const event = paid.writes!.feed.find((e) => e.kind === "jackpot")!;
    assert.equal(event.amount, amount);
    assert.equal(event.multiplier, Math.floor((amount / 150) * 100) / 100);
    // The hand's own return is unchanged: the jackpot is on top.
    assert.equal(paid.hand.returned, 0);
    assert.equal(paid.writes!.gameStats!.returned, 0);
  });

  it("pays the same when the transaction is retried", () => {
    const out = start("jackpot", { main: 100, hit: true });
    assert.deepEqual(payJackpot(out, JACKPOT_SEED_HUNDREDTHS + 99, NOW), payJackpot(out, JACKPOT_SEED_HUNDREDTHS + 99, NOW));
  });

  it("refuses a pot below the seed", () => {
    const out = start("jackpot", { main: 100, hit: true });
    assert.throws(() => payJackpot(out, JACKPOT_SEED_HUNDREDTHS - 1, NOW));
  });
});

describe("toJackpotResponse", () => {
  it("shows whole chips, and hides a hidden winner's name", () => {
    const hit = {
      handId: HAND,
      userId: "u1",
      displayName: "Pat",
      game: "slots",
      variant: "classic",
      amount: 300_000,
      handLabel: "Five of a kind",
      createdAt: NOW,
    };
    const res = toJackpotResponse(JACKPOT_SEED_HUNDREDTHS + 199, { ...hit, listed: false }, () => "Slots");
    assert.deepEqual(res, {
      amount: JACKPOT_SEED + 1,
      seed: JACKPOT_SEED,
      rate: 0.02,
      last_hit: { display_name: "A player", game: "slots", game_name: "Slots", amount: 300_000, hand_label: "Five of a kind", created_at: NOW },
    });
    assert.equal(toJackpotResponse(JACKPOT_SEED_HUNDREDTHS, null, String).last_hit, null);
  });
});
