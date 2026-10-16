import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "@stack/service-kit";
import { type BlackjackState, basicStrategy } from "../games/blackjack/index.js";
import { type HandSummary, outcomeOf } from "../games/engine.js";
import { type Rng, seededRng } from "../games/rng.js";
import { validBets } from "../games/roulette/engine.js";
import { type UthState, simpleStrategy } from "../games/uth/index.js";
import { PAID_ITEMS } from "./catalog.js";
import { newPlayer } from "./economy.js";
import {
  ACHIEVEMENTS,
  type ActiveQuest,
  type AnyQuest,
  DAILY_QUESTS,
  type QuestDef,
  QUESTS,
  WEEKLY_QUESTS,
  activeQuests,
  available,
  claimable,
  emptyProgress,
  foldQuests,
  isoWeekOfDay,
  pickQuests,
  planClaim,
} from "./quests.js";
import { GAMES } from "./registry.js";
import type { QuestProgressRecord } from "./types.js";

const NOW = "2026-10-15T12:00:00.000Z";
const GAME_IDS = Object.keys(GAMES);

const summary = (over: Partial<HandSummary> = {}): HandSummary => ({
  game: "blackjack",
  variant: null,
  wagered: 100,
  returned: 200,
  net: 100,
  outcome: "win",
  facts: {},
  ...over,
});

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
  return "no error";
};

/** Real summaries: hands of every registered game, played by the test bots with side bets on. */
function playedSummaries(perGame: number): HandSummary[] {
  const out: HandSummary[] = [];
  const rng: Rng = seededRng(49);
  for (const [game, g] of Object.entries(GAMES)) {
    for (let i = 0; i < perGame; i++) {
      const variant = g.engine.variants ? g.engine.variants[i % g.engine.variants.length] : null;
      let bets: unknown;
      // Now and then a big bet, so the big-win quests can fire.
      if (game === "blackjack") bets = { main: i % 20 ? 25 : 1_000, perfectPairs: 5, twentyOnePlusThree: 5 };
      else if (game === "uth") bets = { ante: 25, trips: 5 };
      else {
        const spots = validBets(variant as "european" | "american");
        const straight = spots.filter((b) => b.kind === "straight")[rng.int(37)];
        bets = [straight, spots[rng.int(spots.length)]]
          .filter((b, k, all) => all.findIndex((x) => x.kind === b.kind && x.numbers.join() === b.numbers.join()) === k)
          .map((b) => ({ ...b, amount: b.kind === "straight" ? 300 : 5 }));
      }
      let state = g.engine.deal(g.bets.parse(bets), rng, variant);
      for (let n = 0; !g.engine.isFinished(state); n++) {
        assert.ok(n < 30);
        const legal = g.engine.legalActions(state);
        const type =
          game === "blackjack"
            ? basicStrategy((state as BlackjackState).hands[(state as BlackjackState).active].cards, (state as BlackjackState).dealer[0], legal)
            : simpleStrategy(state as UthState);
        state = g.engine.act(state, { type });
      }
      const wagered = g.engine.staked(state);
      const { returned } = g.engine.settle(state);
      out.push({ game, variant, wagered, returned, net: returned - wagered, outcome: outcomeOf(wagered, returned), facts: g.engine.summary(state) });
    }
  }
  return out;
}

describe("quest definitions", () => {
  it("have unique ids, positive targets and rewards, and games that exist", () => {
    const all: AnyQuest[] = [...DAILY_QUESTS, ...WEEKLY_QUESTS, ...ACHIEVEMENTS];
    assert.equal(new Set(all.map((q) => q.id)).size, all.length);
    for (const q of all) {
      assert.match(q.id, /^[a-z0-9-]+$/);
      if (q.game) assert.ok(GAME_IDS.includes(q.game), `${q.id}: no game ${q.game}`);
      const tiers = q.kind === "achievement" ? q.tiers : [{ target: q.target, reward: q.reward }];
      for (const [i, t] of tiers.entries()) {
        assert.ok(t.target > 0 && t.reward.chips > 0 && t.reward.xp > 0, q.id);
        if (i > 0) assert.ok(t.target > tiers[i - 1].target, `${q.id}: tiers ascend`);
      }
    }
    assert.ok(DAILY_QUESTS.length >= 20 && WEEKLY_QUESTS.length >= 12);
  });

  it("run against real summaries from every game", () => {
    const summaries = playedSummaries(1_500);
    const hits = new Map<string, number>();
    for (const q of [...DAILY_QUESTS, ...WEEKLY_QUESTS, ...ACHIEVEMENTS]) {
      for (const s of summaries) {
        const m = q.match;
        let hit = false;
        if ("count" in m) {
          const v = m.count(s);
          assert.ok(Number.isInteger(v) && v >= 0, `${q.id}: ${v}`);
          hit = v > 0;
        } else if ("best" in m) {
          assert.ok(Number.isInteger(m.best(s)), q.id);
          hit = m.best(s) > 0;
        } else if ("streak" in m) {
          hit = m.streak(s) === true;
        } else if ("distinct" in m) {
          const k = m.distinct(s);
          assert.ok(k === null || typeof k === "string", q.id);
          hit = k !== null;
        }
        if (hit) hits.set(q.id, (hits.get(q.id) ?? 0) + 1);
      }
    }
    // A quest that 4,500 hands never move reads a fact no engine reports: a typo.
    for (const q of [...DAILY_QUESTS, ...WEEKLY_QUESTS]) assert.ok(hits.get(q.id), `${q.id} never matched`);
    // Game quests only move for their own game.
    for (const q of [...DAILY_QUESTS, ...WEEKLY_QUESTS].filter((q) => q.game)) {
      const other = summaries.filter((s) => s.game !== q.game);
      assert.ok(other.every((s) => !("count" in q.match) || q.match.count(s) === 0), `${q.id} moved for another game`);
    }
  });
});

describe("picking quests", () => {
  it("is deterministic per user and period, and varies across them", () => {
    const a = pickQuests(DAILY_QUESTS, "u1", "d:2026-10-15").map((q) => q.id);
    assert.deepEqual(pickQuests(DAILY_QUESTS, "u1", "d:2026-10-15").map((q) => q.id), a);
    assert.equal(a.length, 3);
    assert.equal(new Set(a).size, 3);
    const others = new Set<string>();
    for (let d = 1; d <= 20; d++) others.add(pickQuests(DAILY_QUESTS, "u1", `d:2026-10-${String(d).padStart(2, "0")}`).map((q) => q.id).join());
    for (let u = 0; u < 20; u++) others.add(pickQuests(DAILY_QUESTS, `user-${u}`, "d:2026-10-15").map((q) => q.id).join());
    assert.ok(others.size > 30, "picks vary by day and by user");
  });

  it("spreads picks across games", () => {
    for (let u = 0; u < 200; u++) {
      for (const pool of [DAILY_QUESTS, WEEKLY_QUESTS]) {
        const games = pickQuests(pool, `user-${u}`, "d:2026-10-15").map((q) => q.game ?? "*");
        assert.equal(new Set(games).size, 3, `${games}`);
      }
    }
    // Over many players every quest gets picked.
    const seen = new Set<string>();
    for (let u = 0; u < 500; u++) for (const q of pickQuests(DAILY_QUESTS, `user-${u}`, "d:2026-10-15")) seen.add(q.id);
    assert.equal(seen.size, DAILY_QUESTS.length);
  });

  it("offers only quests for games on the table", () => {
    const pool = available(DAILY_QUESTS, ["roulette"]);
    assert.ok(pool.every((q) => q.game === undefined || q.game === "roulette"));
    for (let u = 0; u < 50; u++) {
      assert.ok(pickQuests(pool, `user-${u}`, "d:2026-10-15").every((q) => q.game !== "blackjack" && q.game !== "uth"));
    }
  });

  it("keys today's quests by day and this week's by ISO week, plus every achievement", () => {
    const active = activeQuests(QUESTS, GAME_IDS, "u1", "2026-10-15");
    assert.deepEqual(
      active.map((q) => q.period),
      [...Array(3).fill("d:2026-10-15"), ...Array(3).fill("w:2026-W42"), ...Array(ACHIEVEMENTS.length).fill("ever")],
    );
    assert.equal(isoWeekOfDay("2026-01-01"), "2026-W01");
    assert.equal(isoWeekOfDay("2027-01-01"), "2026-W53");
    assert.equal(isoWeekOfDay("2026-10-19"), "2026-W43");
  });
});

describe("folding progress", () => {
  const quest = (match: QuestDef["match"], target = 3): ActiveQuest => ({
    def: { id: "q", kind: "daily", text: "t", target, reward: { chips: 100, xp: 10 }, match },
    period: "d:2026-10-15",
  });
  const fold = (q: ActiveQuest, rows: QuestProgressRecord[], s: HandSummary) => foldQuests([q], rows, { hand: s }, "u1", NOW);
  const run = (q: ActiveQuest, hands: HandSummary[]) => {
    let rows: QuestProgressRecord[] = [];
    const completed: string[] = [];
    for (const s of hands) {
      const out = fold(q, rows, s);
      if (out.rows.length) rows = out.rows;
      completed.push(...out.completed.map((c) => c.text));
    }
    return { row: rows[0] ?? null, completed };
  };
  const W = summary();
  const L = summary({ outcome: "loss", returned: 0, net: -100 });
  const P = summary({ outcome: "push", returned: 100, net: 0 });

  it("counts, and stops once complete", () => {
    const { row, completed } = run(quest({ count: (s) => (s.outcome === "win" ? 1 : 0) }), [W, L, W, W, W]);
    assert.equal(row!.progress, 3);
    assert.deepEqual(completed, ["t"]);
    // No row until there is progress.
    assert.deepEqual(fold(quest({ count: () => 0 }), [], W).rows, []);
  });

  it("keeps the longest run for a streak, and a push doesn't break it", () => {
    const q = quest({ streak: (s) => (s.outcome === "push" ? null : s.outcome === "win") }, 4);
    const a = run(q, [W, W, L, W, P, W, L]);
    assert.equal(a.row!.progress, 2);
    assert.equal(a.row!.run, 0);
    assert.deepEqual(run(q, [W, W, P, W, W]).completed, ["t"]);
  });

  it("marks distinct keys, and takes the best value", () => {
    const d = run(quest({ distinct: (s) => s.game }, 2), [W, W, summary({ game: "uth" })]);
    assert.deepEqual(d.row!.marks, ["blackjack", "uth"]);
    assert.equal(d.row!.progress, 2);
    const b = run(quest({ best: (s) => s.net }, 1_000), [summary({ net: 300 }), summary({ net: 200 }), summary({ net: 1_200 })]);
    assert.equal(b.row!.progress, 1_200);
  });

  it("completes achievement tiers one by one, and counts purchases", () => {
    const hands: ActiveQuest = { def: ACHIEVEMENTS.find((a) => a.id === "a-hands")!, period: "ever" };
    const big = foldQuests([hands], [{ ...emptyProgress("u1", "a-hands", "ever", NOW), progress: 99 }], { hand: W }, "u1", NOW);
    assert.deepEqual(big.completed, [{ questId: "a-hands", kind: "achievement", text: "Play 100 hands", tier: 1 }]);
    // A purchase doesn't count as a hand, and a hand isn't a purchase.
    const collector: ActiveQuest = { def: ACHIEVEMENTS.find((a) => a.id === "a-collector")!, period: "ever" };
    const item = PAID_ITEMS[0];
    assert.deepEqual(foldQuests([hands], [], { purchase: item }, "u1", NOW).rows, []);
    assert.deepEqual(foldQuests([collector], [], { hand: W }, "u1", NOW).rows, []);
    const bought = foldQuests([collector], [], { purchase: item }, "u1", NOW);
    assert.equal(bought.rows[0].progress, 1);
    assert.equal(bought.completed[0].text, "Buy a cosmetic");
  });
});

describe("claiming", () => {
  const player = newPlayer({ userId: "u1", email: "pat@example.com", displayName: "Pat" }, NOW).player;
  const daily = DAILY_QUESTS[0];
  const row = (progress: number, claimed = 0): QuestProgressRecord => ({
    ...emptyProgress("u1", daily.id, "d:2026-10-15", NOW),
    progress,
    claimed,
  });

  it("pays a complete quest once, with chips, a ledger row and XP", () => {
    assert.equal(code(() => planClaim({ player, row: null }, { quest: daily, period: "d:2026-10-15", now: NOW })), "NOT_COMPLETE");
    assert.equal(code(() => planClaim({ player, row: row(daily.target - 1) }, { quest: daily, period: "d:2026-10-15", now: NOW })), "NOT_COMPLETE");
    const out = planClaim({ player, row: row(daily.target) }, { quest: daily, period: "d:2026-10-15", now: NOW });
    assert.equal(out.player.balance, player.balance + daily.reward.chips);
    assert.equal(out.player.xp, daily.reward.xp);
    assert.deepEqual([out.entry.kind, out.entry.amount, out.entry.ref], ["quest_reward", daily.reward.chips, `${daily.id}:d:2026-10-15`]);
    assert.equal(out.row.claimed, 1);
    assert.equal(code(() => planClaim({ player: out.player, row: out.row }, { quest: daily, period: "d:2026-10-15", now: NOW })), "ALREADY_CLAIMED");
  });

  it("pays achievement tiers in order", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "a-hands")!;
    let r: QuestProgressRecord = { ...emptyProgress("u1", ach.id, "ever", NOW), progress: 1_500 };
    assert.deepEqual(claimable(ach, r), ach.tiers[0].reward);
    const first = planClaim({ player, row: r }, { quest: ach, period: "ever", now: NOW });
    assert.deepEqual([first.entry.kind, first.entry.ref, first.entry.amount], ["achievement_reward", "a-hands:1", ach.tiers[0].reward.chips]);
    r = first.row;
    const second = planClaim({ player: first.player, row: r }, { quest: ach, period: "ever", now: NOW });
    assert.equal(second.entry.amount, ach.tiers[1].reward.chips);
    // Tier 3 needs 10,000 hands.
    assert.equal(code(() => planClaim({ player: second.player, row: second.row }, { quest: ach, period: "ever", now: NOW })), "NOT_COMPLETE");
    const all = { ...second.row, progress: 10_000, claimed: 3 };
    assert.equal(code(() => planClaim({ player, row: all }, { quest: ach, period: "ever", now: NOW })), "ALREADY_CLAIMED");
  });
});
