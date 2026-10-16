import { type Facts, type HandSummary, type Settlement, outcomeOf } from "../games/engine.js";
import { applyCreditTo } from "./economy.js";
import { xpForHand } from "./progress.js";
import { type ActiveQuest, type Completion, foldQuests } from "./quests.js";
import type {
  GameStatsRecord,
  HandRecord,
  LedgerEntry,
  PlayerRecord,
  QuestProgressRecord,
  WeeklyStatsRecord,
} from "./types.js";

/**
 * Settlement: one finished hand → every write it causes, computed once from
 * what the transaction read. Pure, so a retried Firestore transaction gets
 * the same answer and both repos apply exactly the same rule.
 *
 * Quest and achievement progress (quests.ts) is folded here. The big-win
 * feed (#52) and the jackpot (#57) hook in here too; until they land their
 * outputs are empty.
 */
export interface SettleInput {
  /** The hand with its final state, wagered already totalled. */
  hand: HandRecord;
  /** The player after every stake on this hand has been debited. */
  player: PlayerRecord;
  gameStats: GameStatsRecord | null;
  weeklyStats: WeeklyStatsRecord | null;
  settlement: Settlement;
  facts: Facts;
  /** What the hand returns with average luck (theoretical RTP × wagered, or the engine's own figure). */
  expectedReturn: number;
  /** Chips the lifecycle already paid back mid-hand (engine.paidEarly); the payout row is the rest. */
  paidEarly: number;
  /** The player's active quests and the progress rows the transaction read for them. */
  quests?: { active: readonly ActiveQuest[]; rows: readonly QuestProgressRecord[] };
  now: string;
  week: string;
}

export interface SettleOutput {
  hand: HandRecord;
  player: PlayerRecord;
  /** The payout entry, when anything is left to pay. */
  ledger: LedgerEntry[];
  gameStats: GameStatsRecord;
  weeklyStats: WeeklyStatsRecord;
  summary: HandSummary;
  /** Quest progress rows that changed. */
  quests: QuestProgressRecord[];
  /** What this hand completed. */
  completed: Completion[];
  /** Filled by #52: a big-win event. */
  feed: never[];
  /** Filled by #57: a jackpot contribution or hit. */
  jackpot: null;
}

export function settleHand(input: SettleInput): SettleOutput {
  const { hand, settlement, now } = input;
  const wagered = hand.wagered;
  const returned = settlement.returned;
  if (!Number.isInteger(returned) || returned < input.paidEarly) throw new Error(`bad settlement: returned ${returned}`);
  const net = returned - wagered;
  const outcome = outcomeOf(wagered, returned);

  let player = { ...input.player, xp: input.player.xp + xpForHand(wagered) };
  const ledger: LedgerEntry[] = [];
  if (returned > input.paidEarly) {
    const paid = applyCreditTo(player, { kind: "payout", amount: returned - input.paidEarly, handId: hand.id }, now)!;
    player = paid.player;
    ledger.push(paid.entry);
  }

  const g = input.gameStats ?? emptyGameStats(hand.userId, hand.game);
  const gameStats: GameStatsRecord = {
    ...g,
    hands: g.hands + 1,
    wagered: g.wagered + wagered,
    returned: g.returned + returned,
    wins: g.wins + (outcome === "win" ? 1 : 0),
    losses: g.losses + (outcome === "loss" ? 1 : 0),
    pushes: g.pushes + (outcome === "push" ? 1 : 0),
    biggestWin: Math.max(g.biggestWin, net),
    expectedReturn: g.expectedReturn + input.expectedReturn,
  };

  const w = input.weeklyStats ?? emptyWeeklyStats(input.week, hand.userId);
  const weeklyStats: WeeklyStatsRecord = {
    ...w,
    hands: w.hands + 1,
    wagered: w.wagered + wagered,
    net: w.net + net,
    biggestWin: Math.max(w.biggestWin, net),
  };

  const summary: HandSummary = { game: hand.game, variant: hand.variant, wagered, returned, net, outcome, facts: input.facts };
  const quests = input.quests
    ? foldQuests(input.quests.active, input.quests.rows, { hand: summary }, hand.userId, now)
    : { rows: [], completed: [] };

  return {
    hand: { ...hand, status: "settled", returned, results: settlement.results, settledAt: now },
    player,
    ledger,
    gameStats,
    weeklyStats,
    summary,
    quests: quests.rows,
    completed: quests.completed,
    feed: [],
    jackpot: null,
  };
}

export function emptyGameStats(userId: string, game: string): GameStatsRecord {
  return { userId, game, hands: 0, wagered: 0, returned: 0, wins: 0, losses: 0, pushes: 0, biggestWin: 0, expectedReturn: 0 };
}

export function emptyWeeklyStats(week: string, userId: string): WeeklyStatsRecord {
  return { week, userId, hands: 0, wagered: 0, net: 0, biggestWin: 0 };
}
