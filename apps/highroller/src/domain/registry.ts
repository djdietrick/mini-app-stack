import { type ZodType, type ZodTypeDef, z } from "zod";
import { BACCARAT_LIMITS, baccarat } from "../games/baccarat/engine.js";
import { BLACKJACK_LIMITS, ACTIONS as BLACKJACK_ACTIONS, blackjack } from "../games/blackjack/engine.js";
import type { GameEngine, TableLimits } from "../games/engine.js";
import { BET_KINDS, DOUBLE_ZERO, MAX_SPOTS, ROULETTE_LIMITS, roulette } from "../games/roulette/engine.js";
import { SLOTS_LIMITS, slots } from "../games/slots/engine.js";
import { THREECARD_LIMITS, ACTIONS as THREECARD_ACTIONS, threecard } from "../games/threecard/engine.js";
import { UTH_LIMITS, ACTIONS as UTH_ACTIONS, uth } from "../games/uth/engine.js";
import { VIDEOPOKER_LIMITS, videopoker } from "../games/videopoker/engine.js";

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
}

export type GameRegistry = Readonly<Record<string, RegisteredGame>>;

/** Keeps an entry's engine and schemas in agreement at the definition site. */
export function defineGame<Bets, State, Action extends { type: string }, View>(game: {
  name: string;
  engine: GameEngine<Bets, State, Action, View>;
  bets: ZodType<Bets, ZodTypeDef, unknown>;
  action: ZodType<Action, ZodTypeDef, unknown>;
  limits: TableLimits;
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
  }),
  uth: defineGame({
    name: "Ultimate Texas Hold'em",
    engine: uth,
    bets: z.object({ ante: chips, trips: chips.optional() }).strict(),
    action: z.object({ type: z.enum(UTH_ACTIONS) }).strict(),
    limits: UTH_LIMITS,
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
  }),
  baccarat: defineGame({
    name: "Baccarat",
    engine: baccarat,
    bets: z.object({ player: chips.optional(), banker: chips.optional(), tie: chips.optional() }).strict(),
    // Dealt by fixed rules: no decisions.
    action: z.object({ type: z.string() }),
    limits: BACCARAT_LIMITS,
  }),
  threecard: defineGame({
    name: "Three Card Poker",
    engine: threecard,
    bets: z.object({ ante: chips, pairPlus: chips.optional() }).strict(),
    action: z.object({ type: z.enum(THREECARD_ACTIONS) }).strict(),
    limits: THREECARD_LIMITS,
  }),
  videopoker: defineGame({
    name: "Video Poker",
    engine: videopoker,
    bets: z.object({ coins: chips, coinValue: chips }).strict(),
    action: z.object({ type: z.literal("draw"), hold: z.array(z.boolean()).length(5) }).strict(),
    limits: VIDEOPOKER_LIMITS,
  }),
  slots: defineGame({
    name: "Slots",
    engine: slots,
    bets: z.object({ lineBet: chips, lines: chips }).strict(),
    // A spin takes no decisions; any action is refused.
    action: z.object({ type: z.string() }),
    limits: SLOTS_LIMITS,
  }),
};
