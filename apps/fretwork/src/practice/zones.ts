import type { PositionStatRow } from "../domain/types.js";
import { stringName } from "../theory/fretboard.js";

/**
 * Reading the fretboard map (GET /stats/positions): how fast each position
 * is found, and where the slowest patch of the neck is. Pure, so the progress
 * screen and, later, suggested sessions read the map the same way.
 */

/**
 * Upper bounds in ms of the speed bins, fastest first. Fixed rather than
 * relative to the player's own spread, so a cell's colour means the same
 * thing next month and improvement shows as the map lightening.
 */
export const SPEED_BINS = [1500, 2500, 4000, 6000] as const;

/** 0 (fastest) … SPEED_BINS.length (slowest); null for a cell never found. */
export function speedBin(cell: Pick<PositionStatRow, "hits" | "total_ms">): number | null {
  if (cell.hits === 0) return null;
  const avg = cell.total_ms / cell.hits;
  const i = SPEED_BINS.findIndex((max) => avg <= max);
  return i === -1 ? SPEED_BINS.length : i;
}

export function averageMs(cell: Pick<PositionStatRow, "hits" | "total_ms">): number | null {
  return cell.hits ? cell.total_ms / cell.hits : null;
}

/** What an attempt that was never found costs a zone, as if it took this long. */
const MISS_COST_MS = 10_000;

/** Frets per zone, and the fewest tried positions a zone needs to be judged. */
const ZONE_FRETS = 4;
const ZONE_MIN_CELLS = 3;

export interface Zone {
  /** Two adjacent strings, lower-pitched first (e.g. [3, 2] = G and B). */
  strings: [number, number];
  frets: { lo: number; hi: number };
  /** Average cost per attempt: time to a hit, or MISS_COST_MS for a miss. */
  avgMs: number;
  attempts: number;
}

/**
 * The slowest two-string, four-fret patch among those with enough data, or
 * null when no patch has been tried enough to say. Misses count as slow, so a
 * patch you can't find at all ranks below one you find slowly.
 */
export function weakestZone(stats: readonly PositionStatRow[]): Zone | null {
  const at = new Map(stats.map((c) => [`${c.string}:${c.fret}`, c]));
  const maxFret = Math.max(ZONE_FRETS - 1, ...stats.map((c) => c.fret));
  let worst: Zone | null = null;
  for (let s = 6; s >= 2; s--) {
    for (let lo = 0; lo + ZONE_FRETS - 1 <= maxFret; lo++) {
      let cells = 0;
      let attempts = 0;
      let cost = 0;
      for (const string of [s, s - 1]) {
        for (let fret = lo; fret < lo + ZONE_FRETS; fret++) {
          const c = at.get(`${string}:${fret}`);
          if (!c || c.attempts === 0) continue;
          cells += 1;
          attempts += c.attempts;
          cost += c.total_ms + (c.attempts - c.hits) * MISS_COST_MS;
        }
      }
      if (cells < ZONE_MIN_CELLS) continue;
      const avgMs = cost / attempts;
      if (!worst || avgMs > worst.avgMs) {
        worst = { strings: [s, s - 1], frets: { lo, hi: lo + ZONE_FRETS - 1 }, avgMs, attempts };
      }
    }
  }
  return worst;
}

/** "frets 7–10 on the G and B strings" */
export function describeZone(z: Zone): string {
  return `frets ${z.frets.lo}–${z.frets.hi} on the ${stringName(z.strings[0])} and ${stringName(z.strings[1])} strings`;
}
