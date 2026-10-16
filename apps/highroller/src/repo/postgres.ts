import type { PostgresClient, PostgresTx } from "@stack/db-clients";
import { equippedOf } from "../domain/catalog.js";
import { applyCreditTo, displayNameOf, newPlayer } from "../domain/economy.js";
import { type HandTxRead, type HandTxWrites, type QuestKey, SETTLED_HAND_RETENTION_DAYS } from "../domain/hands.js";
import type {
  GameStatsRecord,
  HandRecord,
  LedgerEntry,
  LedgerKind,
  PlayerRecord,
  QuestProgressRecord,
  WeeklyStatsRecord,
} from "../domain/types.js";
import type { HighrollerRepo } from "./types.js";

/**
 * Self-hosted implementation. Unqualified table names resolve into the
 * `highroller` schema via search_path.
 *
 * The Drizzle-wrapped client returns timestamps as Postgres text, `date` as
 * "YYYY-MM-DD", and `bigint` as a string; everything is converted here so
 * both backends return the same records. JSONB is written as a JSON string
 * and cast.
 *
 * Every transaction that changes a balance starts with SELECT … FOR UPDATE on
 * the player row, so one player's transactions run one after another. The
 * partial unique index on hands is a second guard for "one active hand per
 * game".
 */
export function createPostgresHighrollerRepo(pg: PostgresClient): HighrollerRepo {
  const { sql } = pg;
  type Sql = PostgresTx;

  interface PlayerDbRow {
    user_id: string;
    display_name: string;
    email: string;
    balance: string;
    xp: string;
    daily_streak: number;
    last_daily_on: string | null;
    last_bailout_on: string | null;
    ledger_seq: number;
    equipped: Record<string, unknown> | null;
    created_at: string;
  }

  const toPlayer = (r: PlayerDbRow): PlayerRecord => ({
    userId: r.user_id,
    displayName: r.display_name,
    email: r.email,
    balance: Number(r.balance),
    xp: Number(r.xp),
    dailyStreak: r.daily_streak,
    lastDailyOn: day(r.last_daily_on),
    lastBailoutOn: day(r.last_bailout_on),
    ledgerSeq: r.ledger_seq,
    equipped: equippedOf(r.equipped),
    createdAt: iso(r.created_at),
  });

  interface LedgerDbRow {
    user_id: string;
    seq: number;
    kind: LedgerKind;
    amount: string;
    balance_after: string;
    hand_id: string | null;
    ref: string | null;
    created_at: string;
  }

  const toEntry = (r: LedgerDbRow): LedgerEntry => ({
    userId: r.user_id,
    seq: r.seq,
    kind: r.kind,
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    handId: r.hand_id,
    ref: r.ref,
    createdAt: iso(r.created_at),
  });

  interface HandDbRow {
    id: string;
    user_id: string;
    game: string;
    variant: string | null;
    status: HandRecord["status"];
    version: number;
    state: unknown;
    view: unknown;
    wagered: string;
    returned: string;
    results: HandRecord["results"];
    created_at: string;
    settled_at: string | null;
  }

  const toHand = (r: HandDbRow): HandRecord => ({
    id: r.id,
    userId: r.user_id,
    game: r.game,
    variant: r.variant,
    status: r.status,
    version: r.version,
    state: r.state,
    view: r.view,
    wagered: Number(r.wagered),
    returned: Number(r.returned),
    results: r.results,
    createdAt: iso(r.created_at),
    settledAt: r.settled_at === null ? null : iso(r.settled_at),
  });

  interface GameStatsDbRow {
    user_id: string;
    game: string;
    hands: number;
    wagered: string;
    returned: string;
    wins: number;
    losses: number;
    pushes: number;
    biggest_win: string;
    expected_return: number;
  }

  const toGameStats = (r: GameStatsDbRow): GameStatsRecord => ({
    userId: r.user_id,
    game: r.game,
    hands: r.hands,
    wagered: Number(r.wagered),
    returned: Number(r.returned),
    wins: r.wins,
    losses: r.losses,
    pushes: r.pushes,
    biggestWin: Number(r.biggest_win),
    expectedReturn: Number(r.expected_return),
  });

  interface WeeklyDbRow {
    week: string;
    user_id: string;
    hands: number;
    wagered: string;
    net: string;
    biggest_win: string;
  }

  const toWeekly = (r: WeeklyDbRow): WeeklyStatsRecord => ({
    week: r.week,
    userId: r.user_id,
    hands: r.hands,
    wagered: Number(r.wagered),
    net: Number(r.net),
    biggestWin: Number(r.biggest_win),
  });

  interface QuestDbRow {
    user_id: string;
    quest_id: string;
    period: string;
    progress: string;
    run: number;
    marks: string[];
    claimed: number;
    updated_at: string;
    claimed_at: string | null;
  }

  const toQuest = (r: QuestDbRow): QuestProgressRecord => ({
    userId: r.user_id,
    questId: r.quest_id,
    period: r.period,
    progress: Number(r.progress),
    run: r.run,
    marks: r.marks,
    claimed: r.claimed,
    updatedAt: iso(r.updated_at),
    claimedAt: r.claimed_at === null ? null : iso(r.claimed_at),
  });

  async function readQuests(tx: Sql, userId: string, keys: QuestKey[]): Promise<QuestProgressRecord[]> {
    if (!keys.length) return [];
    const rows = await tx<QuestDbRow[]>`
      SELECT q.* FROM quest_progress q
      JOIN unnest(${keys.map((k) => k.questId)}::text[], ${keys.map((k) => k.period)}::text[]) AS k(quest_id, period)
        ON q.quest_id = k.quest_id AND q.period = k.period
      WHERE q.user_id = ${userId}
    `;
    return rows.map(toQuest);
  }

  async function writeQuests(tx: Sql, rows: QuestProgressRecord[]): Promise<void> {
    for (const q of rows) {
      await tx`
        INSERT INTO quest_progress (user_id, quest_id, period, progress, run, marks, claimed, updated_at, claimed_at)
        VALUES (${q.userId}, ${q.questId}, ${q.period}, ${q.progress}, ${q.run}, ${JSON.stringify(q.marks)}::jsonb,
                ${q.claimed}, ${q.updatedAt}::timestamptz, ${q.claimedAt}::timestamptz)
        ON CONFLICT (user_id, quest_id, period) DO UPDATE SET
          progress = EXCLUDED.progress,
          run = EXCLUDED.run,
          marks = EXCLUDED.marks,
          claimed = EXCLUDED.claimed,
          updated_at = EXCLUDED.updated_at,
          claimed_at = EXCLUDED.claimed_at
      `;
    }
  }

  async function lockPlayer(tx: Sql, userId: string): Promise<PlayerRecord | null> {
    const [row] = await tx<PlayerDbRow[]>`SELECT * FROM players WHERE user_id = ${userId} FOR UPDATE`;
    return row ? toPlayer(row) : null;
  }

  async function writePlayer(tx: Sql, p: PlayerRecord): Promise<void> {
    await tx`
      UPDATE players SET
        balance = ${p.balance},
        xp = ${p.xp},
        daily_streak = ${p.dailyStreak},
        last_daily_on = ${p.lastDailyOn}::date,
        last_bailout_on = ${p.lastBailoutOn}::date,
        ledger_seq = ${p.ledgerSeq}
      WHERE user_id = ${p.userId}
    `;
  }

  async function insertLedger(tx: Sql, entries: LedgerEntry[]): Promise<void> {
    for (const e of entries) {
      await tx`
        INSERT INTO ledger (user_id, seq, kind, amount, balance_after, hand_id, ref, created_at)
        VALUES (${e.userId}, ${e.seq}, ${e.kind}, ${e.amount}, ${e.balanceAfter}, ${e.handId}, ${e.ref},
                ${e.createdAt}::timestamptz)
      `;
    }
  }

  async function applyHandWrites(tx: Sql, w: HandTxWrites): Promise<void> {
    await writePlayer(tx, w.player);
    await insertLedger(tx, w.ledger);
    const h = w.hand;
    await tx`
      INSERT INTO hands (id, user_id, game, variant, status, version, state, view, wagered, returned,
                         results, created_at, settled_at)
      VALUES (${h.id}, ${h.userId}, ${h.game}, ${h.variant}, ${h.status}, ${h.version},
              ${JSON.stringify(h.state)}::jsonb, ${JSON.stringify(h.view)}::jsonb, ${h.wagered}, ${h.returned},
              ${h.results === null ? null : JSON.stringify(h.results)}::jsonb,
              ${h.createdAt}::timestamptz, ${h.settledAt}::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        version = EXCLUDED.version,
        state = EXCLUDED.state,
        view = EXCLUDED.view,
        wagered = EXCLUDED.wagered,
        returned = EXCLUDED.returned,
        results = EXCLUDED.results,
        settled_at = EXCLUDED.settled_at
    `;
    const g = w.gameStats;
    if (g) {
      await tx`
        INSERT INTO game_stats (user_id, game, hands, wagered, returned, wins, losses, pushes,
                                biggest_win, expected_return)
        VALUES (${g.userId}, ${g.game}, ${g.hands}, ${g.wagered}, ${g.returned}, ${g.wins}, ${g.losses},
                ${g.pushes}, ${g.biggestWin}, ${g.expectedReturn})
        ON CONFLICT (user_id, game) DO UPDATE SET
          hands = EXCLUDED.hands,
          wagered = EXCLUDED.wagered,
          returned = EXCLUDED.returned,
          wins = EXCLUDED.wins,
          losses = EXCLUDED.losses,
          pushes = EXCLUDED.pushes,
          biggest_win = EXCLUDED.biggest_win,
          expected_return = EXCLUDED.expected_return
      `;
    }
    await writeQuests(tx, w.quests);
    const wk = w.weeklyStats;
    if (wk) {
      await tx`
        INSERT INTO weekly_stats (week, user_id, hands, wagered, net, biggest_win)
        VALUES (${wk.week}, ${wk.userId}, ${wk.hands}, ${wk.wagered}, ${wk.net}, ${wk.biggestWin})
        ON CONFLICT (week, user_id) DO UPDATE SET
          hands = EXCLUDED.hands,
          wagered = EXCLUDED.wagered,
          net = EXCLUDED.net,
          biggest_win = EXCLUDED.biggest_win
      `;
    }
  }

  return {
    async ensurePlayer(user) {
      const [row] = await sql<PlayerDbRow[]>`SELECT * FROM players WHERE user_id = ${user.userId}`;
      const name = displayNameOf(user);
      if (row) {
        if (row.display_name === name && row.email === user.email) return toPlayer(row);
        const [updated] = await sql<PlayerDbRow[]>`
          UPDATE players SET display_name = ${name}, email = ${user.email}
          WHERE user_id = ${user.userId}
          RETURNING *
        `;
        return toPlayer(updated);
      }

      return sql.begin(async (tx) => {
        const { player, entry } = newPlayer(user, new Date().toISOString());
        const [created] = await tx<PlayerDbRow[]>`
          INSERT INTO players (user_id, display_name, email, balance, xp, daily_streak, ledger_seq, created_at)
          VALUES (${player.userId}, ${player.displayName}, ${player.email}, ${player.balance}, 0, 0,
                  ${player.ledgerSeq}, ${player.createdAt}::timestamptz)
          ON CONFLICT (user_id) DO NOTHING
          RETURNING *
        `;
        // Someone else's first request won the race; theirs stands.
        if (!created) {
          const [existing] = await tx<PlayerDbRow[]>`SELECT * FROM players WHERE user_id = ${user.userId}`;
          return toPlayer(existing);
        }
        await insertLedger(tx, [entry]);
        return toPlayer(created);
      });
    },

    async getPlayer(userId) {
      const [row] = await sql<PlayerDbRow[]>`SELECT * FROM players WHERE user_id = ${userId}`;
      return row ? toPlayer(row) : null;
    },

    async listLedger(userId, { beforeSeq, limit }) {
      const rows = await sql<LedgerDbRow[]>`
        SELECT * FROM ledger
        WHERE user_id = ${userId} ${beforeSeq !== undefined ? sql`AND seq < ${beforeSeq}` : sql``}
        ORDER BY seq DESC
        LIMIT ${limit}
      `;
      return rows.map(toEntry);
    },

    async applyCredit(userId, decide) {
      return sql.begin(async (tx) => {
        const player = await lockPlayer(tx, userId);
        if (!player) return null;
        const applied = applyCreditTo(player, decide(player), new Date().toISOString());
        if (!applied) return null;
        await writePlayer(tx, applied.player);
        await insertLedger(tx, [applied.entry]);
        return applied;
      });
    },

    async handTransaction(userId, key, step) {
      return sql.begin(async (tx) => {
        const player = await lockPlayer(tx, userId);
        if (!player) throw new Error(`no player ${userId}`);

        const [handRow] = await tx<HandDbRow[]>`SELECT * FROM hands WHERE id = ${key.handId}`;
        const hand = handRow ? toHand(handRow) : null;
        const game = key.game ?? (hand?.userId === userId ? hand.game : null);

        const quests = await readQuests(tx, userId, key.quests ?? []);
        let read: HandTxRead = { player, hand, activeHandId: null, gameStats: null, weeklyStats: null, quests };
        if (game) {
          const [active] = await tx<{ id: string }[]>`
            SELECT id FROM hands WHERE user_id = ${userId} AND game = ${game} AND status = 'active'
          `;
          const [g] = await tx<GameStatsDbRow[]>`
            SELECT * FROM game_stats WHERE user_id = ${userId} AND game = ${game}
          `;
          const [w] = await tx<WeeklyDbRow[]>`
            SELECT * FROM weekly_stats WHERE week = ${key.week} AND user_id = ${userId}
          `;
          read = {
            ...read,
            activeHandId: active?.id ?? null,
            gameStats: g ? toGameStats(g) : null,
            weeklyStats: w ? toWeekly(w) : null,
          };
        }

        const outcome = step(read);
        if (outcome.writes) await applyHandWrites(tx, outcome.writes);
        return outcome;
      });
    },

    async getHand(userId, id) {
      const [row] = await sql<HandDbRow[]>`SELECT * FROM hands WHERE id = ${id} AND user_id = ${userId}`;
      return row ? toHand(row) : null;
    },

    async getActiveHands(userId) {
      const rows = await sql<HandDbRow[]>`
        SELECT * FROM hands WHERE user_id = ${userId} AND status = 'active' ORDER BY created_at DESC
      `;
      return rows.map(toHand);
    },

    async listHands(userId, { game, before, limit }) {
      const rows = await sql<HandDbRow[]>`
        SELECT * FROM hands
        WHERE user_id = ${userId}
          ${game ? sql`AND game = ${game}` : sql``}
          ${before ? sql`AND (created_at, id) < (${before.createdAt}::timestamptz, ${before.id}::uuid)` : sql``}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}
      `;
      return rows.map(toHand);
    },

    async getGameStats(userId) {
      const rows = await sql<GameStatsDbRow[]>`SELECT * FROM game_stats WHERE user_id = ${userId} ORDER BY game`;
      return rows.map(toGameStats);
    },

    async getWeeklyStats(userId, week) {
      const [row] = await sql<WeeklyDbRow[]>`
        SELECT * FROM weekly_stats WHERE week = ${week} AND user_id = ${userId}
      `;
      return row ? toWeekly(row) : null;
    },

    async balancesAt(userId, instants) {
      if (!instants.length) return [];
      const rows = await sql<{ i: number; balance_after: string | null }[]>`
        SELECT t.i, l.balance_after
        FROM unnest(${instants.map((d) => d.toISOString())}::timestamptz[]) WITH ORDINALITY AS t(at, i)
        LEFT JOIN LATERAL (
          SELECT balance_after FROM ledger
          WHERE user_id = ${userId} AND created_at <= t.at
          ORDER BY created_at DESC, seq DESC
          LIMIT 1
        ) l ON true
        ORDER BY t.i
      `;
      return rows.map((r) => (r.balance_after === null ? null : Number(r.balance_after)));
    },

    async getInventory(userId) {
      const rows = await sql<{ item_id: string }[]>`
        SELECT item_id FROM inventory WHERE user_id = ${userId} ORDER BY acquired_at
      `;
      return rows.map((r) => r.item_id);
    },

    async purchase(userId, key, step) {
      return sql.begin(async (tx) => {
        const player = await lockPlayer(tx, userId);
        if (!player) throw new Error(`no player ${userId}`);
        const [owned] = await tx`
          SELECT 1 FROM inventory WHERE user_id = ${userId} AND item_id = ${key.itemId}
        `;
        const quests = await readQuests(tx, userId, key.quests);
        const out = step({ player, owned: !!owned, quests });
        await writePlayer(tx, out.player);
        await insertLedger(tx, out.ledger);
        await tx`
          INSERT INTO inventory (user_id, item_id, acquired_at)
          VALUES (${userId}, ${out.itemId}, ${out.ledger[0]?.createdAt ?? new Date().toISOString()}::timestamptz)
        `;
        await writeQuests(tx, out.quests);
        return out;
      });
    },

    async setEquipped(userId, equipped) {
      await sql`UPDATE players SET equipped = ${JSON.stringify(equipped)}::jsonb WHERE user_id = ${userId}`;
    },

    async getQuestProgress(userId, keys) {
      return sql.begin((tx) => readQuests(tx, userId, keys));
    },

    async claimQuest(userId, key, step) {
      return sql.begin(async (tx) => {
        const player = await lockPlayer(tx, userId);
        if (!player) throw new Error(`no player ${userId}`);
        const [row] = await readQuests(tx, userId, [key]);
        const out = step({ player, row: row ?? null });
        await writePlayer(tx, out.player);
        await insertLedger(tx, [out.entry]);
        await writeQuests(tx, [out.row]);
        return out;
      });
    },

    async close() {
      await pg.close();
    },
  };
}

/**
 * Deletes settled hands past their retention, keeping their ledger rows.
 * Self-hosted only: index.ts runs it on boot. Firestore has a TTL policy on
 * `purgeAt` instead.
 */
export async function purgeSettledHands(pg: PostgresClient, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SETTLED_HAND_RETENTION_DAYS * 86_400_000).toISOString();
  const rows = await pg.sql`
    DELETE FROM hands WHERE status = 'settled' AND settled_at < ${cutoff}::timestamptz RETURNING id
  `;
  return rows.length;
}

function iso(pgTimestamp: string): string {
  return new Date(pgTimestamp).toISOString();
}

/** A `date` column as "YYYY-MM-DD", whichever form the driver returned it in. */
function day(value: string | Date | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
