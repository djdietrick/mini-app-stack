import { useEffect, useMemo, useReducer, useState } from "react";
import type { FindConfig } from "../../../src/domain/types.js";
import {
  type FindState,
  currentSlot,
  currentString,
  findReducer,
  findRun,
  initFind,
  nextPitchClass,
} from "../../../src/practice/find.js";
import { STRING_LETTERS, midiAt, midiName, noteName, positionsOfMidi, stringName } from "../../../src/theory/index.js";
import type { ExerciseRow } from "../api";
import { useNoteStream } from "../audio/useNoteStream";
import { type Dot, Fretboard } from "../components/Fretboard";
import { MicPanel } from "../components/MicPanel";
import { href } from "../router";
import { formatDuration, useNow, useSaveRun, wallClock } from "./common";

/**
 * Direction A, fretboard first: the note to find, what was heard, progress by
 * string, and the neck. Grading is the pure reducer in src/practice/find.ts;
 * this screen feeds it notes and draws the state.
 *
 * Each round is its own component instance (keyed on note and round), so
 * Restart and Next note start from a clean reducer.
 */
export function FindPractice({ exercise, config }: { exercise: ExerciseRow; config: FindConfig }) {
  const [pc, setPc] = useState(() => (config.target.kind === "pitch-class" ? config.target.pc : randomPc()));
  const [round, setRound] = useState(0);
  return (
    <FindRound
      key={`${pc}:${round}`}
      exercise={exercise}
      config={config}
      pc={pc}
      onRestart={() => setRound((r) => r + 1)}
      onNext={() => setPc(nextPitchClass)}
    />
  );
}

function randomPc(): number {
  return Math.floor(Math.random() * 12);
}

interface RoundProps {
  exercise: ExerciseRow;
  config: FindConfig;
  pc: number;
  onRestart: () => void;
  onNext: () => void;
}

function FindRound({ exercise, config, pc, onRestart, onNext }: RoundProps) {
  const [s, dispatch] = useReducer(findReducer, undefined, () =>
    findReducer(initFind(config, pc), { type: "start", at: performance.now() }),
  );
  const mic = useNoteStream((n) => dispatch({ type: "heard", note: { midi: n.midi, at: n.at, position: n.position } }));

  // Time spent allowing the mic shouldn't count against the first note.
  useEffect(() => {
    if (mic.status === "listening") dispatch({ type: "start", at: performance.now() });
  }, [mic.status]);

  const ended = s.endedAt !== null;
  const now = useNow(!ended);
  const startedAt = s.startedAt ?? now;
  const elapsed = (ended ? s.endedAt! : now) - startedAt;
  const limitMs = config.timeLimitSec ? config.timeLimitSec * 1000 : null;

  useEffect(() => {
    if (limitMs !== null && !ended && s.startedAt !== null && now - s.startedAt >= limitMs) {
      dispatch({ type: "timeout", at: s.startedAt + limitMs });
    }
  }, [now, limitMs, ended, s.startedAt]);

  // Keyed on the end time only: the state object never changes after the end,
  // but a new run object here would be saved twice.
  const run = useMemo(
    () => (ended && s.slots.length ? findRun(s, exercise.id, wallClock(s.startedAt ?? s.endedAt!)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.endedAt],
  );
  const save = useSaveRun(run);

  const name = noteName(pc);
  // A fret of context either side, except past 12: the neck repeats there, and
  // one more narrow cell would tip a desktop-width neck into the vertical layout.
  const view = { lo: Math.max(0, config.frets.lo - 1), hi: config.frets.hi >= 12 ? config.frets.hi : config.frets.hi + 1 };
  const found = s.slots.filter((x) => x.found).length;
  const active = currentString(s);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <a href={href({ name: "exercise", id: exercise.id })} className="focus-ring truncate rounded text-sm text-muted">
          ← {exercise.name}
        </a>
        <Clock elapsed={elapsed} limitMs={limitMs} />
      </div>

      <div className="sticky top-0 z-10 -mx-5 bg-ground/95 px-5 py-2 backdrop-blur" aria-live="polite" aria-atomic="true">
        <h1 className="font-display text-4xl font-bold leading-tight">
          Find <span className="text-brass">{name}</span>
          {active !== null && (
            <span className="text-2xl font-semibold text-muted"> on the {stringName(active)} string</span>
          )}
        </h1>
        <Feedback s={s} config={config} />
      </div>

      {s.slots.length === 0 ? (
        <p className="card p-4 text-[15px] text-muted">
          There's no {name} in frets {config.frets.lo}–{config.frets.hi} on these strings. Try the next note.
        </p>
      ) : (
        <>
          {!ended && <MicPanel mic={mic} compact fallback="No mic? Tap the note on the neck." />}
          <Progress s={s} />
        </>
      )}

      {ended && s.slots.length > 0 && (
        <section className="card flex flex-col gap-3 p-4" aria-labelledby="result-h">
          <h2 id="result-h" className="font-display text-xl font-bold">
            {s.timedOut ? "Time's up" : `Every ${name} found`}
          </h2>
          <p className="font-mono text-[15px]">
            {run?.notesClean}/{run?.notesTotal} clean · {formatDuration(elapsed)}
          </p>
          <p className="text-[13px] text-faint">
            {save.status === "saving" && "Saving…"}
            {save.status === "saved" && "Saved to your runs."}
            {save.status === "error" && (
              <>
                <span className="text-miss">Couldn't save this run.</span>{" "}
                <button type="button" onClick={save.retry} className="focus-ring rounded underline">
                  Try again
                </button>
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onNext} className="btn-primary">
              Next note: {noteName(nextPitchClass(pc))}
            </button>
            <button type="button" onClick={onRestart} className="btn">
              Again
            </button>
          </div>
        </section>
      )}

      {!ended && s.slots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={s.hint}
            onClick={() => dispatch({ type: "hint", on: !s.hint })}
            className={"btn " + (s.hint ? "border-brass text-brass" : "")}
          >
            Show positions
          </button>
          <button type="button" onClick={onRestart} className="btn">
            Restart
          </button>
          <button type="button" onClick={onNext} className="btn">
            Next note: {noteName(nextPitchClass(pc))}
          </button>
        </div>
      )}

      {s.slots.length === 0 && (
        <button type="button" onClick={onNext} className="btn-primary self-start">
          Next note: {noteName(nextPitchClass(pc))}
        </button>
      )}

      <Fretboard
        frets={view}
        highlight={config.frets}
        activeString={active ?? undefined}
        dots={dotsFor(s, view, name)}
        onPress={(string, fret) => mic.tap(midiAt(string, fret), { string, fret })}
        title={`Neck, frets ${view.lo} to ${view.hi}. Tap a position to play it.`}
      />

      <p className="text-[13px] text-faint">
        {found}/{s.slots.length} found. The mic hears pitch, not strings, so the right pitch counts wherever you play
        it.
        {s.hint ? " Notes found with positions showing don't count as clean." : ""}
      </p>
    </div>
  );
}

function Clock({ elapsed, limitMs }: { elapsed: number; limitMs: number | null }) {
  if (limitMs === null) {
    return <span className="shrink-0 font-mono text-[15px] text-muted">{formatDuration(elapsed)}</span>;
  }
  const left = Math.max(0, limitMs - elapsed);
  return (
    <span
      className={"shrink-0 font-mono text-[15px] " + (left < 10_000 ? "text-miss" : "text-brass")}
      aria-label={`${Math.ceil(left / 1000)} seconds left`}
    >
      {Math.ceil(left / 1000)} s
    </span>
  );
}

function Feedback({ s, config }: { s: FindState; config: FindConfig }) {
  const f = s.last?.feedback;
  let text: string;
  let tone = "text-muted";
  switch (f?.kind) {
    case undefined:
      text = s.order === "string-by-string" ? "Play it, or tap it on the neck." : "Play every one you can find.";
      break;
    case "correct": {
      tone = "text-correct";
      const slot = s.slots[f.slots[0]];
      if (f.elsewhere) {
        text = `✓ ${midiName(f.midi)}: right pitch, on another string. It counts; the mic can't tell strings apart.`;
      } else if (s.order === "string-by-string" && slot.found) {
        text = `✓ ${midiName(f.midi)}, fret ${slot.found.fret} · ${formatDuration(slot.ms)}`;
      } else {
        text = `✓ ${midiName(f.midi)} · ${f.slots.length} lit`;
      }
      break;
    }
    case "wrong-octave":
      tone = "text-miss";
      text =
        s.order === "string-by-string"
          ? `✕ ${midiName(f.midi)}: right note, wrong octave. On this string it's ${midiName(f.expected)}.`
          : `✕ ${midiName(f.midi)}: right note, wrong octave. Try ${midiName(f.expected)}.`;
      break;
    case "wrong-note":
      tone = "text-miss";
      text = `✕ Heard ${midiName(f.midi)}, not ${noteName(s.pc)}.`;
      break;
    case "already-found":
      text = `${midiName(f.midi)} is already lit.`;
      break;
    case "outside":
      text = `${midiName(f.midi)} is outside frets ${config.frets.lo}–${config.frets.hi}.`;
      break;
  }
  return <p className={"min-h-[3em] text-[15px] " + tone}>{text}</p>;
}

/** String by string: one chip per string, low E first. Any order: a count and a bar. */
function Progress({ s }: { s: FindState }) {
  if (s.order === "any") {
    const found = s.slots.filter((x) => x.found).length;
    return (
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-correct" style={{ width: `${(found / s.slots.length) * 100}%` }} />
        </div>
        <span className="font-mono text-[13px] text-muted">
          {found}/{s.slots.length}
        </span>
      </div>
    );
  }
  const current = currentSlot(s);
  return (
    <ol className="flex gap-1.5" aria-label="Progress by string">
      {s.slots.map((slot, i) => {
        const string = slot.positions[0].string;
        const state = slot.found ? (slot.ok ? "clean" : "found") : i === current ? "current" : s.timedOut ? "missed" : "todo";
        return (
          <li
            key={string}
            aria-label={`${stringName(string)} string: ${state === "clean" ? "found first time" : state === "found" ? "found after a miss or hint" : state === "current" ? "now" : state === "missed" ? "not found" : "to do"}`}
            className={
              "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg border py-1.5 " +
              (state === "clean"
                ? "border-correct bg-correct text-correct-ink"
                : state === "found"
                  ? "border-correct text-correct"
                  : state === "current"
                    ? "border-brass text-brass"
                    : state === "missed"
                      ? "border-miss text-miss"
                      : "border-line text-faint")
            }
          >
            <span className="font-display text-base font-bold leading-none">
              {STRING_LETTERS[string - 1]}
              {state === "clean" || state === "found" ? " ✓" : state === "missed" ? " ✕" : ""}
            </span>
            <span className="font-mono text-[10px] leading-none">{slot.found ? formatDuration(slot.ms) : " "}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Found in green, the latest miss where it was played, hints and (once time is up) the ones missed. */
function dotsFor(s: FindState, view: { lo: number; hi: number }, name: string): Dot[] {
  const dots = new Map<string, Dot>();
  const put = (string: number, fret: number, tone: Dot["tone"], label = name) => {
    if (fret >= view.lo && fret <= view.hi) dots.set(`${string}:${fret}`, { string, fret, tone, name: label });
  };
  const ended = s.endedAt !== null;
  const current = currentSlot(s);

  if (!ended && s.hint) {
    const scope = current === null ? s.slots : [s.slots[current]];
    for (const slot of scope) if (!slot.found) for (const p of slot.positions) put(p.string, p.fret, "hint");
  }

  const f = s.last?.feedback;
  if (!ended && s.last && (f?.kind === "wrong-note" || f?.kind === "wrong-octave")) {
    const heardName = noteName(s.last.heard.midi);
    const at = s.last.heard.position;
    if (at) {
      put(at.string, at.fret, "miss", heardName);
    } else if (current !== null) {
      // From the mic: the only place it could have been on the string being asked for.
      const string = s.slots[current].positions[0].string;
      for (const p of positionsOfMidi(s.last.heard.midi, view, [string])) put(p.string, p.fret, "miss", heardName);
    }
  }

  for (const slot of s.slots) {
    if (slot.found) put(slot.found.string, slot.found.fret, "correct");
    else if (s.timedOut) for (const p of slot.positions) put(p.string, p.fret, "miss");
  }
  return [...dots.values()];
}
