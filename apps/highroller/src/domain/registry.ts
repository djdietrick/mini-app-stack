import { type ZodType, type ZodTypeDef, z } from "zod";
import { BACCARAT_LIMITS, baccarat } from "../games/baccarat/engine.js";
import { BLACKJACK_LIMITS, ACTIONS as BLACKJACK_ACTIONS, blackjack } from "../games/blackjack/engine.js";
import type { Facts, GameEngine, TableLimits } from "../games/engine.js";
import { BET_KINDS, DOUBLE_ZERO, MAX_SPOTS, ROULETTE_LIMITS, roulette } from "../games/roulette/engine.js";
import { SLOTS_LIMITS, slots } from "../games/slots/engine.js";
import { THREECARD_LIMITS, ACTIONS as THREECARD_ACTIONS, threecard } from "../games/threecard/engine.js";
import { UTH_LIMITS, ACTIONS as UTH_ACTIONS, uth } from "../games/uth/engine.js";
import { VIDEOPOKER_LIMITS, videopoker } from "../games/videopoker/engine.js";
import { handName } from "./social.js";

/**
 * Game id → engine, the zod schemas for its bets and actions, and its table
 * limits. Registering here is the whole server-side cost of a new game: the
 * routes, the repos and the migrations are shared by every game.
 */
export interface RegisteredGame {
  name: string;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  engine: GameEngine<any, any, any, any>;
  bets: ZodType<unknown, ZodTypeDef, unknown>;
  action: ZodType<{ type: string }, ZodTypeDef, unknown>;
  limits: TableLimits;
  /**
   * What the big-win feed calls a finished hand ("Straight up 17", "Royal
   * flush"), from the engine's summary facts. Null, or no function, falls
   * back to the game's name.
   */
  label?: (facts: Facts) => string | null;
}

/** The feed's label for a hand of `game`. */
export const handLabel = (game: RegisteredGame, facts: Facts): string => game.label?.(facts) ?? game.name;

export type GameRegistry = Readonly<Record<string, RegisteredGame>>;

/** Keeps an entry's engine and schemas in agreement at the definition site. */
export function defineGame<Bets, State, Action extends { type: string }, View>(game: {
  name: string;
  engine: GameEngine<Bets, State, Action, View>;
  bets: ZodType<Bets, ZodTypeDef, unknown>;
  action: ZodType<Action, ZodTypeDef, unknown>;
  limits: TableLimits;
  label?: (facts: Facts) => string | null;
}): RegisteredGame {
  return game as RegisteredGame;
}

const chips = z.number().int();

/**
 * The games on offer, by the id the SPA sends. Wave 1 is blackjack (#43),
 * UTH (#44) and roulette (#45); wave 2 is baccarat (#53), Three Card Poker
 * (#54), video poker (#55) and slots (#56). Tests pass their own registry to
 * `highrollerRoutes`.
 *
 * Bet schemas are strict, so an unknown spot is refused rather than ignored.
 * Side bets (#46) have their own range, `limits.side`.
 */
export const GAMES: GameRegistry = {
  blackjack: defineGame({
    name: "Blackjack",
    engine: blackjack,
    bets: z.object({ main: chips, perfectPairs: chips.optional(), twentyOnePlusThree: chips.optional() }).strict(),
    action: z.object({ type: z.enum(BLACKJACK_ACTIONS) }).strict(),
    limits: BLACKJACK_LIMITS,
    label: (f) =>
      f.suitedTrips ? "Suited trips on 21+3" : f.perfectPair ? "Perfect pair" : f.blackjack ? "Blackjack" : null,
  }),
  uth: defineGame({
    name: "Ultimate Texas Hold'em",
    engine: uth,
    bets: z.object({ ante: chips, trips: chips.optional() }).strict(),
    action: z.object({ type: z.enum(UTH_ACTIONS) }).strict(),
    limits: UTH_LIMITS,
    label: (f) => (f.tripsHand !== "none" ? `${handName(f.tripsHand)} on Trips` : handName(f.handRank)),
  }),
  roulette: defineGame({
    name: "Roulette",
    engine: roulette,
    bets: z
      .array(
        z
          .object({
            kind: z.enum(BET_KINDS),
            numbers: z.array(z.number().int().min(0).max(DOUBLE_ZERO)).min(1).max(18),
            amount: chips,
          })
          .strict(),
      )
      .min(1)
      .max(MAX_SPOTS),
    // A spin takes no decisions; any action is refused.
    action: z.object({ type: z.string() }),
    limits: ROULETTE_LIMITS,
    label: (f) => (f.straightUp ? `Straight up ${f.pocket}` : null),
  }),
  baccarat: defineGame({
    name: "Baccarat",
    engine: baccarat,
    bets: z.object({ player: chips.optional(), banker: chips.optional(), tie: chips.optional() }).strict(),
    // Dealt by fixed rules: no decisions.
    action: z.object({ type: z.string() }),
    limits: BACCARAT_LIMITS,
    label: (f) => (f.tieWon ? `Tie on ${f.total}` : f.natural ? `Natural ${f.total}` : null),
  }),
  threecard: defineGame({
    name: "Three Card Poker",
    engine: threecard,
    bets: z.object({ ante: chips, pairPlus: chips.optional() }).strict(),
    action: z.object({ type: z.enum(THREECARD_ACTIONS) }).strict(),
    limits: THREECARD_LIMITS,
    label: (f) => handName(f.handRank),
  }),
  videopoker: defineGame({
    name: "Video Poker",
    engine: videopoker,
    bets: z.object({ coins: chips, coinValue: chips }).strict(),
    action: z.object({ type: z.literal("draw"), hold: z.array(z.boolean()).length(5) }).strict(),
    limits: VIDEOPOKER_LIMITS,
    label: (f) => handName(f.handRank),
  }),
  slots: defineGame({
    name: "Slots",
    engine: slots,
    bets: z.object({ lineBet: chips, lines: chips }).strict(),
    // A spin takes no decisions; any action is refused.
    action: z.object({ type: z.string() }),
    limits: SLOTS_LIMITS,
    label: (f) => (f.freeSpins ? "Free spins" : f.fiveOfAKind ? "Five of a kind" : null),
  }),
};
