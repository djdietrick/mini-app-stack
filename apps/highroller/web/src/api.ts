/**
 * Thin client for /api. The wire types come straight from the server's domain
 * module, type-only, so zod and the server stay out of the bundle and the SPA
 * and both backends share one definition.
 */
import type { CosmeticKind } from "../../src/domain/catalog.js";
import type {
  AchievementRow,
  Board,
  BoardRow,
  BalancePoint,
  BalanceRange,
  BalanceSeries,
  BuyResponse,
  ClaimResponse,
  CompletionRow,
  EquipResponse,
  FeedEventRow,
  FeedResponse,
  GameStatsRow,
  GiftResponse,
  GiftRow,
  GiftsReceived,
  HandPage,
  HandResponse,
  HandRow,
  JackpotHitRow,
  JackpotResponse,
  LeaderboardResponse,
  LedgerKind,
  LedgerPage,
  LedgerRow,
  LevelRow,
  PlayerRow,
  QuestClaimResponse,
  QuestRow,
  QuestsResponse,
  RewardRow,
  ShopItemRow,
  ShopResponse,
  SocialSettings,
  StatsResponse,
} from "../../src/domain/types.js";

export type {
  AchievementRow,
  Board,
  BoardRow,
  BalancePoint,
  BalanceRange,
  BalanceSeries,
  BuyResponse,
  ClaimResponse,
  CompletionRow,
  CosmeticKind,
  EquipResponse,
  FeedEventRow,
  FeedResponse,
  GameStatsRow,
  GiftResponse,
  GiftRow,
  GiftsReceived,
  HandPage,
  HandResponse,
  HandRow,
  JackpotHitRow,
  JackpotResponse,
  LeaderboardResponse,
  LedgerKind,
  LedgerPage,
  LedgerRow,
  LevelRow,
  PlayerRow,
  QuestClaimResponse,
  QuestRow,
  QuestsResponse,
  RewardRow,
  ShopItemRow,
  ShopResponse,
  SocialSettings,
  StatsResponse,
};

export class ApiError extends Error {
  /** The error code: a string body, or `error.code` when the body carries details. */
  readonly code: string;

  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    const err = (body as { error?: unknown } | null)?.error;
    const code =
      typeof err === "string"
        ? err
        : err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : `HTTP ${status}`;
    super(code);
    this.code = code;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

/** The device's time zone: "today" for the daily bonus is the player's day. */
export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const api = {
  me: () => call<PlayerRow>("GET", `/me?timeZone=${encodeURIComponent(timeZone())}`),
  claimDaily: () => call<ClaimResponse>("POST", "/daily-bonus", { timeZone: timeZone() }),
  claimBailout: () => call<ClaimResponse>("POST", "/bailout", { timeZone: timeZone() }),
  ledger: (cursor?: string) => call<LedgerPage>("GET", `/ledger${cursor ? `?cursor=${cursor}` : ""}`),

  startHand: (input: { id: string; game: string; variant?: string; bets: unknown }) =>
    call<HandResponse>("POST", "/hands", { ...input, timeZone: timeZone() }),
  act: (id: string, action: unknown, version: number) =>
    call<HandResponse>("POST", `/hands/${id}/actions`, { action, version, timeZone: timeZone() }),
  activeHands: () => call<{ hands: HandRow[] }>("GET", "/hands/active"),
  hand: (id: string) => call<HandRow>("GET", `/hands/${id}`),
  hands: (opts: { game?: string; cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.game) q.set("game", opts.game);
    if (opts.cursor) q.set("cursor", opts.cursor);
    if (opts.limit) q.set("limit", String(opts.limit));
    const s = q.toString();
    return call<HandPage>("GET", `/hands${s ? `?${s}` : ""}`);
  },

  stats: () => call<StatsResponse>("GET", "/stats"),
  balanceSeries: (range: BalanceRange) =>
    call<BalanceSeries>("GET", `/stats/balance?range=${range}&timeZone=${encodeURIComponent(timeZone())}`),

  shop: () => call<ShopResponse>("GET", "/shop"),
  buy: (itemId: string) => call<BuyResponse>("POST", `/shop/${itemId}/buy`, { timeZone: timeZone() }),
  equip: (kind: CosmeticKind, itemId: string) => call<EquipResponse>("PUT", "/equipped", { kind, itemId }),

  quests: () => call<QuestsResponse>("GET", `/quests?timeZone=${encodeURIComponent(timeZone())}`),
  claimQuest: (id: string) => call<QuestClaimResponse>("POST", `/quests/${encodeURIComponent(id)}/claim`, { timeZone: timeZone() }),

  leaderboard: (board: Board, week?: string) =>
    call<LeaderboardResponse>("GET", `/leaderboards/${board}${week ? `?week=${encodeURIComponent(week)}` : ""}`),
  setListed: (leaderboardListed: boolean) => call<SocialSettings>("PUT", "/settings", { leaderboardListed }),
  /** `id` is made once per gift by the caller, so a retry after a dropped response sends it once. */
  gift: (input: { id: string; to: { email: string } | { userId: string }; amount: number; message?: string }) =>
    call<GiftResponse>("POST", "/gifts", { ...input, timeZone: timeZone() }),
  giftsReceived: (since?: string) =>
    call<GiftsReceived>("GET", `/gifts/received${since ? `?since=${encodeURIComponent(since)}` : ""}`),
  feed: () => call<FeedResponse>("GET", "/feed?limit=20"),
  jackpot: () => call<JackpotResponse>("GET", "/jackpot"),
};
