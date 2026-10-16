import { rank3 } from "../poker/rank3.js";
import { PLAY_AT_LEAST, type ThreeCardAction, type ThreeCardState } from "./engine.js";

/** The optimal Ante strategy, which drives the house-edge test: play queen-six-four or better. */
export function optimalStrategy(s: ThreeCardState): ThreeCardAction["type"] {
  return rank3(s.player).score >= PLAY_AT_LEAST ? "play" : "fold";
}
