import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BAILOUT_TOP_UP,
  STARTING_BALANCE,
  applyCreditTo,
  bailout,
  currentStreak,
  dailyBonus,
  dayIn,
  displayNameOf,
  newPlayer,
  previousDay,
} from "./economy.js";
import { isoWeek, levelFor, levelProgress, xpForHand, xpForLevel } from "./progress.js";
import type { PlayerRecord } from "./types.js";

const fresh = (over: Partial<PlayerRecord> = {}): PlayerRecord => ({
  ...newPlayer({ userId: "u1", email: "pat@example.com", displayName: "Pat" }, "2026-10-15T12:00:00.000Z").player,
  ...over,
});

describe("days", () => {
  it("reads the calendar day in the player's zone", () => {
    const at = new Date("2026-10-16T03:30:00Z");
    assert.equal(dayIn(at, "UTC"), "2026-10-16");
    assert.equal(dayIn(at, "America/New_York"), "2026-10-15");
    assert.equal(dayIn(at, "Asia/Tokyo"), "2026-10-16");
    assert.equal(dayIn(new Date("2026-10-15T23:30:00Z"), "Pacific/Auckland"), "2026-10-16");
  });

  it("steps back across months, years and leap days", () => {
    assert.equal(previousDay("2026-10-15"), "2026-10-14");
    assert.equal(previousDay("2026-03-01"), "2026-02-28");
    assert.equal(previousDay("2028-03-01"), "2028-02-29");
    assert.equal(previousDay("2027-01-01"), "2026-12-31");
  });
});

describe("new players", () => {
  it("start with the starting balance and an initial_grant entry", () => {
    const { player, entry } = newPlayer({ userId: "u1", email: "pat@example.com", displayName: null }, "2026-10-15T12:00:00.000Z");
    assert.equal(player.balance, STARTING_BALANCE);
    assert.equal(player.ledgerSeq, 1);
    assert.equal(player.displayName, "pat");
    assert.deepEqual(entry, {
      userId: "u1",
      seq: 1,
      kind: "initial_grant",
      amount: STARTING_BALANCE,
      balanceAfter: STARTING_BALANCE,
      handId: null,
      ref: null,
      createdAt: "2026-10-15T12:00:00.000Z",
    });
  });

  it("take a display name from the session, or the email", () => {
    assert.equal(displayNameOf({ email: "a@b.c", displayName: "  Ann  " }), "Ann");
    assert.equal(displayNameOf({ email: "a@b.c", displayName: "  " }), "a");
  });
});

describe("daily bonus", () => {
  it("pays 1,000 on the first day and grows with the streak up to day 7", () => {
    let p = fresh();
    const paid: number[] = [];
    let day = "2026-10-01";
    for (let i = 0; i < 9; i++) {
      const e = dailyBonus(p, day);
      assert.ok(e.ok);
      paid.push(e.amount);
      p = { ...p, ...e.patch };
      day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
    assert.deepEqual(paid, [1000, 2000, 3000, 4000, 5000, 6000, 7000, 7000, 7000]);
    assert.equal(p.dailyStreak, 9);
  });

  it("can be claimed once a day", () => {
    const p = fresh({ dailyStreak: 3, lastDailyOn: "2026-10-15" });
    assert.deepEqual(dailyBonus(p, "2026-10-15"), { ok: false, code: "ALREADY_CLAIMED" });
  });

  it("restarts the streak after a missed day", () => {
    const p = fresh({ dailyStreak: 5, lastDailyOn: "2026-10-13" });
    assert.equal(currentStreak(p, "2026-10-15"), 0);
    const e = dailyBonus(p, "2026-10-15");
    assert.ok(e.ok);
    assert.equal(e.amount, 1000);
    assert.equal(e.patch.dailyStreak, 1);
  });

  it("keeps the streak alive through yesterday", () => {
    const p = fresh({ dailyStreak: 5, lastDailyOn: "2026-10-14" });
    assert.equal(currentStreak(p, "2026-10-15"), 5);
    assert.equal(currentStreak(p, "2026-10-14"), 5);
  });

  it("uses the player's day, so the same instant can be a new day in one zone and not another", () => {
    const p = fresh({ dailyStreak: 1, lastDailyOn: "2026-10-15" });
    const at = new Date("2026-10-16T02:00:00Z");
    assert.equal(dailyBonus(p, dayIn(at, "America/Los_Angeles")).ok, false, "still the 15th in LA");
    assert.equal(dailyBonus(p, dayIn(at, "Europe/London")).ok, true, "the 16th in London");
  });
});

describe("bailout", () => {
  it("tops the balance up to 2,000 while under the floor", () => {
    const e = bailout(fresh({ balance: 120 }), "2026-10-15");
    assert.ok(e.ok);
    assert.equal(e.amount, BAILOUT_TOP_UP - 120);
    assert.deepEqual(e.patch, { lastBailoutOn: "2026-10-15" });
  });

  it("is not available at or above the floor, or twice a day", () => {
    assert.deepEqual(bailout(fresh({ balance: 500 }), "2026-10-15"), { ok: false, code: "NOT_ELIGIBLE" });
    assert.deepEqual(bailout(fresh({ balance: 0, lastBailoutOn: "2026-10-15" }), "2026-10-15"), {
      ok: false,
      code: "ALREADY_CLAIMED",
    });
    assert.ok(bailout(fresh({ balance: 0, lastBailoutOn: "2026-10-14" }), "2026-10-15").ok);
  });
});

describe("applyCreditTo", () => {
  it("moves the balance and writes the matching entry", () => {
    const out = applyCreditTo(fresh(), { kind: "bet", amount: -250, handId: "h1" }, "2026-10-15T13:00:00.000Z")!;
    assert.equal(out.player.balance, STARTING_BALANCE - 250);
    assert.equal(out.player.ledgerSeq, 2);
    assert.equal(out.entry.balanceAfter, out.player.balance);
    assert.equal(out.entry.seq, 2);
    assert.equal(out.entry.handId, "h1");
  });

  it("refuses to go below zero, and fractional chips", () => {
    assert.equal(applyCreditTo(fresh(), { kind: "bet", amount: -10_001 }, "x"), null);
    assert.ok(applyCreditTo(fresh(), { kind: "bet", amount: -10_000 }, "x"));
    assert.throws(() => applyCreditTo(fresh(), { kind: "payout", amount: 1.5 }, "x"));
  });
});

describe("progress", () => {
  it("gives XP logarithmic in the stake", () => {
    assert.equal(xpForHand(0), 10);
    assert.equal(xpForHand(10), 14);
    assert.equal(xpForHand(100), 23);
    assert.ok(xpForHand(100_000) < 70, "one max bet cannot buy levels");
  });

  it("levels on a quadratic curve", () => {
    assert.equal(levelFor(0), 1);
    assert.equal(levelFor(99), 1);
    assert.equal(levelFor(100), 2);
    assert.equal(levelFor(399), 2);
    assert.equal(levelFor(400), 3);
    assert.equal(levelFor(xpForLevel(50)), 50);
    assert.equal(levelFor(xpForLevel(50) - 1), 49);
    assert.deepEqual(levelProgress(150), { level: 2, into: 50, needed: 300 });
  });

  it("names ISO weeks in UTC", () => {
    assert.equal(isoWeek(new Date("2026-10-15T12:00:00Z")), "2026-W42");
    assert.equal(isoWeek(new Date("2026-10-12T00:00:00Z")), "2026-W42", "Monday starts the week");
    assert.equal(isoWeek(new Date("2026-10-11T23:59:59Z")), "2026-W41");
    assert.equal(isoWeek(new Date("2027-01-01T12:00:00Z")), "2026-W53");
    assert.equal(isoWeek(new Date("2025-12-29T12:00:00Z")), "2026-W01");
  });
});
