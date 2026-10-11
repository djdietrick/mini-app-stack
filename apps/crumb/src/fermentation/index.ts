/**
 * Crumb's fermentation model: pure, dependency-free TS shared by the server
 * and the SPA (which imports it by relative path, like fretwork's theory).
 * Keep Node and DOM APIs out of it.
 */
export * from "./temperature.js";
export * from "./starter.js";
export * from "./formula.js";
export * from "./plan.js";
