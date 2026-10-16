import { dayIn, previousDay } from "./economy.js";
import type { BalanceRange, GameStatsRecord, GameStatsRow, StatsResponse } from "./types.js";

/**
 * The stats dashboard's figures, from what settlement already folds into
 * game_stats, and the day boundaries the balance chart samples the ledger at.
 */

export function toGameStatsRow(game: string, g: Omit<GameStatsRecord, "userId" | "game">): GameStatsRow {
  return {
    game,
    hands: g.hands,
    wagered: g.wagered,
    returned: g.returned,
    net: g.returned - g.wagered,
    wins: g.wins,
    losses: g.losses,
    pushes: g.pushes,
    biggest_win: g.biggestWin,
    expected_return: Math.round(g.expectedReturn),
  };
}

export function toStatsResponse(rows: readonly GameStatsRecord[]): StatsResponse {
  const total = rows.reduce(
    (t, g) => ({
      hands: t.hands + g.hands,
      wagered: t.wagered + g.wagered,
      returned: t.returned + g.returned,
      wins: t.wins + g.wins,
      losses: t.losses + g.losses,
      pushes: t.pushes + g.pushes,
      biggestWin: Math.max(t.biggestWin, g.biggestWin),
      expectedReturn: t.expectedReturn + g.expectedReturn,
    }),
    { hands: 0, wagered: 0, returned: 0, wins: 0, losses: 0, pushes: 0, biggestWin: 0, expectedReturn: 0 },
  );
  return {
    total: toGameStatsRow("all", total),
    games: [...rows].sort((a, b) => b.hands - a.hands || a.game.localeCompare(b.game)).map((g) => toGameStatsRow(g.game, g)),
  };
}

export const RANGE_DAYS: Record<BalanceRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** The offset of `timeZone` from UTC at `at`, in milliseconds (positive east of Greenwich). */
function offsetAt(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return wall - Math.floor(at / 1000) * 1000;
}

/** The instant a calendar day ("YYYY-MM-DD") begins in `timeZone`. */
export function startOfDay(day: string, timeZone: string): Date {
  const wall = Date.parse(`${day}T00:00:00Z`);
  // Two passes settle the offset across a DST change.
  let at = wall - offsetAt(wall, timeZone);
  at = wall - offsetAt(at, timeZone);
  return new Date(at);
}

const nextDay = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * The days a balance chart covers, oldest first, ending today in the
 * player's zone, each with the instant it ends (today's is `now`): the
 * balance at that instant is the day's point. Days before the player joined
 * are left out.
 */
export function chartDays(range: BalanceRange, timeZone: string, now: Date, joined: Date): { day: string; end: Date }[] {
  const today = dayIn(now, timeZone);
  const first = dayIn(joined, timeZone);
  const days: string[] = [today];
  while (days.length < RANGE_DAYS[range] && days[0] > first) days.unshift(previousDay(days[0]));
  return days.map((day) => ({ day, end: day === today ? now : startOfDay(nextDay(day), timeZone) }));
}
