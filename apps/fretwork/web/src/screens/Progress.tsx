import { type ReactNode, useState } from "react";
import { clampTempo } from "../../../src/practice/sequence.js";
import { SPEED_BINS, averageMs, describeZone, speedBin, weakestZone } from "../../../src/practice/zones.js";
import { STRING_LETTERS, midiAt, midiName, noteName, pitchClass, stringName } from "../../../src/theory/index.js";
import { type DayRow, type ExerciseRow, type PositionStatRow, type ProgressRow, api } from "../api";
import { href } from "../router";
import { useSettings } from "../settings";
import { useApi } from "../useApi";

/**
 * The Progress tab, read from the server's aggregates (GET /progress,
 * /stats/positions, /stats/week). Three sections, one column on a phone; the
 * map and the ladder sit side by side from `lg`.
 *
 * Every chart has its numbers one tap away (a table under "Show numbers"),
 * and no chart relies on colour alone: the map's legend labels its bins in
 * seconds, cells never found carry a cross, and bars have a baseline stub.
 */
export function Progress() {
  const exercises = useApi("exercises", api.listExercises);
  const progress = useApi("progress", api.listProgress);
  const positions = useApi("stats:positions", api.positionStats);
  const week = useApi("stats:week", () => api.week(7));

  const loading = [exercises, progress, positions, week].some((q) => q.loading && !q.data);
  const failed = [exercises, progress, positions, week].some((q) => q.error);

  const fresh =
    progress.data?.length === 0 &&
    positions.data?.length === 0 &&
    week.data?.every((d) => d.runs === 0);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold">Progress</h1>
      {loading && <p className="text-sm text-muted">Loading…</p>}
      {failed && <p className="text-sm text-miss">Couldn't load your progress. Try again in a moment.</p>}
      {fresh && (
        <section className="card flex flex-col gap-3 p-5">
          <p className="text-[15px] leading-relaxed text-muted">
            This fills in as you practice: a map of how fast you find each note on the neck, a tempo ladder for
            every scale and arpeggio, and your practice this week.
          </p>
          <a href={href({ name: "library" })} className="btn-primary focus-ring self-start">
            Pick an exercise
          </a>
        </section>
      )}
      {week.data && !fresh && <ThisWeek days={week.data} />}
      {!fresh && (
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start">
          {positions.data && <FretboardMap stats={positions.data} />}
          {progress.data && exercises.data && <TempoLadders progress={progress.data} exercises={exercises.data} />}
        </div>
      )}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = `h-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section className="card flex flex-col gap-4 p-4" aria-labelledby={id}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="font-display text-lg font-bold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Numbers({ children }: { children: ReactNode }) {
  return (
    <details className="text-[13px] text-muted">
      <summary className="focus-ring min-h-[44px] cursor-pointer content-center rounded">Show numbers</summary>
      <div className="max-h-72 overflow-auto">{children}</div>
    </details>
  );
}

// ---------- the fretboard map ----------

/** Fastest first, matching SPEED_BINS plus the slowest open-ended bin. */
const RAMP = ["#fac787", "#dda151", "#b58037", "#8c622a", "#6d4c20"] as const;
/** Ink that reads on each ramp step (≥4.5:1). */
const RAMP_INK = ["#1a140c", "#1a140c", "#1a140c", "#f4ecdc", "#f4ecdc"] as const;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function binLabel(i: number): string {
  if (i === 0) return `≤ ${seconds(SPEED_BINS[0])}`;
  if (i === SPEED_BINS.length) return `> ${seconds(SPEED_BINS[i - 1])}`;
  return `≤ ${seconds(SPEED_BINS[i])}`;
}

function cellSummary(c: PositionStatRow): string {
  const avg = averageMs(c);
  return `found ${c.hits} of ${c.attempts}${avg === null ? "" : ` · average ${seconds(avg)}`}`;
}

/**
 * Strings × frets, laid out like the vertical neck (nut at the top, low E on
 * the left, mirrored for left-handers) so a cell sits where the hand goes.
 * Only tried cells are buttons; tapping one shows its numbers.
 */
function FretboardMap({ stats }: { stats: PositionStatRow[] }) {
  const { leftHanded } = useSettings();
  const [picked, setPicked] = useState<string | null>(null);
  const at = new Map(stats.map((c) => [`${c.string}:${c.fret}`, c]));
  const zone = weakestZone(stats);
  const inZone = (s: number, f: number) =>
    !!zone && zone.strings.includes(s) && f >= zone.frets.lo && f <= zone.frets.hi;

  const maxFret = Math.max(12, ...stats.map((c) => c.fret));
  const frets = Array.from({ length: maxFret + 1 }, (_, f) => f);
  const strings = leftHanded ? [1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1];
  const chosen = picked ? at.get(picked) : undefined;

  if (stats.length === 0) {
    return (
      <Section title="Fretboard map">
        <p className="text-[15px] text-muted">
          Find-a-note and flashcard runs fill this in, one position at a time. Try{" "}
          <a className="focus-ring rounded text-brass underline" href={href({ name: "library" })}>
            Note hunt
          </a>{" "}
          to start.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Fretboard map" aside={<span className="text-[13px] text-muted">time to find</span>}>
      <p className="text-[15px]" aria-live="polite">
        {chosen ? (
          <>
            <strong className="font-semibold">
              {midiName(midiAt(chosen.string, chosen.fret))} on the {stringName(chosen.string)} string, fret{" "}
              {chosen.fret}
            </strong>
            <span className="text-muted"> — {cellSummary(chosen)}</span>
          </>
        ) : zone ? (
          <>
            <span className="text-muted">Slowest so far: </span>
            <strong className="font-semibold">{describeZone(zone)}</strong>
            <span className="text-muted">, outlined below.</span>
          </>
        ) : (
          <span className="text-muted">Tap a position for its numbers.</span>
        )}
      </p>

      <Legend />

      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: "1.75rem repeat(6, minmax(0, 1fr))" }}
        role="group"
        aria-label="Time to find each position, by string and fret"
      >
        <span aria-hidden="true" />
        {strings.map((s) => (
          <span key={s} className="text-center font-mono text-[12px] text-muted" aria-hidden="true">
            {STRING_LETTERS[s - 1]}
          </span>
        ))}
        {frets.map((f) => (
          <FretRow key={f} fret={f}>
            {strings.map((s) => {
              const c = at.get(`${s}:${f}`);
              const key = `${s}:${f}`;
              const ring = inZone(s, f) ? " outline outline-2 -outline-offset-2 outline-ink/80" : "";
              if (!c) {
                return <span key={key} className={"h-11 rounded-md border border-line/60" + ring} aria-hidden="true" />;
              }
              const bin = speedBin(c);
              const name = noteName(pitchClass(midiAt(s, f)));
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPicked(picked === key ? null : key)}
                  aria-pressed={picked === key}
                  aria-label={`${name}, ${stringName(s)} string, fret ${f}: ${cellSummary(c)}`}
                  className={
                    "focus-ring flex h-11 items-center justify-center rounded-md text-[12px] font-medium transition hover:brightness-110" +
                    (bin === null ? " border-2 border-miss text-miss" : "") +
                    (picked === key ? " ring-2 ring-ink ring-offset-2 ring-offset-surface" : ring)
                  }
                  style={bin === null ? undefined : { background: RAMP[bin], color: RAMP_INK[bin] }}
                >
                  {bin === null ? "✕" : name}
                </button>
              );
            })}
          </FretRow>
        ))}
      </div>

      <Numbers>
        <table className="w-full text-left">
          <thead className="text-faint">
            <tr>
              <th className="py-1 font-normal">Position</th>
              <th className="py-1 text-right font-normal">Found</th>
              <th className="py-1 text-right font-normal">Average</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {stats.map((c) => {
              const avg = averageMs(c);
              return (
                <tr key={`${c.string}:${c.fret}`} className="border-t border-line">
                  <td className="py-1">
                    {midiName(midiAt(c.string, c.fret))} · {stringName(c.string)}, fret {c.fret}
                  </td>
                  <td className="py-1 text-right">
                    {c.hits}/{c.attempts}
                  </td>
                  <td className="py-1 text-right">{avg === null ? "—" : seconds(avg)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Numbers>
    </Section>
  );
}

function FretRow({ fret, children }: { fret: number; children: ReactNode }) {
  return (
    <>
      <span className="flex items-center justify-end pr-1 font-mono text-[12px] text-faint" aria-hidden="true">
        {fret === 0 ? "open" : fret}
      </span>
      {children}
      {/* The nut, under the open strings. */}
      {fret === 0 && <span className="col-span-full -my-px h-[3px] rounded bg-muted/60" aria-hidden="true" />}
    </>
  );
}

function Legend() {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <span>Slow</span>
        <ol className="flex flex-1 gap-[3px]" aria-label="Average time to find, slowest to fastest">
          {[...RAMP.keys()].reverse().map((i) => (
            <li key={i} className="flex flex-1 flex-col items-center gap-1">
              <span className="h-3 w-full rounded-sm" style={{ background: RAMP[i] }} aria-hidden="true" />
              <span className="font-mono text-[11px]">{binLabel(i)}</span>
            </li>
          ))}
        </ol>
        <span>Fast</span>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm border-2 border-miss text-[10px] text-miss" aria-hidden="true">
            ✕
          </span>
          not found yet
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-4 w-4 rounded-sm border border-line/60" aria-hidden="true" />
          not tried
        </span>
      </p>
    </div>
  );
}

// ---------- tempo ladders ----------

/**
 * Where a ladder's bar ends. Configs have no goal tempo yet, so it is half as
 * fast again as the start: far enough to mean something, near enough to see
 * the bar move.
 */
function ladderGoal(start: number): number {
  return clampTempo(Math.ceil((start * 1.5) / 5) * 5);
}

function TempoLadders({ progress, exercises }: { progress: ProgressRow[]; exercises: ExerciseRow[] }) {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const rows = progress.flatMap((p) => {
    const e = byId.get(p.exercise_id);
    if (!e || e.config.engine !== "sequence" || p.tempo === null) return [];
    return [{ p, e, tempo: e.config.tempo }];
  });

  if (rows.length === 0) {
    return (
      <Section title="Tempo ladder">
        <p className="text-[15px] text-muted">
          Play a scale or arpeggio cleanly and it climbs a few bpm at a time. Your ladders show up here after the
          first run.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Tempo ladder" aside={<span className="text-[13px] text-muted">bpm</span>}>
      <ul className="flex flex-col gap-4">
        {rows.map(({ p, e, tempo }) => {
          const start = clampTempo(tempo.start);
          const goal = Math.max(ladderGoal(start), p.best_tempo ?? 0, p.tempo!);
          const pct = (bpm: number) => `${Math.max(0, Math.min(100, ((bpm - start) / (goal - start || 1)) * 100))}%`;
          return (
            <li key={e.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <a href={href({ name: "exercise", id: e.id })} className="focus-ring truncate rounded text-[15px]">
                  {e.name}
                </a>
                <span className="shrink-0 text-[13px] text-muted">
                  {p.runs} {p.runs === 1 ? "run" : "runs"}
                </span>
              </div>
              {tempo.step > 0 ? (
                <div
                  className="relative h-2 rounded-full bg-brass/20"
                  role="meter"
                  aria-valuemin={start}
                  aria-valuemax={goal}
                  aria-valuenow={p.tempo!}
                  aria-label={`${e.name}: ${p.tempo} of ${goal} bpm`}
                >
                  <div className="absolute inset-y-0 left-0 rounded-full bg-brass" style={{ width: pct(p.tempo!) }} />
                  {p.best_tempo !== null && p.best_tempo > p.tempo! && (
                    <div
                      className="absolute -inset-y-1 w-[2px] rounded bg-ink"
                      style={{ left: `calc(${pct(p.best_tempo)} - 1px)` }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              ) : null}
              <p className="flex flex-wrap gap-x-3 font-mono text-[13px] text-muted">
                <span>
                  {start} → <strong className="font-semibold text-ink">{p.tempo}</strong>
                </span>
                <span>best {p.best_tempo ?? "—"}</span>
                {tempo.step > 0 ? (
                  <span>{p.tempo! >= goal ? "goal reached" : `goal ${goal}`}</span>
                ) : (
                  <span>ladder off</span>
                )}
                {tempo.step > 0 && p.clean_streak > 0 && (
                  <span>
                    {p.clean_streak}/{tempo.cleanRunsToAdvance} clean
                  </span>
                )}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-faint">
        The bar runs from the start tempo to 1.5× it; the white tick is your best clean run when it is ahead of
        the ladder.
      </p>
    </Section>
  );
}

// ---------- this week ----------

function formatMinutes(ms: number): string {
  if (ms === 0) return "0 min";
  const min = Math.round(ms / 60_000);
  if (min === 0) return "<1 min";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

function dayLabel(date: string, style: "short" | "long"): string {
  const [y, m, d] = date.split("-").map(Number);
  const opts: Intl.DateTimeFormatOptions =
    style === "short" ? { weekday: "short" } : { weekday: "long", day: "numeric", month: "short" };
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function ThisWeek({ days }: { days: DayRow[] }) {
  const [picked, setPicked] = useState<number | null>(null);
  const practiced = days.filter((d) => d.runs > 0).length;
  const total = days.reduce((n, d) => n + d.duration_ms, 0);
  // At least 10 minutes tall, so one short session doesn't fill the chart.
  const top = Math.max(10 * 60_000, ...days.map((d) => d.duration_ms));
  const tallest = days.reduce((best, d, i) => (d.duration_ms > (days[best]?.duration_ms ?? 0) ? i : best), -1);
  const shown = picked ?? (tallest >= 0 ? tallest : days.length - 1);
  const today = days.length - 1;

  return (
    <Section title="This week">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Days practiced" value={`${practiced} of ${days.length}`} />
        <Stat label="Time" value={formatMinutes(total)} />
      </div>

      {practiced === 0 ? (
        <p className="text-[15px] text-muted">No practice in the last 7 days yet. Even five minutes counts.</p>
      ) : (
        <>
          <p className="text-[13px] text-muted" aria-live="polite">
            <span className="text-ink">{dayLabel(days[shown].date, "long")}</span> ·{" "}
            {formatMinutes(days[shown].duration_ms)} · {days[shown].runs} {days[shown].runs === 1 ? "run" : "runs"}
          </p>
          <div className="flex h-36 items-end gap-2 border-b border-line" role="group" aria-label="Minutes practiced per day">
            {days.map((d, i) => (
              <button
                key={d.date}
                type="button"
                onClick={() => setPicked(i)}
                onPointerEnter={(ev) => ev.pointerType === "mouse" && setPicked(i)}
                onFocus={() => setPicked(i)}
                aria-pressed={shown === i}
                aria-label={`${dayLabel(d.date, "long")}: ${formatMinutes(d.duration_ms)}, ${d.runs} ${d.runs === 1 ? "run" : "runs"}`}
                className="focus-ring group flex h-full flex-1 flex-col items-center justify-end rounded-t-md"
              >
                <span
                  className={
                    "w-full max-w-[36px] rounded-t transition group-hover:brightness-110 " +
                    (d.duration_ms ? "bg-brass" : "bg-line") +
                    (shown === i ? " outline outline-2 outline-offset-2 outline-ink/70" : "")
                  }
                  style={{ height: d.duration_ms ? `${Math.max(4, (d.duration_ms / top) * 100)}%` : "2px" }}
                />
              </button>
            ))}
          </div>
          <div className="-mt-2 flex gap-2" aria-hidden="true">
            {days.map((d, i) => (
              <span key={d.date} className={"flex-1 text-center text-[12px] " + (i === today ? "text-ink" : "text-muted")}>
                {i === today ? "Today" : dayLabel(d.date, "short")}
              </span>
            ))}
          </div>
          <Numbers>
            <table className="w-full text-left">
              <tbody className="tabular-nums">
                {days.map((d) => (
                  <tr key={d.date} className="border-t border-line">
                    <td className="py-1">{dayLabel(d.date, "long")}</td>
                    <td className="py-1 text-right">{formatMinutes(d.duration_ms)}</td>
                    <td className="py-1 text-right">
                      {d.runs} {d.runs === 1 ? "run" : "runs"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Numbers>
        </>
      )}
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-raised px-3 py-2">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="text-xl font-semibold">{value}</span>
    </div>
  );
}
