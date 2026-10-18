import { FieldPath, Timestamp } from "@google-cloud/firestore";
import type { Firestore, Transaction } from "@google-cloud/firestore";
import { equippedOf } from "../domain/catalog.js";
import { applyCreditTo, displayNameOf, newPlayer } from "../domain/economy.js";
import { type HandTxRead, type HandTxWrites, type QuestKey, SETTLED_HAND_RETENTION_DAYS } from "../domain/hands.js";
import { FEED_RETENTION_DAYS } from "../domain/social.js";
import type {
  Board,
  BoardEntry,
  FeedEventRecord,
  GameStatsRecord,
  GiftRecord,
  HandRecord,
  LedgerEntry,
  LedgerKind,
  PlayerRecord,
  QuestProgressRecord,
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
 *                                        `equipped` is written only by setEquipped.
 *                                        `listed` is the leaderboard flag (the level
 *                                        board's index is on it) and `emailKey` the
 *                                        lowercased email gifting looks up.
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
 *   highroller_inventory/{userId}_{itemId}   one per cosmetic bought; the deterministic id
 *                                        makes a second purchase a conflict the purchase
 *                                        transaction sees when it reads
 *   highroller_quest_progress/{userId}_{questId}_{period}
 *   highroller_gifts/{id}                one per gift, id from the client, so a retried
 *                                        gift finds itself when the transaction reads
 *   highroller_feed_events/{handId}_{kind}   big wins, at most one per hand and kind.
 *                                        `expiresAt` carries the TTL policy (and has no
 *                                        index), so reads filter on `createdAt`.
 *
 * Weekly stats carry the player's `listed` flag, copied on every write and by
 * setListed, so the boards are single indexed queries; names come from a
 * getAll of the players on the board, and a rank is a count() aggregation.
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
  const inventory = db.collection(`${prefix}inventory`);
  const questProgress = db.collection(`${prefix}quest_progress`);
  const gifts = db.collection(`${prefix}gifts`);
  const feedEvents = db.collection(`${prefix}feed_events`);

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
    /** Absent on players from before the shop. */
    equipped?: Record<string, string>;
    /** Absent on players from before social; ensurePlayer fills them in. */
    listed?: boolean;
    emailKey?: string;
    giftsSentToday?: number;
    giftsSentOn?: string | null;
    giftsReceivedToday?: number;
    giftsReceivedOn?: string | null;
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
    equipped: equippedOf(d.equipped),
    leaderboardListed: d.listed ?? true,
    giftsSentToday: d.giftsSentToday ?? 0,
    giftsSentOn: d.giftsSentOn ?? null,
    giftsReceivedToday: d.giftsReceivedToday ?? 0,
    giftsReceivedOn: d.giftsReceivedOn ?? null,
    createdAt: d.createdAt.toDate().toISOString(),
  });

  /** The record's fields as stored; `activeHands`, `equipped` and `listed` are written separately. */
  const playerFields = (p: PlayerRecord) => ({
    userId: p.userId,
    displayName: p.displayName,
    email: p.email,
    emailKey: p.email.toLowerCase(),
    balance: p.balance,
    xp: p.xp,
    dailyStreak: p.dailyStreak,
    lastDailyOn: p.lastDailyOn,
    lastBailoutOn: p.lastBailoutOn,
    ledgerSeq: p.ledgerSeq,
    giftsSentToday: p.giftsSentToday,
    giftsSentOn: p.giftsSentOn,
    giftsReceivedToday: p.giftsReceivedToday,
    giftsReceivedOn: p.giftsReceivedOn,
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

  interface QuestDoc {
    userId: string;
    questId: string;
    period: string;
    progress: number;
    run: number;
    marks: string[];
    claimed: number;
    updatedAt: Timestamp;
    claimedAt: Timestamp | null;
  }

  const questRef = (userId: string, k: QuestKey) => questProgress.doc(`${userId}_${k.questId}_${k.period}`);

  const toQuestDoc = (q: QuestProgressRecord): QuestDoc => ({
    ...q,
    updatedAt: Timestamp.fromDate(new Date(q.updatedAt)),
    claimedAt: q.claimedAt === null ? null : Timestamp.fromDate(new Date(q.claimedAt)),
  });

  const toQuest = (d: QuestDoc): QuestProgressRecord => ({
    userId: d.userId,
    questId: d.questId,
    period: d.period,
    progress: d.progress,
    run: d.run,
    marks: d.marks,
    claimed: d.claimed,
    updatedAt: d.updatedAt.toDate().toISOString(),
    claimedAt: d.claimedAt === null ? null : d.claimedAt.toDate().toISOString(),
  });

  async function readQuests(tx: Transaction | null, userId: string, keys: QuestKey[]): Promise<QuestProgressRecord[]> {
    if (!keys.length) return [];
    const refs = keys.map((k) => questRef(userId, k));
    const snaps = tx ? await tx.getAll(...refs) : await db.getAll(...refs);
    return snaps.filter((d) => d.exists).map((d) => toQuest(d.data() as QuestDoc));
  }

  const writeQuests = (tx: Transaction, rows: QuestProgressRecord[]) => {
    for (const q of rows) tx.set(questRef(q.userId, q), toQuestDoc(q));
  };

  interface GiftDoc extends Omit<GiftRecord, "createdAt"> {
    createdAt: Timestamp;
  }

  const toGiftDoc = (g: GiftRecord): GiftDoc => ({ ...g, createdAt: Timestamp.fromDate(new Date(g.createdAt)) });
  const toGift = (d: GiftDoc): GiftRecord => ({ ...d, createdAt: d.createdAt.toDate().toISOString() });

  interface FeedDoc extends Omit<FeedEventRecord, "createdAt" | "expiresAt"> {
    createdAt: Timestamp;
    expiresAt: Timestamp;
  }

  const feedRef = (f: { handId: string; kind: string }) => feedEvents.doc(`${f.handId}_${f.kind}`);
  const toFeedDoc = (f: FeedEventRecord): FeedDoc => ({
    ...f,
    createdAt: Timestamp.fromDate(new Date(f.createdAt)),
    expiresAt: Timestamp.fromDate(new Date(f.expiresAt)),
  });
  const toFeed = (d: FeedDoc): FeedEventRecord => ({
    ...d,
    createdAt: d.createdAt.toDate().toISOString(),
    expiresAt: d.expiresAt.toDate().toISOString(),
  });

  /** Players by id, for names and flags; missing ones are left out. */
  async function playersById(ids: string[]): Promise<Map<string, PlayerDoc>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const snaps = await db.getAll(...unique.map((id) => players.doc(id)));
    return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data() as PlayerDoc]));
  }

  /** Each board's query over listed players, ordered best first. */
  const boardQuery = (board: Board, week: string) =>
    board === "level"
      ? { q: players.where("listed", "==", true), field: "xp" }
      : board === "net"
        ? { q: weeklyStats.where("week", "==", week).where("listed", "==", true), field: "net" }
        : {
            q: weeklyStats.where("week", "==", week).where("listed", "==", true).where("biggestWin", ">", 0),
            field: "biggestWin",
          };

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
    writeQuests(tx, w.quests);
    for (const f of w.feed) tx.set(feedRef(f), toFeedDoc(f));
  }

  return {
    async ensurePlayer(user) {
      const ref = players.doc(user.userId);
      const name = displayNameOf(user);
      const snap = await ref.get();
      const emailKey = user.email.toLowerCase();
      if (snap.exists) {
        const d = snap.data() as PlayerDoc;
        if (d.displayName === name && d.email === user.email && d.emailKey === emailKey && d.listed !== undefined) {
          return toPlayer(d);
        }
      }

      return db.runTransaction(async (tx) => {
        const existing = await readPlayer(tx, user.userId);
        if (existing) {
          // Also fills in the fields players from before social lack, so they show on the level board.
          const patch = { displayName: name, email: user.email, emailKey, listed: existing.listed ?? true };
          tx.update(ref, patch);
          return toPlayer({ ...existing, ...patch });
        }
        const { player, entry } = newPlayer(user, new Date().toISOString());
        tx.create(ref, {
          ...playerFields(player),
          createdAt: Timestamp.fromDate(new Date(player.createdAt)),
          activeHands: {},
          equipped: player.equipped,
          listed: player.leaderboardListed,
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

        const quests = await readQuests(tx, userId, key.quests ?? []);
        let read: HandTxRead = { player: toPlayer(p), hand, activeHandId: null, gameStats: null, weeklyStats: null, quests };
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

    async balancesAt(userId, instants) {
      return Promise.all(
        instants.map(async (at) => {
          const snap = await ledger
            .where("userId", "==", userId)
            .where("createdAt", "<=", Timestamp.fromDate(at))
            .orderBy("createdAt", "desc")
            .orderBy("seq", "desc")
            .limit(1)
            .get();
          return snap.empty ? null : (snap.docs[0].data() as LedgerDoc).balanceAfter;
        }),
      );
    },

    async getInventory(userId) {
      const snap = await inventory.where("userId", "==", userId).get();
      return snap.docs
        .map((d) => d.data() as { itemId: string; acquiredAt: Timestamp })
        .sort((a, b) => a.acquiredAt.toMillis() - b.acquiredAt.toMillis())
        .map((d) => d.itemId);
    },

    async purchase(userId, key, step) {
      return db.runTransaction(async (tx) => {
        const p = await readPlayer(tx, userId);
        if (!p) throw new Error(`no player ${userId}`);
        const owned = (await tx.get(inventory.doc(`${userId}_${key.itemId}`))).exists;
        const quests = await readQuests(tx, userId, key.quests);
        const out = step({ player: toPlayer(p), owned, quests });
        tx.update(players.doc(userId), playerFields(out.player));
        for (const e of out.ledger) tx.create(ledgerRef(e), toLedgerDoc(e));
        tx.create(inventory.doc(`${userId}_${out.itemId}`), {
          userId,
          itemId: out.itemId,
          acquiredAt: Timestamp.fromDate(new Date(out.ledger[0]?.createdAt ?? Date.now())),
        });
        writeQuests(tx, out.quests);
        return out;
      });
    },

    async setEquipped(userId, equipped) {
      await players.doc(userId).update({ equipped });
    },

    async getQuestProgress(userId, keys) {
      return readQuests(null, userId, keys);
    },

    async claimQuest(userId, key, step) {
      return db.runTransaction(async (tx) => {
        const p = await readPlayer(tx, userId);
        if (!p) throw new Error(`no player ${userId}`);
        const [row] = await readQuests(tx, userId, [key]);
        const out = step({ player: toPlayer(p), row: row ?? null });
        tx.update(players.doc(userId), playerFields(out.player));
        tx.create(ledgerRef(out.entry), toLedgerDoc(out.entry));
        writeQuests(tx, [out.row]);
        return out;
      });
    },

    // ---------- social ----------

    async findPlayerByEmail(email) {
      const snap = await players.where("emailKey", "==", email.toLowerCase()).limit(1).get();
      return snap.empty ? null : toPlayer(snap.docs[0].data() as PlayerDoc);
    },

    async gift(key, step) {
      return db.runTransaction(async (tx) => {
        const [fromSnap, toSnap, giftSnap] = await tx.getAll(
          players.doc(key.fromUserId),
          players.doc(key.toUserId),
          gifts.doc(key.giftId),
        );
        if (!fromSnap.exists) throw new Error(`no player ${key.fromUserId}`);
        const out = step({
          from: toPlayer(fromSnap.data() as PlayerDoc),
          to: toSnap.exists ? toPlayer(toSnap.data() as PlayerDoc) : null,
          existing: giftSnap.exists ? toGift(giftSnap.data() as GiftDoc) : null,
        });
        const w = out.writes;
        if (w) {
          tx.update(players.doc(w.from.userId), playerFields(w.from));
          tx.update(players.doc(w.to.userId), playerFields(w.to));
          for (const e of w.ledger) tx.create(ledgerRef(e), toLedgerDoc(e));
          tx.create(gifts.doc(w.gift.id), toGiftDoc(w.gift));
        }
        return out;
      });
    },

    async listGiftsReceived(userId, { since, limit }) {
      let q = gifts.where("toUserId", "==", userId).orderBy("createdAt", "desc");
      if (since) q = q.where("createdAt", ">", Timestamp.fromDate(new Date(since)));
      const snap = await q.limit(limit).get();
      return snap.docs.map((d) => toGift(d.data() as GiftDoc));
    },

    async setListed(userId, listed) {
      await players.doc(userId).update({ listed });
      // Every week of theirs, so a hidden player leaves past boards too. A hand
      // settling meanwhile reads the player afresh (its transaction retries
      // when the doc changes) and writes the new flag itself.
      const rows = await weeklyStats.where("userId", "==", userId).get();
      for (let i = 0; i < rows.docs.length; i += 500) {
        const batch = db.batch();
        for (const d of rows.docs.slice(i, i + 500)) batch.update(d.ref, { listed });
        await batch.commit();
      }
    },

    async leaderboard(board, week, limit) {
      const { q, field } = boardQuery(board, week);
      const snap = await q.orderBy(field, "desc").limit(limit).get();
      const rows = snap.docs.map((d) => d.data() as { userId: string; [k: string]: unknown });
      const byId = await playersById(rows.map((r) => r.userId));
      return rows.flatMap((r): BoardEntry[] => {
        const p = byId.get(r.userId);
        if (!p) return [];
        return [{ userId: r.userId, displayName: p.displayName, email: p.email, xp: p.xp, value: Number(r[field]) }];
      });
    },

    async countAbove(board, week, value) {
      const { q, field } = boardQuery(board, week);
      // The biggest-win board already filters on its field; a second range on it is fine.
      const snap = await q.where(field, ">", value).count().get();
      return snap.data().count;
    },

    async listFeed(now, limit) {
      // The TTL field has no index, so read by createdAt, which is 7 days behind it.
      const at = Date.parse(now);
      const cutoff = Timestamp.fromMillis(at - FEED_RETENTION_DAYS * 86_400_000);
      const snap = await feedEvents.where("createdAt", ">", cutoff).orderBy("createdAt", "desc").limit(limit).get();
      const events = snap.docs.map((d) => toFeed(d.data() as FeedDoc)).filter((e) => Date.parse(e.expiresAt) > at);
      const byId = await playersById(events.map((e) => e.userId));
      return events.map((e) => ({ ...e, listed: byId.get(e.userId)?.listed ?? true }));
    },

    async close() {
      await db.terminate();
    },
  };
}
