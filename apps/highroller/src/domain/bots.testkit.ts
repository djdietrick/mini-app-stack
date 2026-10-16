import { type BlackjackState, basicStrategy } from "../games/blackjack/index.js";
import { type ThreeCardState, optimalStrategy } from "../games/threecard/index.js";
import { type UthState, simpleStrategy } from "../games/uth/index.js";
import { type VideoPokerState, simpleHold } from "../games/videopoker/index.js";

/**
 * The test bots, one per registered game: the next action for a live hand,
 * as the request body's `action`. The lifecycle and quest tests play every
 * game with these; single-decision games never ask.
 */
export function botAction(game: string, state: unknown, legal: string[]): { type: string; hold?: boolean[] } {
  switch (game) {
    case "blackjack": {
      const b = state as BlackjackState;
      return { type: basicStrategy(b.hands[b.active].cards, b.dealer[0], legal) };
    }
    case "uth":
      return { type: simpleStrategy(state as UthState) };
    case "threecard":
      return { type: optimalStrategy(state as ThreeCardState) };
    case "videopoker":
      return { type: "draw", hold: simpleHold((state as VideoPokerState).cards.slice(0, 5)) };
    default:
      throw new Error(`${game} takes no decisions`);
  }
}
