import {
  type AnyRoute,
  type SessionUser,
  badRequest,
  conflict,
  createRouteBuilder,
  notFound,
} from "@stack/service-kit";
import type { Rng } from "../games/rng.js";
import type { HighrollerRepo } from "../repo/types.js";
import {
  BAILOUT_FLOOR,
  BAILOUT_TOP_UP,
  type Eligibility,
  bailout,
  bonusFor,
  currentStreak,
  dailyBonus,
  dayIn,
} from "./economy.js";
import { decodeHandCursor, encodeHandCursor, planAction, planStart, toHandRow } from "./hands.js";
import { levelProgress, isoWeek } from "./progress.js";
import { GAMES, type GameRegistry } from "./registry.js";
import {
  type ClaimResponse,
  type HandPage,
  type HandResponse,
  type HandRow,
  type LedgerPage,
  type PlayerRecord,
  type PlayerRow,
  actionInput,
  claimInput,
  handIdParam,
  handsQuery,
  ledgerQuery,
  meQuery,
  startHandInput,
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
  /** Injectable clock for tests. */
  now?: () => Date;
}

export const resolveHighrollerScope = (user: SessionUser, repo: HighrollerRepo) => repo.ensurePlayer(user);

export function toPlayerRow(p: PlayerRecord, today: string): PlayerRow {
  const daily = dailyBonus(p, today);
  const streak = currentStreak(p, today);
  const lv = levelProgress(p.xp);
  const bail = bailout(p, today);
  return {
    user_id: p.userId,
    display_name: p.displayName,
    balance: p.balance,
    xp: p.xp,
    level: lv.level,
    level_xp: lv.into,
    level_xp_needed: lv.needed,
    daily: { available: daily.ok, streak, amount: daily.ok ? daily.amount : bonusFor(streak) },
    bailout: {
      available: bail.ok,
      claimed_today: !bail.ok && bail.code === "ALREADY_CLAIMED",
      floor: BAILOUT_FLOOR,
      top_up_to: BAILOUT_TOP_UP,
    },
    created_at: p.createdAt,
  };
}

export function highrollerRoutes(deps: HighrollerRouteDeps): AnyRoute<HighrollerRepo, PlayerRecord>[] {
  const now = deps.now ?? (() => new Date());
  const games = deps.games ?? GAMES;

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

  const handResponse = (out: { hand: Parameters<typeof toHandRow>[0]; player: PlayerRecord }): HandResponse => ({
    hand: toHandRow(out.hand, games),
    balance: out.player.balance,
    xp: out.player.xp,
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
        const out = await ctx.repo.handTransaction(ctx.user.userId, { handId: body.id, game: body.game, week }, (read) =>
          planStart(read, {
            userId: ctx.user.userId,
            handId: body.id,
            gameId: body.game,
            game,
            variant,
            dealt,
            now: at.toISOString(),
            week,
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
        const out = await ctx.repo.handTransaction(ctx.user.userId, { handId: params.id, game: null, week }, (read) =>
          planAction(read, {
            userId: ctx.user.userId,
            handId: params.id,
            action: body.action,
            version: body.version,
            games,
            now: at.toISOString(),
            week,
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
  ];
}
