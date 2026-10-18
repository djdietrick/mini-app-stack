import type { HandSummary } from "../games/engine.js";
import { levelFor } from "./progress.js";
import type { BoardEntry, BoardRow, FeedEventRecord, FeedEventRow, PlayerRecord } from "./types.js";

/**
 * The social rules, pure: public names, the big-win threshold and the feed
 * event it writes, leaderboard ranks, and the small in-process cache the
 * boards and the feed are served from.
 */

/** How many rows a board shows. Your own row comes on top of these. */
export const BOARD_SIZE = 50;
export const BOARD_CACHE_MS = 30_000;
export const FEED_CACHE_MS = 10_000;
export const FEED_RETENTION_DAYS = 7;
/** A win makes the feed when it returns at least this many times the stake… */
export const BIG_WIN_MULTIPLE = 20;
/** …and at least this many chips. */
export const BIG_WIN_MIN = 5_000;
/** How the feed shows a player hidden from the leaderboards. */
export const HIDDEN_NAME = "A player";

/**
 * The name other players see. Never an email: a player whose name was taken
 * from their email (economy.ts `displayNameOf` falls back to the part before
 * the @) shows as "Player" and four characters of a hash of their id.
 */
export function publicName(p: Pick<PlayerRecord, "userId" | "displayName" | "email">): string {
  const local = p.email.split("@")[0] ?? "";
  if (p.displayName && p.displayName !== local && !p.displayName.includes("@")) return p.displayName;
  return `Player ${hash4(p.userId)}`;
}

/** FNV-1a, last four hex digits, upper case. Stable, and needs no Node API. */
function hash4(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(-4).toUpperCase();
}

// ---------- feed ----------

export const isBigWin = (wagered: number, returned: number) =>
  wagered > 0 && returned >= BIG_WIN_MIN && returned >= BIG_WIN_MULTIPLE * wagered;

/** The feed event for a settled hand, or null when the win isn't big enough. */
export function bigWinEvent(
  player: PlayerRecord,
  hand: { id: string },
  summary: HandSummary,
  handLabel: string,
  now: string,
): FeedEventRecord | null {
  if (!isBigWin(summary.wagered, summary.returned)) return null;
  return {
    handId: hand.id,
    kind: "big_win",
    userId: player.userId,
    displayName: publicName(player),
    game: summary.game,
    variant: summary.variant,
    wagered: summary.wagered,
    amount: summary.returned,
    multiplier: Math.floor((summary.returned / summary.wagered) * 100) / 100,
    handLabel,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + FEED_RETENTION_DAYS * 86_400_000).toISOString(),
  };
}

export function toFeedEventRow(e: FeedEventRecord & { listed: boolean }, gameName: string): FeedEventRow {
  return {
    id: `${e.handId}:${e.kind}`,
    kind: e.kind,
    display_name: e.listed ? e.displayName : HIDDEN_NAME,
    game: e.game,
    game_name: gameName,
    variant: e.variant,
    wagered: e.wagered,
    amount: e.amount,
    multiplier: e.multiplier,
    hand_label: e.handLabel,
    created_at: e.createdAt,
  };
}

const HAND_NAMES: Record<string, string> = {
  royal_flush: "Royal flush",
  straight_flush: "Straight flush",
  quads: "Four of a kind",
  full_house: "Full house",
  flush: "Flush",
  straight: "Straight",
  trips: "Three of a kind",
  two_pair: "Two pair",
  pair: "Pair",
  jacks_or_better: "Jacks or better",
};

/** A poker hand category ("royal_flush") as the feed shows it, or null for nothing worth naming. */
export const handName = (category: unknown): string | null =>
  typeof category === "string" ? (HAND_NAMES[category] ?? null) : null;

// ---------- leaderboards ----------

/**
 * Board rows from entries already ordered best first. Equal figures share a
 * rank, which is 1 + the number of listed players strictly above: the same
 * rule the repo's count gives your own row.
 */
export function rankRows(entries: readonly BoardEntry[]): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const [i, e] of entries.entries()) {
    const prev = rows[i - 1];
    rows.push({
      rank: prev && prev.value === e.value ? prev.rank : i + 1,
      user_id: e.userId,
      display_name: publicName(e),
      value: e.value,
      level: levelFor(e.xp),
    });
  }
  return rows;
}

/** Best first; ties by user id so both backends agree. */
export const byValue = (a: BoardEntry, b: BoardEntry) => b.value - a.value || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

// ---------- cache ----------

/**
 * A small time-boxed cache in process, like the auth client's 5 s session
 * cache: the boards and the feed change slowly and every lobby asks for them.
 * Each Function instance or server keeps its own. A ttl of 0 turns it off.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
    private readonly maxEntries = 100,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) return load();
    const t = this.now();
    const hit = this.entries.get(key);
    if (hit && t - hit.at < this.ttlMs) return hit.value;
    const value = load();
    // A failed load is not remembered.
    value.catch(() => this.entries.get(key)?.value === value && this.entries.delete(key));
    this.entries.delete(key);
    this.entries.set(key, { at: t, value });
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
