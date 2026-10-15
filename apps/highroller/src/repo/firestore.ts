import { FieldPath, Timestamp } from "@google-cloud/firestore";
import type { Firestore, Transaction } from "@google-cloud/firestore";
import { applyCreditTo, displayNameOf, newPlayer } from "../domain/economy.js";
import { type HandTxRead, type HandTxWrites, SETTLED_HAND_RETENTION_DAYS } from "../domain/hands.js";
import type {
  GameStatsRecord,
  HandRecord,
  LedgerEntry,
  LedgerKind,
  PlayerRecord,
  WeeklyStatsRecord,
} from "../domain/types.js";
import type { HighrollerRepo } from "./types.js";

/**
 * Cloud implementation.
 *
 * Document layout:
 *   highroller_players/{userId}          the player, plus `activeHands`: game → hand id.
 *                                        That map is what keeps one active hand per
 *                                        game (Firestore has no partial unique index):
 *                                        every hand transaction reads and writes it.
 *   highroller_ledger/{userId}_{seq}     one per balance change; the deterministic id
 *                                        (seq zero-padded) makes a retried write land
 *                                        on the same document
 *   highroller_hands/{id}                one per hand, id from the client. `state`,
 *                                        `view` and `results` are JSON strings: engine
 *                                        state can hold nested arrays (split hands),
 *                                        which Firestore cannot store. A settled hand
 *                                        gets `purgeAt`, the field its TTL policy reads.
 *   highroller_game_stats/{userId}_{game}
 *   highroller_weekly_stats/{week}_{userId}
 *
 * Every transaction does all its reads before any write and calls only pure
 * domain functions, so contention retries are safe.
 */
export function createFirestoreHighrollerRepo(db: Firestore, prefix = "highroller_"): HighrollerRepo {
  const players = db.collection(`${prefix}players`);
  const ledger = db.collection(`${prefix}ledger`);
  const hands = db.collection(`${prefix}hands`);
  const gameStats = db.collection(`${prefix}game_stats`);
  const weeklyStats = db.collection(`${prefix}weekly_stats`);

  interface PlayerDoc {
    userId: string;
    displayName: string;
    email: string;
    balance: number;
    xp: number;
    dailyStreak: number;
    lastDailyOn: string | null;
    lastBailoutOn: string | null;
    ledgerSeq: number;
    createdAt: Timestamp;
    activeHands: Record<string, string>;
  }

  const toPlayer = (d: PlayerDoc): PlayerRecord => ({
    userId: d.userId,
    displayName: d.displayName,
    email: d.email,
    balance: d.balance,
    xp: d.xp,
    dailyStreak: d.dailyStreak,
    lastDailyOn: d.lastDailyOn,
    lastBailoutOn: d.lastBailoutOn,
    ledgerSeq: d.ledgerSeq,
    createdAt: d.createdAt.toDate().toISOString(),
  });

  /** The record's fields as stored; `activeHands` is written separately. */
  const playerFields = (p: PlayerRecord) => ({
    userId: p.userId,
    displayName: p.displayName,
    email: p.email,
    balance: p.balance,
    xp: p.xp,
    dailyStreak: p.dailyStreak,
    lastDailyOn: p.lastDailyOn,
    lastBailoutOn: p.lastBailoutOn,
    ledgerSeq: p.ledgerSeq,
  });

  interface LedgerDoc {
    userId: string;
    seq: number;
    kind: LedgerKind;
    amount: number;
    balanceAfter: number;
    handId: string | null;
    ref: string | null;
    createdAt: Timestamp;
  }

  const ledgerRef = (e: { userId: string; seq: number }) => ledger.doc(`${e.userId}_${String(e.seq).padStart(10, "0")}`);

  const toLedgerDoc = (e: LedgerEntry): LedgerDoc => ({
    userId: e.userId,
    seq: e.seq,
    kind: e.kind,
    amount: e.amount,
    balanceAfter: e.balanceAfter,
    handId: e.handId,
    ref: e.ref,
    createdAt: Timestamp.fromDate(new Date(e.createdAt)),
  });

  const toEntry = (d: LedgerDoc): LedgerEntry => ({
    userId: d.userId,
    seq: d.seq,
    kind: d.kind,
    amount: d.amount,
    balanceAfter: d.balanceAfter,
    handId: d.handId,
    ref: d.ref,
    createdAt: d.createdAt.toDate().toISOString(),
  });

  interface HandDoc {
    userId: string;
    game: string;
    variant: string | null;
    status: HandRecord["status"];
    version: number;
    state: string;
    view: string;
    wagered: number;
    returned: number;
    results: string | null;
    createdAt: Timestamp;
    settledAt: Timestamp | null;
    purgeAt: Timestamp | null;
  }

  const toHandDoc = (h: HandRecord): HandDoc => ({
    userId: h.userId,
    game: h.game,
    variant: h.variant,
    status: h.status,
    version: h.version,
    state: JSON.stringify(h.state),
    view: JSON.stringify(h.view),
    wagered: h.wagered,
    returned: h.returned,
    results: h.results === null ? null : JSON.stringify(h.results),
    createdAt: Timestamp.fromDate(new Date(h.createdAt)),
    settledAt: h.settledAt === null ? null : Timestamp.fromDate(new Date(h.settledAt)),
    purgeAt:
      h.settledAt === null
        ? null
        : Timestamp.fromMillis(Date.parse(h.settledAt) + SETTLED_HAND_RETENTION_DAYS * 86_400_000),
  });

  const toHand = (id: string, d: HandDoc): HandRecord => ({
    id,
    userId: d.userId,
    game: d.game,
    variant: d.variant,
    status: d.status,
    version: d.version,
    state: JSON.parse(d.state),
    view: JSON.parse(d.view),
    wagered: d.wagered,
    returned: d.returned,
    results: d.results === null ? null : JSON.parse(d.results),
    createdAt: d.createdAt.toDate().toISOString(),
    settledAt: d.settledAt === null ? null : d.settledAt.toDate().toISOString(),
  });

  const gameStatsRef = (userId: string, game: string) => gameStats.doc(`${userId}_${game}`);
  const weeklyRef = (week: string, userId: string) => weeklyStats.doc(`${week}_${userId}`);

  async function readPlayer(tx: Transaction, userId: string): Promise<PlayerDoc | null> {
    const snap = await tx.get(players.doc(userId));
    return snap.exists ? (snap.data() as PlayerDoc) : null;
  }

  function applyHandWrites(tx: Transaction, w: HandTxWrites, activeHands: Record<string, string>): void {
    const h = w.hand;
    const active = { ...activeHands };
    if (h.status === "active") active[h.game] = h.id;
    else if (active[h.game] === h.id) delete active[h.game];

    tx.update(players.doc(w.player.userId), { ...playerFields(w.player), activeHands: active });
    for (const e of w.ledger) tx.create(ledgerRef(e), toLedgerDoc(e));
    tx.set(hands.doc(h.id), toHandDoc(h));
    if (w.gameStats) tx.set(gameStatsRef(w.gameStats.userId, w.gameStats.game), w.gameStats);
    if (w.weeklyStats) tx.set(weeklyRef(w.weeklyStats.week, w.weeklyStats.userId), w.weeklyStats);
  }

  return {
    async ensurePlayer(user) {
      const ref = players.doc(user.userId);
      const name = displayNameOf(user);
      const snap = await ref.get();
      if (snap.exists) {
        const d = snap.data() as PlayerDoc;
        if (d.displayName === name && d.email === user.email) return toPlayer(d);
      }

      return db.runTransaction(async (tx) => {
        const existing = await readPlayer(tx, user.userId);
        if (existing) {
          tx.update(ref, { displayName: name, email: user.email });
          return toPlayer({ ...existing, displayName: name, email: user.email });
        }
        const { player, entry } = newPlayer(user, new Date().toISOString());
        tx.create(ref, {
          ...playerFields(player),
          createdAt: Timestamp.fromDate(new Date(player.createdAt)),
          activeHands: {},
        } satisfies PlayerDoc);
        tx.create(ledgerRef(entry), toLedgerDoc(entry));
        return player;
      });
    },

    async getPlayer(userId) {
      const snap = await players.doc(userId).get();
      return snap.exists ? toPlayer(snap.data() as PlayerDoc) : null;
    },

    async listLedger(userId, { beforeSeq, limit }) {
      let q = ledger.where("userId", "==", userId).orderBy("seq", "desc");
      if (beforeSeq !== undefined) q = q.where("seq", "<", beforeSeq);
      const snap = await q.limit(limit).get();
      return snap.docs.map((d) => toEntry(d.data() as LedgerDoc));
    },

    async applyCredit(userId, decide) {
      return db.runTransaction(async (tx) => {
        const d = await readPlayer(tx, userId);
        if (!d) return null;
        const applied = applyCreditTo(toPlayer(d), decide(toPlayer(d)), new Date().toISOString());
        if (!applied) return null;
        tx.update(players.doc(userId), playerFields(applied.player));
        tx.create(ledgerRef(applied.entry), toLedgerDoc(applied.entry));
        return applied;
      });
    },

    async handTransaction(userId, key, step) {
      return db.runTransaction(async (tx) => {
        const p = await readPlayer(tx, userId);
        if (!p) throw new Error(`no player ${userId}`);
        const handSnap = await tx.get(hands.doc(key.handId));
        const hand = handSnap.exists ? toHand(handSnap.id, handSnap.data() as HandDoc) : null;
        const game = key.game ?? (hand?.userId === userId ? hand.game : null);

        let read: HandTxRead = { player: toPlayer(p), hand, activeHandId: null, gameStats: null, weeklyStats: null };
        if (game) {
          const [g, w] = await tx.getAll(gameStatsRef(userId, game), weeklyRef(key.week, userId));
          read = {
            ...read,
            activeHandId: p.activeHands?.[game] ?? null,
            gameStats: g.exists ? (g.data() as GameStatsRecord) : null,
            weeklyStats: w.exists ? (w.data() as WeeklyStatsRecord) : null,
          };
        }

        const outcome = step(read);
        if (outcome.writes) applyHandWrites(tx, outcome.writes, p.activeHands ?? {});
        return outcome;
      });
    },

    async getHand(userId, id) {
      const snap = await hands.doc(id).get();
      if (!snap.exists) return null;
      const d = snap.data() as HandDoc;
      return d.userId === userId ? toHand(snap.id, d) : null;
    },

    async getActiveHands(userId) {
      const snap = await players.doc(userId).get();
      const ids = Object.values((snap.data() as PlayerDoc | undefined)?.activeHands ?? {});
      if (!ids.length) return [];
      const docs = await db.getAll(...ids.map((id) => hands.doc(id)));
      return docs
        .filter((d) => d.exists)
        .map((d) => toHand(d.id, d.data() as HandDoc))
        .filter((h) => h.userId === userId && h.status === "active")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async listHands(userId, { game, before, limit }) {
      let q = hands.where("userId", "==", userId);
      if (game) q = q.where("game", "==", game);
      q = q.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
      if (before) q = q.startAfter(Timestamp.fromDate(new Date(before.createdAt)), before.id);
      const snap = await q.limit(limit).get();
      return snap.docs.map((d) => toHand(d.id, d.data() as HandDoc));
    },

    async getGameStats(userId) {
      const snap = await gameStats.where("userId", "==", userId).get();
      return snap.docs.map((d) => d.data() as GameStatsRecord).sort((a, b) => a.game.localeCompare(b.game));
    },

    async getWeeklyStats(userId, week) {
      const snap = await weeklyRef(week, userId).get();
      return snap.exists ? (snap.data() as WeeklyStatsRecord) : null;
    },

    async close() {
      await db.terminate();
    },
  };
}
