import { DEFAULT_TEMP_F, type FeedObservation, feedRatio, predictPeak, speedFactor } from "../fermentation/index.js";
import type { FeedingRow, ReminderInput, StarterRecord, StarterRow } from "./types.js";

/**
 * What Crumb works out about a starter from its feeds, and the reminders that
 * follow from them. Pure: the routes load the rows and store the results.
 */

const HOUR = 3_600_000;

/** How long a starter goes between feeds before Crumb nudges. */
export const FEED_EVERY_H = { counter: 24, fridge: 7 * 24 } as const;

/** Feeds the speed is learned from. */
export const SPEED_WINDOW = 12;

export const starterGroup = (id: string) => `starter:${id}`;

export function observation(f: FeedingRow): FeedObservation {
  return { fedAt: f.fed_at, starterG: f.starter_g, flourG: f.flour_g, tempF: f.temp_f, peakAt: f.peak_at };
}

/** `feedings` newest first, as the repo lists them. */
export function summarizeStarter(starter: StarterRecord, feedings: readonly FeedingRow[]): StarterRow {
  const last = feedings[0] ?? null;
  const speed = speedFactor(feedings.map(observation), SPEED_WINDOW);
  return { ...starter, last_fed: last, speed, predicted_peak_at: predictedPeak(starter, last, speed.factor) };
}

/**
 * When the last feed should peak: only on the counter, and only until the
 * real peak is logged. A feed from before the starter was moved to the
 * counter says nothing about now.
 */
function predictedPeak(starter: StarterRecord, last: FeedingRow | null, speed: number): string | null {
  if (!last || last.peak_at || starter.location !== "counter") return null;
  const moved = Date.parse(starter.location_since) - Date.parse(starter.created_at) > 60_000;
  if (moved && Date.parse(last.fed_at) < Date.parse(starter.location_since)) return null;
  return predictPeak(
    new Date(last.fed_at),
    feedRatio(last.starter_g, last.flour_g),
    last.temp_f ?? DEFAULT_TEMP_F,
    speed,
  ).toISOString();
}

export function starterReminders(starter: StarterRow, now: Date): ReminderInput[] {
  const url = `#/starters/${starter.id}`;
  const out: ReminderInput[] = [];
  const last = starter.last_fed;

  if (last?.remind_at_peak && starter.predicted_peak_at) {
    out.push({
      key: `${starterGroup(starter.id)}:peak`,
      title: `${starter.name} should be peaking`,
      body: "Check the rise. Logging when it peaks makes the next prediction better.",
      url,
      due_at: starter.predicted_peak_at,
    });
  }

  const base = Date.parse(last?.fed_at ?? starter.location_since);
  const due = base + FEED_EVERY_H[starter.location] * HOUR;
  out.push(
    starter.location === "fridge"
      ? {
          key: `${starterGroup(starter.id)}:feed`,
          title: `Weekly feed for ${starter.name}`,
          body: "Feed it, let it rise for an hour or two, then back in the fridge.",
          url,
          due_at: new Date(due).toISOString(),
        }
      : {
          key: `${starterGroup(starter.id)}:feed`,
          title: `${starter.name} is hungry`,
          body: "It's been a day since its last feed. Feed it, or move it to the fridge.",
          url,
          due_at: new Date(due).toISOString(),
        },
  );

  return out.filter((r) => Date.parse(r.due_at) > now.getTime());
}
