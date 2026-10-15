/**
 * XP and levels. Levels are a badge only: they show how much you have
 * played and unlock nothing. Level is a pure function of XP, so the curve can
 * be retuned without migrating anything.
 */

/**
 * XP for one settled hand. Logarithmic in the stake, so playing counts for
 * more than bet size and one max bet cannot buy levels.
 */
export function xpForHand(wagered: number): number {
  return 10 + Math.floor(4 * Math.log2(1 + Math.max(0, wagered) / 10));
}

/** XP needed to reach level `n` (quadratic): level 2 at 100, 3 at 400, 10 at 8,100. */
export function xpForLevel(n: number): number {
  return 100 * (n - 1) ** 2;
}

export function levelFor(xp: number): number {
  let n = Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
  // Guard the float edge at exact thresholds.
  while (xpForLevel(n + 1) <= xp) n++;
  while (n > 1 && xpForLevel(n) > xp) n--;
  return n;
}

export function levelProgress(xp: number): { level: number; into: number; needed: number } {
  const level = levelFor(xp);
  const base = xpForLevel(level);
  return { level, into: xp - base, needed: xpForLevel(level + 1) - base };
}

/** ISO 8601 week in UTC, e.g. "2026-W42". Leaderboard weeks start Monday 00:00 UTC. */
export function isoWeek(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  // The Thursday of this week decides the year.
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
