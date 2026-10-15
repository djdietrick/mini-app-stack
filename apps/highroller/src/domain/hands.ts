import { badRequest, conflict, notFound } from "@stack/service-kit";
import { applyCreditTo } from "./economy.js";
import type { GameRegistry, RegisteredGame } from "./registry.js";
import { settleHand } from "./settle.js";
import type {
  GameStatsRecord,
  HandRecord,
  HandRow,
  LedgerEntry,
  PlayerRecord,
  WeeklyStatsRecord,
} from "./types.js";

/**
 * The server-authoritative hand lifecycle, the same for every game.
 *
 * Each hand transaction is split in two so both repos share one rule:
 *
 *   1. The repo reads a fixed set of documents (HandTxRead) inside its
 *      transaction: the player (locked on Postgres), the hand by id, the
 *      player's active hand for that game, and that game's and week's stats.
 *   2. A pure step (`planStart` / `planAction`) turns those reads into the
 *      writes (HandTxWrites), or throws an AppError and writes nothing.
 *
 * Everything random was drawn by `engine.deal` before the transaction began,
 * and the step uses nothing else, so a Firestore retry recomputes exactly the
 * same writes. Each step also takes `now` and `week` from outside.
 */

/** How long a settled hand's full state is kept for replay. */
export const SETTLED_HAND_RETENTION_DAYS = 90;

export interface HandTxRead {
  player: PlayerRecord;
  /** The hand with the requested id, whoever it belongs to. */
  hand: HandRecord | null;
  /** The player's active hand in this game, if any. */
  activeHandId: string | null;
  gameStats: GameStatsRecord | null;
  weeklyStats: WeeklyStatsRecord | null;
}

export interface HandTxWrites {
  player: PlayerRecord;
  ledger: LedgerEntry[];
  /** Upserted by id. Repos derive "active hand" bookkeeping from its status. */
  hand: HandRecord;
  /** Present once the hand settles. */
  gameStats: GameStatsRecord | null;
  weeklyStats: WeeklyStatsRecord | null;
}

export interface HandTxOutcome {
  /** Null when nothing changes (a repeated start). */
  writes: HandTxWrites | null;
  hand: HandRecord;
  player: PlayerRecord;
}

/** What the repo needs to know before reading: the hand id, and its game when known (a start). */
export interface HandTxKey {
  handId: string;
  /** Null for an action: the repo takes the game from the stored hand. */
  game: string | null;
  week: string;
}

export interface StartPlan {
  userId: string;
  handId: string;
  gameId: string;
  game: RegisteredGame;
  variant: string | null;
  /** engine.deal(...), drawn before the transaction. */
  dealt: unknown;
  now: string;
  week: string;
}

export function planStart(read: HandTxRead, plan: StartPlan): HandTxOutcome {
  const { player } = read;
  const { engine } = plan.game;

  if (read.hand) {
    // The same id again (a retry, a double tap): the hand as it is, no debit.
    if (read.hand.userId !== plan.userId || read.hand.game !== plan.gameId) throw conflict("HAND_ID_TAKEN");
    return { writes: null, hand: read.hand, player };
  }
  if (read.activeHandId) {
    throw conflict("HAND_IN_PROGRESS", { code: "HAND_IN_PROGRESS", hand_id: read.activeHandId });
  }

  const stake = engine.staked(plan.dealt);
  const debit = applyCreditTo(player, { kind: "bet", amount: -stake, handId: plan.handId }, plan.now);
  if (!debit) throw conflict("INSUFFICIENT_FUNDS");

  const hand: HandRecord = {
    id: plan.handId,
    userId: plan.userId,
    game: plan.gameId,
    variant: plan.variant,
    status: "active",
    version: 0,
    state: plan.dealt,
    view: engine.view(plan.dealt),
    wagered: stake,
    returned: 0,
    results: null,
    createdAt: plan.now,
    settledAt: null,
  };
  return finish(read, plan.game, hand, debit.player, [debit.entry], plan.now, plan.week);
}

export interface ActionPlan {
  userId: string;
  handId: string;
  /** Raw from the request; validated against the hand's game here. */
  action: unknown;
  version: number;
  games: GameRegistry;
  now: string;
  week: string;
}

export function planAction(read: HandTxRead, plan: ActionPlan): HandTxOutcome {
  const hand = read.hand;
  if (!hand || hand.userId !== plan.userId) throw notFound();
  if (hand.version !== plan.version) {
    throw conflict("STALE_HAND", { code: "STALE_HAND", version: hand.version });
  }
  if (hand.status !== "active") throw conflict("ILLEGAL_ACTION");

  const game = plan.games[hand.game];
  if (!game) throw conflict("GAME_UNAVAILABLE");
  const parsed = game.action.safeParse(plan.action);
  if (!parsed.success) throw badRequest("BAD_ACTION", { code: "BAD_ACTION", issues: parsed.error.flatten() });

  const { engine } = game;
  if (!engine.legalActions(hand.state).includes(parsed.data.type)) throw conflict("ILLEGAL_ACTION");
  const next = engine.act(hand.state, parsed.data);
  if (next === null) throw conflict("ILLEGAL_ACTION");

  // An extra wager (double, split, a play bet) is debited now, in this transaction.
  let player = read.player;
  const ledger: LedgerEntry[] = [];
  const extra = engine.staked(next) - engine.staked(hand.state);
  if (extra > 0) {
    const debit = applyCreditTo(player, { kind: "bet", amount: -extra, handId: hand.id }, plan.now);
    if (!debit) throw conflict("INSUFFICIENT_FUNDS");
    player = debit.player;
    ledger.push(debit.entry);
  }

  const updated: HandRecord = {
    ...hand,
    version: hand.version + 1,
    state: next,
    view: engine.view(next),
    wagered: hand.wagered + Math.max(0, extra),
  };
  return finish(read, game, updated, player, ledger, plan.now, plan.week);
}

/** Settles the hand in the same writes when the engine says it is over. */
function finish(
  read: HandTxRead,
  game: RegisteredGame,
  hand: HandRecord,
  player: PlayerRecord,
  ledger: LedgerEntry[],
  now: string,
  week: string,
): HandTxOutcome {
  const { engine } = game;
  if (!engine.isFinished(hand.state)) {
    return { writes: { player, ledger, hand, gameStats: null, weeklyStats: null }, hand, player };
  }
  const settled = settleHand({
    hand,
    player,
    gameStats: read.gameStats,
    weeklyStats: read.weeklyStats,
    settlement: engine.settle(hand.state),
    facts: engine.summary(hand.state),
    rtp: engine.theoreticalRtp(hand.variant),
    now,
    week,
  });
  return {
    writes: {
      player: settled.player,
      ledger: [...ledger, ...settled.ledger],
      hand: settled.hand,
      gameStats: settled.gameStats,
      weeklyStats: settled.weeklyStats,
    },
    hand: settled.hand,
    player: settled.player,
  };
}

/** The wire form: the public view only, never `state`. */
export function toHandRow(hand: HandRecord, games: GameRegistry): HandRow {
  const engine = games[hand.game]?.engine;
  return {
    id: hand.id,
    game: hand.game,
    variant: hand.variant,
    status: hand.status,
    version: hand.version,
    wagered: hand.wagered,
    returned: hand.returned,
    view: hand.view,
    legal_actions: hand.status === "active" && engine ? engine.legalActions(hand.state) : [],
    results: hand.results,
    created_at: hand.createdAt,
    settled_at: hand.settledAt,
  };
}

/** Opaque cursor for GET /hands: the last row's (created_at, id). */
export function encodeHandCursor(h: { createdAt: string; id: string }): string {
  return Buffer.from(`${h.createdAt}|${h.id}`).toString("base64url");
}

export function decodeHandCursor(cursor: string): { createdAt: string; id: string } | null {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}
