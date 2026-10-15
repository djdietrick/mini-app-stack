import type { ZodType, ZodTypeDef } from "zod";
import type { GameEngine, TableLimits } from "../games/engine.js";

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

/**
 * The games on offer. Each wave adds its engines here (blackjack #43, UTH
 * #44, roulette #45, …); until then the lobby shows every tile as "coming
 * soon". Tests pass their own registry to `highrollerRoutes`.
 */
export const GAMES: GameRegistry = {};
