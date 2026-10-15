/**
 * Pure, dependency-free game code shared by the server and the SPA. The SPA
 * imports it by relative path (`../../src/games/index.js`), like fretwork's
 * theory, so keep Node and DOM APIs out of everything under src/games.
 */
export * from "./cards.js";
export * from "./engine.js";
export * from "./rng.js";
export * from "./simulate.js";
