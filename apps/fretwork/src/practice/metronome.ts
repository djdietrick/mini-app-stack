/**
 * The metronome's timing, as pure arithmetic on the audio clock. The SPA's
 * click (web/src/audio/output.ts) runs the look-ahead pattern: a timer wakes
 * every 25 ms or so and asks this module which beats fall before `now +
 * lookahead`, then schedules exactly those on the AudioContext clock. Timers
 * jitter by tens of milliseconds; the audio clock does not, so the clicks
 * land on time however late the timer fires.
 *
 * Each beat is placed at the previous beat plus one beat at the tempo in
 * force when it is scheduled. A tempo change therefore takes effect from the
 * next beat not yet scheduled, and nothing accumulates: there is no drift to
 * correct. If the timer was starved (a background tab), beats already in the
 * past are skipped rather than played in a burst, keeping the phase.
 */

export interface ClickClock {
  /** Audio-clock time of the next beat to schedule, seconds. */
  next: number;
  /** Index of that beat since start; beat 0 is a downbeat. */
  beat: number;
}

export interface Click {
  time: number;
  beat: number;
  /** The first beat of a bar. */
  accent: boolean;
}

export const TEMPO_RANGE = { min: 30, max: 300 } as const;

export function beatSeconds(bpm: number): number {
  return 60 / Math.min(TEMPO_RANGE.max, Math.max(TEMPO_RANGE.min, bpm));
}

/** A clock whose first beat is `lead` seconds after `now`, so it can still be scheduled. */
export function startClock(now: number, lead = 0.05): ClickClock {
  return { next: now + lead, beat: 0 };
}

/**
 * The clicks due before `until`, and the clock after them. Beats earlier than
 * `now` are dropped without sounding (the scheduler fell behind), and the
 * clock moves to the first beat at or after `now`.
 */
export function dueClicks(
  clock: ClickClock,
  bpm: number,
  now: number,
  until: number,
  beatsPerBar = 4,
): { clicks: Click[]; clock: ClickClock } {
  const step = beatSeconds(bpm);
  let { next, beat } = clock;
  if (next < now) {
    const skip = Math.ceil((now - next) / step);
    next += skip * step;
    beat += skip;
  }
  const clicks: Click[] = [];
  while (next < until) {
    clicks.push({ time: next, beat, accent: beatsPerBar > 0 && beat % beatsPerBar === 0 });
    next += step;
    beat++;
  }
  return { clicks, clock: { next, beat } };
}
