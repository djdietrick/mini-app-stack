import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chartDays, startOfDay, toStatsResponse } from "./stats.js";
import type { GameStatsRecord } from "./types.js";

const g = (game: string, over: Partial<GameStatsRecord> = {}): GameStatsRecord => ({
  userId: "u1",
  game,
  hands: 10,
  wagered: 1_000,
  returned: 900,
  wins: 4,
  losses: 5,
  pushes: 1,
  biggestWin: 200,
  expectedReturn: 973.4,
  ...over,
});

describe("stats", () => {
  it("totals per-game figures and orders games by hands", () => {
    const res = toStatsResponse([g("roulette"), g("blackjack", { hands: 20, returned: 1_300, biggestWin: 500, expectedReturn: 995.6 })]);
    assert.deepEqual(res.games.map((x) => x.game), ["blackjack", "roulette"]);
    assert.deepEqual(res.total, {
      game: "all",
      hands: 30,
      wagered: 2_000,
      returned: 2_200,
      net: 200,
      wins: 8,
      losses: 10,
      pushes: 2,
      biggest_win: 500,
      expected_return: 1_969,
    });
    assert.equal(res.games[1].net, -100);
    assert.deepEqual(toStatsResponse([]).total.hands, 0);
  });

  it("finds midnight in a zone, across daylight saving changes", () => {
    assert.equal(startOfDay("2026-10-15", "UTC").toISOString(), "2026-10-15T00:00:00.000Z");
    assert.equal(startOfDay("2026-10-15", "America/New_York").toISOString(), "2026-10-15T04:00:00.000Z");
    assert.equal(startOfDay("2026-11-02", "America/New_York").toISOString(), "2026-11-02T05:00:00.000Z");
    assert.equal(startOfDay("2026-03-08", "America/New_York").toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(startOfDay("2026-03-09", "America/New_York").toISOString(), "2026-03-09T04:00:00.000Z");
    assert.equal(startOfDay("2026-10-15", "Asia/Kolkata").toISOString(), "2026-10-14T18:30:00.000Z");
  });

  it("charts one day per point, ending now, from the day the player joined", () => {
    const now = new Date("2026-10-15T15:00:00Z");
    const days = chartDays("7d", "America/New_York", now, new Date("2026-01-01T00:00:00Z"));
    assert.deepEqual(days.map((d) => d.day), ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
    assert.equal(days[0].end.toISOString(), "2026-10-10T04:00:00.000Z");
    assert.equal(days.at(-1)!.end, now);
    // Joined yesterday evening in New York: two days.
    const fresh = chartDays("30d", "America/New_York", now, new Date("2026-10-15T01:00:00Z"));
    assert.deepEqual(fresh.map((d) => d.day), ["2026-10-14", "2026-10-15"]);
    assert.equal(chartDays("90d", "UTC", now, new Date("2020-01-01")).length, 90);
  });
});
