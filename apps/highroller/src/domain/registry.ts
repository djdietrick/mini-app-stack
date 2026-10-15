import { type ZodType, type ZodTypeDef, z } from "zod";
import { BLACKJACK_LIMITS, ACTIONS as BLACKJACK_ACTIONS, blackjack } from "../games/blackjack/engine.js";
import type { GameEngine, TableLimits } from "../games/engine.js";
import { BET_KINDS, DOUBLE_ZERO, MAX_SPOTS, ROULETTE_LIMITS, roulette } from "../games/roulette/engine.js";
import { UTH_LIMITS, ACTIONS as UTH_ACTIONS, uth } from "../games/uth/engine.js";

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
 * UTH (#44) and roulette (#45); wave 2 adds its engines here. Tests pass
 * their own registry to `highrollerRoutes`.
 *
 * Bet schemas are strict, so a side bet sent before its game takes one (#46)
 * is refused rather than ignored.
 */
export const GAMES: GameRegistry = {
  blackjack: defineGame({
    name: "Blackjack",
    engine: blackjack,
    bets: z.object({ main: chips }).strict(),
    action: z.object({ type: z.enum(BLACKJACK_ACTIONS) }).strict(),
    limits: BLACKJACK_LIMITS,
  }),
  uth: defineGame({
    name: "Ultimate Texas Hold'em",
    engine: uth,
    bets: z.object({ ante: chips }).strict(),
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
};
