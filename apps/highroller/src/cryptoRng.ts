import { randomInt } from "node:crypto";
import type { Rng } from "./games/rng.js";

/**
 * The production Rng: the operating system's CSPRNG through crypto.randomInt,
 * which is unbiased for any bound. Imported only by the entrypoints
 * (src/index.ts, functions/src/index.ts) and injected into the routes;
 * domain and game code never import it.
 */
export const cryptoRng: Rng = {
  int(maxExclusive) {
    return randomInt(maxExclusive);
  },
};
