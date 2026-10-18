import {
  type AnyRoute,
  type SessionUser,
  badRequest,
  conflict,
  createRouteBuilder,
  forbidden,
  notFound,
} from "@stack/service-kit";
import type { Rng } from "../games/rng.js";
import type { HighrollerRepo } from "../repo/types.js";
import {
  BAILOUT_FLOOR,
  BAILOUT_TOP_UP,
  type Eligibility,
  GIFT_MIN,
  GIFT_RECEIVE_LIMIT,
  GIFT_SEND_LIMIT,
  bailout,
  bonusFor,
  currentStreak,
  dailyBonus,
  dayIn,
  planGift,
  sentOn,
} from "./economy.js";
import { CATALOG, shopItem } from "./catalog.js";
import { decodeHandCursor, encodeHandCursor, planAction, planStart, type QuestKey, toHandRow } from "./hands.js";
import { JACKPOT_CACHE_MS, toJackpotResponse } from "./jackpot.js";
import { levelFor, levelProgress, isoWeek, shiftWeek } from "./progress.js";
import {
  type ActiveQuest,
  type Completion,
  QUESTS,
  type QuestPool,
  activeQuests,
  isoWeekOfDay,
  planClaim,
  tiersDone,
} from "./quests.js";
import { GAMES, type GameRegistry } from "./registry.js";
import { planPurchase, toShopItemRow } from "./shop.js";
import {
  BOARD_CACHE_MS,
  BOARD_SIZE,
  FEED_CACHE_MS,
  TtlCache,
  byValue,
  publicName,
  rankRows,
  toFeedEventRow,
} from "./social.js";
import { chartDays, startOfDay, toStatsResponse } from "./stats.js";
import {
  type AchievementRow,
  type BalanceSeries,
  type BoardRow,
  type BuyResponse,
  type ClaimResponse,
  type CompletionRow,
  type EquipResponse,
  type FeedResponse,
  type GiftResponse,
  type GiftsReceived,
  type HandPage,
  type HandResponse,
  type HandRow,
  type JackpotResponse,
  type LeaderboardResponse,
  type LedgerPage,
  type LevelRow,
  type PlayerRecord,
  type PlayerRow,
  type QuestClaimResponse,
  type QuestProgressRecord,
  type QuestRow,
  type QuestsResponse,
  type ShopResponse,
  type SocialSettings,
  type StatsResponse,
  actionInput,
  boardParam,
  boardQuery,
  claimInput,
  equipInput,
  feedQuery,
  giftInput,
  giftsReceivedQuery,
  handIdParam,
  handsQuery,
  itemIdParam,
  ledgerQuery,
  meQuery,
  questClaimInput,
  questIdParam,
  questsQuery,
  socialSettingsInput,
  startHandInput,
  statsBalanceQuery,
  toGiftRow,
  toLedgerRow,
} from "./types.js";

/**
 * Every Highroller endpoint, transport-free. The same table is served by
 * Fastify self-hosted and by an Express-backed Firebase Function in the cloud.
 *
 * `ctx.scope` is the caller's player, created on their first request by
 * `resolveHighrollerScope` (wire it as the adapters' `resolveScope`). It is a
 * snapshot for reads; anything that changes a balance re-reads the player
 * inside its transaction.
 */
const route = createRouteBuilder<HighrollerRepo, PlayerRecord>();

export interface HighrollerRouteDeps {
  /** Production: cryptoRng (src/cryptoRng.ts), injected by the entrypoint. */
  rng: Rng;
  /** The games on offer. Defaults to the registry; tests pass their own. */
  games?: GameRegistry;
  /** The quest pools and achievements. Defaults to quests.ts; tests pass their own. */
  quests?: QuestPool;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Rows per leaderboard (social.ts BOARD_SIZE); tests pass a few. */
  boardSize?: number;
  /** In-process cache lifetimes for the boards, the feed and the jackpot; 0 turns caching off (tests). */
  cacheMs?: { boards: number; feed: number; jackpot?: number };
}

export const resolveHighrollerScope = (user: SessionUser, repo: HighrollerRepo) => repo.ensurePlayer(user);

export function toLevelRow(xp: number): LevelRow {
  const lv = levelProgress(xp);
  return { level: lv.level, level_xp: lv.into, level_xp_needed: lv.needed };
}

const toCompletionRow = (c: Completion): CompletionRow => ({ quest_id: c.questId, kind: c.kind, text: c.text, tier: c.tier });

export function toPlayerRow(p: PlayerRecord, today: string): PlayerRow {
  const daily = dailyBonus(p, today);
  const streak = currentStreak(p, today);
  const bail = bailout(p, today);
  return {
    user_id: p.userId,
    display_name: p.displayName,
    balance: p.balance,
    xp: p.xp,
    ...toLevelRow(p.xp),
    daily: { available: daily.ok, streak, amount: daily.ok ? daily.amount : bonusFor(streak) },
    bailout: {
      available: bail.ok,
      claimed_today: !bail.ok && bail.code === "ALREADY_CLAIMED",
      floor: BAILOUT_FLOOR,
      top_up_to: BAILOUT_TOP_UP,
    },
    equipped: p.equipped,
    leaderboard_listed: p.leaderboardListed,
    gifting: {
      sent_today: sentOn(p, today),
      send_limit: GIFT_SEND_LIMIT,
      receive_limit: GIFT_RECEIVE_LIMIT,
      min: GIFT_MIN,
      floor: BAILOUT_FLOOR,
    },
    created_at: p.createdAt,
  };
}

const nextDay = (day: string, n = 1) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function toQuestRow(q: ActiveQuest, row: QuestProgressRecord | undefined): QuestRow {
  const def = q.def;
  if (def.kind === "achievement") throw new Error("not a quest");
  const progress = row?.progress ?? 0;
  return {
    id: def.id,
    kind: def.kind,
    game: def.game ?? null,
    text: def.text,
    target: def.target,
    progress: Math.min(progress, def.target),
    reward: def.reward,
    complete: progress >= def.target,
    claimed: (row?.claimed ?? 0) > 0,
  };
}

function toAchievementRow(q: ActiveQuest, row: QuestProgressRecord | undefined): AchievementRow {
  const def = q.def;
  if (def.kind !== "achievement") throw new Error("not an achievement");
  const progress = row?.progress ?? 0;
  const claimed = row?.claimed ?? 0;
  return {
    id: def.id,
    name: def.name,
    game: def.game ?? null,
    progress,
    tiers: def.tiers.map((t, i) => ({
      target: t.target,
      text: def.text(t.target),
      reward: t.reward,
      complete: progress >= t.target,
      claimed: i < claimed,
    })),
    claimable: claimed < tiersDone(def, progress),
  };
}

export function highrollerRoutes(deps: HighrollerRouteDeps): AnyRoute<HighrollerRepo, PlayerRecord>[] {
  const now = deps.now ?? (() => new Date());
  const games = deps.games ?? GAMES;
  const pool = deps.quests ?? QUESTS;
  const gameIds = Object.keys(games);
  const boardSize = deps.boardSize ?? BOARD_SIZE;
  const clockMs = () => now().getTime();
  const boards = new TtlCache<BoardRow[]>(deps.cacheMs?.boards ?? BOARD_CACHE_MS, clockMs);
  const feed = new TtlCache<FeedResponse>(deps.cacheMs?.feed ?? FEED_CACHE_MS, clockMs);
  const jackpot = new TtlCache<JackpotResponse>(deps.cacheMs?.jackpot ?? JACKPOT_CACHE_MS, clockMs);

  /** The player's quests on their calendar day in `timeZone`, and the rows to read for them. */
  const questsFor = (userId: string, at: Date, timeZone: string) => {
    const active = activeQuests(pool, gameIds, userId, dayIn(at, timeZone));
    const keys: QuestKey[] = active.map((q) => ({ questId: q.def.id, period: q.period }));
    return { active, keys };
  };

  /** One claim: eligibility decided inside the transaction, on the player it read. */
  function claim(kind: "daily_bonus" | "bailout", rule: (p: PlayerRecord, today: string) => Eligibility) {
    return route({
      method: "POST",
      path: kind === "daily_bonus" ? "/daily-bonus" : "/bailout",
      input: { body: claimInput },
      async handler(ctx, { body }): Promise<ClaimResponse> {
        const today = dayIn(now(), body.timeZone);
        const done = await ctx.repo.applyCredit(ctx.user.userId, (p) => {
          const e = rule(p, today);
          if (!e.ok) throw conflict(e.code);
          return { kind, amount: e.amount, ref: today, patch: e.patch };
        });
        if (!done) throw notFound();
        return { amount: done.entry.amount, player: toPlayerRow(done.player, today) };
      },
    });
  }

  const handResponse = (out: {
    hand: Parameters<typeof toHandRow>[0];
    player: PlayerRecord;
    completed: Completion[];
    jackpot: number | null;
  }): HandResponse => ({
    hand: toHandRow(out.hand, games),
    balance: out.player.balance,
    xp: out.player.xp,
    ...toLevelRow(out.player.xp),
    completed: out.completed.map(toCompletionRow),
    jackpot: out.jackpot === null ? null : { amount: out.jackpot },
  });

  return [
    route({
      method: "GET",
      path: "/health",
      public: true,
      async handler() {
        return { ok: true };
      },
    }),

    route({
      method: "GET",
      path: "/me",
      input: { query: meQuery },
      async handler(ctx, { query }): Promise<PlayerRow> {
        return toPlayerRow(ctx.scope, dayIn(now(), query.timeZone ?? "UTC"));
      },
    }),

    claim("daily_bonus", dailyBonus),
    claim("bailout", bailout),

    route({
      method: "GET",
      path: "/ledger",
      input: { query: ledgerQuery },
      async handler(ctx, { query }): Promise<LedgerPage> {
        const entries = await ctx.repo.listLedger(ctx.user.userId, {
          beforeSeq: query.cursor === undefined ? undefined : Number(query.cursor),
          limit: query.limit,
        });
        const last = entries.at(-1);
        return {
          entries: entries.map(toLedgerRow),
          next_cursor: entries.length === query.limit && last && last.seq > 1 ? String(last.seq) : null,
        };
      },
    }),

    // ---------- hands ----------

    route({
      method: "POST",
      path: "/hands",
      input: { body: startHandInput },
      async handler(ctx, { body }): Promise<HandResponse> {
        const game = games[body.game];
        if (!game) throw badRequest("UNKNOWN_GAME", { code: "UNKNOWN_GAME" });
        const variants = game.engine.variants;
        const variant = variants ? (body.variant ?? variants[0]) : null;
        if (variants ? !variants.includes(variant!) : body.variant !== undefined) {
          throw badRequest("UNKNOWN_VARIANT", { code: "UNKNOWN_VARIANT" });
        }
        const bets = game.bets.safeParse(body.bets);
        if (!bets.success) throw badRequest("BAD_BETS", { code: "BAD_BETS", issues: bets.error.flatten() });
        const reason = game.engine.validateBets(bets.data, game.limits, variant);
        if (reason) throw badRequest("BAD_BETS", { code: "BAD_BETS", reason });

        // Everything random, drawn before the transaction: a retry replays it.
        const dealt = game.engine.deal(bets.data, deps.rng, variant);
        const at = now();
        const week = isoWeek(at);
        const quests = questsFor(ctx.user.userId, at, body.timeZone);
        const key = { handId: body.id, game: body.game, week, quests: quests.keys };
        const out = await ctx.repo.handTransaction(ctx.user.userId, key, (read) =>
          planStart(read, {
            userId: ctx.user.userId,
            handId: body.id,
            gameId: body.game,
            game,
            variant,
            dealt,
            now: at.toISOString(),
            week,
            quests: quests.active,
          }),
        );
        return handResponse(out);
      },
    }),

    route({
      method: "POST",
      path: "/hands/:id/actions",
      input: { params: handIdParam, body: actionInput },
      async handler(ctx, { params, body }): Promise<HandResponse> {
        const at = now();
        const week = isoWeek(at);
        const quests = questsFor(ctx.user.userId, at, body.timeZone ?? "UTC");
        const key = { handId: params.id, game: null, week, quests: quests.keys };
        const out = await ctx.repo.handTransaction(ctx.user.userId, key, (read) =>
          planAction(read, {
            userId: ctx.user.userId,
            handId: params.id,
            action: body.action,
            version: body.version,
            games,
            now: at.toISOString(),
            week,
            quests: quests.active,
          }),
        );
        return handResponse(out);
      },
    }),

    route({
      method: "GET",
      path: "/hands/active",
      async handler(ctx): Promise<{ hands: HandRow[] }> {
        const active = await ctx.repo.getActiveHands(ctx.user.userId);
        return { hands: active.map((h) => toHandRow(h, games)) };
      },
    }),

    route({
      method: "GET",
      path: "/hands/:id",
      input: { params: handIdParam },
      async handler(ctx, { params }): Promise<HandRow> {
        const hand = await ctx.repo.getHand(ctx.user.userId, params.id);
        if (!hand) throw notFound();
        return toHandRow(hand, games);
      },
    }),

    route({
      method: "GET",
      path: "/hands",
      input: { query: handsQuery },
      async handler(ctx, { query }): Promise<HandPage> {
        const before = query.cursor ? decodeHandCursor(query.cursor) : undefined;
        if (before === null) throw badRequest("BAD_CURSOR");
        const rows = await ctx.repo.listHands(ctx.user.userId, { game: query.game, before, limit: query.limit });
        const last = rows.at(-1);
        return {
          hands: rows.map((h) => toHandRow(h, games)),
          next_cursor: rows.length === query.limit && last ? encodeHandCursor(last) : null,
        };
      },
    }),

    // ---------- stats ----------

    route({
      method: "GET",
      path: "/stats",
      async handler(ctx): Promise<StatsResponse> {
        return toStatsResponse(await ctx.repo.getGameStats(ctx.user.userId));
      },
    }),

    route({
      method: "GET",
      path: "/stats/balance",
      input: { query: statsBalanceQuery },
      async handler(ctx, { query }): Promise<BalanceSeries> {
        const days = chartDays(query.range, query.timeZone, now(), new Date(ctx.scope.createdAt));
        // Today's point is the balance now; past days' come from the ledger.
        const past = await ctx.repo.balancesAt(ctx.user.userId, days.slice(0, -1).map((d) => d.end));
        const balances = [...past, ctx.scope.balance];
        return {
          range: query.range,
          points: days.flatMap((d, i) => (balances[i] === null ? [] : [{ day: d.day, balance: balances[i]! }])),
        };
      },
    }),

    // ---------- shop ----------

    route({
      method: "GET",
      path: "/shop",
      async handler(ctx): Promise<ShopResponse> {
        const owned = new Set(await ctx.repo.getInventory(ctx.user.userId));
        const equipped = ctx.scope.equipped;
        return { items: CATALOG.map((item) => toShopItemRow(item, owned, equipped)), equipped };
      },
    }),

    route({
      method: "POST",
      path: "/shop/:itemId/buy",
      input: { params: itemIdParam, body: claimInput },
      async handler(ctx, { params, body }): Promise<BuyResponse> {
        const item = shopItem(params.itemId);
        if (!item) throw notFound();
        const at = now();
        // A purchase moves only achievements, whose period is "ever"; the zone just names the day.
        const quests = questsFor(ctx.user.userId, at, body.timeZone);
        const active = quests.active.filter((q) => q.def.kind === "achievement" && "purchases" in q.def.match);
        const out = await ctx.repo.purchase(
          ctx.user.userId,
          { itemId: item.id, quests: active.map((q) => ({ questId: q.def.id, period: q.period })) },
          (read) => planPurchase(read, { item, quests: active, now: at.toISOString() }),
        );
        return {
          item: toShopItemRow(item, new Set([item.id]), ctx.scope.equipped),
          balance: out.player.balance,
          completed: out.completed.map(toCompletionRow),
        };
      },
    }),

    route({
      method: "PUT",
      path: "/equipped",
      input: { body: equipInput },
      async handler(ctx, { body }): Promise<EquipResponse> {
        const item = shopItem(body.itemId);
        if (!item) throw notFound();
        if (item.kind !== body.kind) throw badRequest("WRONG_KIND", { code: "WRONG_KIND" });
        const owned = toShopItemRow(item, new Set(await ctx.repo.getInventory(ctx.user.userId)), ctx.scope.equipped).owned;
        if (!owned) throw forbidden("NOT_OWNED");
        const equipped = { ...ctx.scope.equipped, [body.kind]: item.id };
        await ctx.repo.setEquipped(ctx.user.userId, equipped);
        return { equipped };
      },
    }),

    // ---------- quests ----------

    route({
      method: "GET",
      path: "/quests",
      input: { query: questsQuery },
      async handler(ctx, { query }): Promise<QuestsResponse> {
        const at = now();
        const today = dayIn(at, query.timeZone);
        const { active, keys } = questsFor(ctx.user.userId, at, query.timeZone);
        const rows = new Map(
          (await ctx.repo.getQuestProgress(ctx.user.userId, keys)).map((r) => [`${r.questId}|${r.period}`, r]),
        );
        const rowOf = (q: ActiveQuest) => rows.get(`${q.def.id}|${q.period}`);
        const of = (kind: string) => active.filter((q) => q.def.kind === kind);
        const daily = of("daily");
        const weekly = of("weekly");
        // Days to next Monday: the ISO week turns over there.
        const dow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
        const claimableCount = active.reduce((n, q) => {
          const row = rowOf(q);
          return n + Math.max(0, tiersDone(q.def, row?.progress ?? 0) - (row?.claimed ?? 0));
        }, 0);
        return {
          daily: {
            period: daily[0]?.period ?? `d:${today}`,
            resets_at: startOfDay(nextDay(today), query.timeZone).toISOString(),
            quests: daily.map((q) => toQuestRow(q, rowOf(q))),
          },
          weekly: {
            period: weekly[0]?.period ?? `w:${isoWeekOfDay(today)}`,
            resets_at: startOfDay(nextDay(today, 8 - dow), query.timeZone).toISOString(),
            quests: weekly.map((q) => toQuestRow(q, rowOf(q))),
          },
          achievements: of("achievement").map((q) => toAchievementRow(q, rowOf(q))),
          claimable: claimableCount,
        };
      },
    }),

    route({
      method: "POST",
      path: "/quests/:id/claim",
      input: { params: questIdParam, body: questClaimInput },
      async handler(ctx, { params, body }): Promise<QuestClaimResponse> {
        const at = now();
        // Only today's and this week's quests can be claimed: yesterday's expire with the day.
        const quest = questsFor(ctx.user.userId, at, body.timeZone).active.find((q) => q.def.id === params.id);
        if (!quest) throw notFound();
        const key = { questId: quest.def.id, period: quest.period };
        const out = await ctx.repo.claimQuest(ctx.user.userId, key, (read) =>
          planClaim(read, { quest: quest.def, period: quest.period, now: at.toISOString() }),
        );
        return {
          quest_id: quest.def.id,
          reward: out.reward,
          balance: out.player.balance,
          xp: out.player.xp,
          ...toLevelRow(out.player.xp),
        };
      },
    }),

    // ---------- social ----------

    route({
      method: "GET",
      path: "/leaderboards/:board",
      input: { params: boardParam, query: boardQuery },
      async handler(ctx, { params, query }): Promise<LeaderboardResponse> {
        const { board } = params;
        const week = board === "level" ? null : (query.week ?? isoWeek(now()));
        const rows = await boards.get(`${board}|${week}`, async () =>
          rankRows((await ctx.repo.leaderboard(board, week ?? "", boardSize)).sort(byValue)),
        );

        // Your own row, worked out fresh: hidden or not, inside the top or not.
        const p = ctx.scope;
        let value: number | null = p.xp;
        if (week) {
          const w = await ctx.repo.getWeeklyStats(p.userId, week);
          value = w ? (board === "net" ? w.net : w.biggestWin) : null;
        }
        const me =
          value === null
            ? null
            : {
                rank: 1 + (await ctx.repo.countAbove(board, week ?? "", value)),
                user_id: p.userId,
                display_name: publicName(p),
                value,
                level: levelFor(p.xp),
                listed: p.leaderboardListed,
              };
        return { board, week, previous_week: week && shiftWeek(week, -1), rows, me };
      },
    }),

    route({
      method: "PUT",
      path: "/settings",
      input: { body: socialSettingsInput },
      async handler(ctx, { body }): Promise<SocialSettings> {
        await ctx.repo.setListed(ctx.user.userId, body.leaderboardListed);
        // This instance shows the change at once; others within their cache time.
        boards.clear();
        feed.clear();
        return { leaderboard_listed: body.leaderboardListed };
      },
    }),

    route({
      method: "POST",
      path: "/gifts",
      input: { body: giftInput },
      async handler(ctx, { body }): Promise<GiftResponse> {
        const me = ctx.scope;
        const to =
          "email" in body.to ? await ctx.repo.findPlayerByEmail(body.to.email) : await ctx.repo.getPlayer(body.to.userId);
        if (to?.userId === me.userId) throw conflict("SELF_GIFT");
        // A hidden player answers exactly like a stranger, so this can't be used to find out who plays.
        if (!to || !to.leaderboardListed) throw notFound("NO_SUCH_PLAYER");

        const at = now();
        const out = await ctx.repo.gift({ giftId: body.id, fromUserId: me.userId, toUserId: to.userId }, (read) =>
          planGift(read, {
            id: body.id,
            amount: body.amount,
            message: body.message || null,
            senderDay: dayIn(at, body.timeZone),
            utcDay: dayIn(at, "UTC"),
            fromName: publicName(me),
            toName: publicName(to),
            now: at.toISOString(),
          }),
        );
        return {
          gift: toGiftRow(out.gift),
          balance: out.from.balance,
          sent_today: sentOn(out.from, dayIn(at, body.timeZone)),
        };
      },
    }),

    route({
      method: "GET",
      path: "/gifts/received",
      input: { query: giftsReceivedQuery },
      async handler(ctx, { query }): Promise<GiftsReceived> {
        const gifts = await ctx.repo.listGiftsReceived(ctx.user.userId, { since: query.since, limit: query.limit });
        return { gifts: gifts.map(toGiftRow) };
      },
    }),

    route({
      method: "GET",
      path: "/feed",
      input: { query: feedQuery },
      async handler(ctx, { query }): Promise<FeedResponse> {
        return feed.get(String(query.limit), async () => {
          const events = await ctx.repo.listFeed(now().toISOString(), query.limit);
          return { events: events.map((e) => toFeedEventRow(e, games[e.game]?.name ?? e.game)) };
        });
      },
    }),

    // ---------- jackpot ----------

    route({
      method: "GET",
      path: "/jackpot",
      async handler(ctx): Promise<JackpotResponse> {
        return jackpot.get("", async () => {
          const { pot, lastHit } = await ctx.repo.getJackpot();
          return toJackpotResponse(pot, lastHit, (g) => games[g]?.name ?? g);
        });
      },
    }),
  ];
}
