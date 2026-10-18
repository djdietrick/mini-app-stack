/**
 * The lobby's JavaScript budget (#58), checked after every `build:web`, so CI
 * fails when the first screen gets heavy.
 *
 * Counts what index.html loads before anything else: its entry script and
 * every chunk it preloads, gzipped. The tables and PixiJS load on demand
 * (App.tsx), so they are not in it; a Pixi chunk turning up here fails too.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** Gzipped kB. The lobby is about 71 today (React is ~45 of it); this leaves room, not a free ride. */
const BUDGET_KB = 85;

const dist = join(dirname(fileURLToPath(import.meta.url)), "dist");
const html = readFileSync(join(dist, "index.html"), "utf8");
const files = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="\/([^"]+\.js)"/g)].map((m) => m[1]);
if (!files.length) throw new Error("budget: no entry script found in dist/index.html");

let total = 0;
for (const f of files) {
  const code = readFileSync(join(dist, f));
  if (code.includes("PixiJS")) {
    console.error(`budget: ${f} carries PixiJS; tables must stay lazy-loaded`);
    process.exit(1);
  }
  total += gzipSync(code).length;
}

const kb = total / 1024;
const line = `lobby JS: ${kb.toFixed(1)} kB gzipped (budget ${BUDGET_KB} kB) in ${files.join(", ")}`;
if (kb > BUDGET_KB) {
  console.error(`budget: over! ${line}`);
  process.exit(1);
}
console.log(line);
