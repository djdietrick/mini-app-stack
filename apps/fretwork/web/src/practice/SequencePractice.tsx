import { type ReactNode, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { SequenceConfig } from "../../../src/domain/types.js";
import type { Heard } from "../../../src/practice/find.js";
import {
  type Ladder,
  type SequenceState,
  advanceLadder,
  clampTempo,
  gradeNote,
  initSequence,
  ladderFromRuns,
  sequenceKey,
  sequenceReducer,
  sequenceRun,
  sequenceStats,
} from "../../../src/practice/sequence.js";
import { type Spelling, midiAt, midiName, noteName } from "../../../src/theory/index.js";
import { type ExerciseRow, api } from "../api";
import { startDrone, stopDrone, unlockOutput } from "../audio/output";
import { useMetronome } from "../audio/useMetronome";
import { useNoteStream } from "../audio/useNoteStream";
import { type Dot, Fretboard } from "../components/Fretboard";
import { MicPanel } from "../components/MicPanel";
import { partLabels, sequenceSpelling } from "../describe";
import { href } from "../router";
import { updateSettings, useSettings } from "../settings";
import { useApi } from "../useApi";
import { formatDuration, useSaveRun, wallClock } from "./common";
import { KeyHints, usePracticeKeys } from "./keys";
import { SaveLine } from "./SaveLine";

/** The memorisation ladder: the whole shape, then only its roots, then nothing. */
type ShapeView = "full" | "roots" | "hidden";

const SHAPE_VIEWS: { view: ShapeView; label: string }[] = [
  { view: "full", label: "Full" },
  { view: "roots", label: "Roots" },
  { view: "hidden", label: "Hidden" },
];

/**
 * Direction C, the sequence lane: the notes to play in order across the top,
 * the shape on the neck with the next note ringed, and tempo, click and the
 * ladder below. Grading and the ladder are pure (src/practice/sequence.ts);
 * the click is audio/output.ts.
 *
 * Each run is its own Round (keyed), so a new run starts from a clean
 * reducer. The click, the drone and the ladder live here and carry across
 * runs. The ladder starts where the server's progress left it, and moves
 * here by the same rule (advanceLadder) the server applies to each run.
 */
export function SequencePractice({ exercise, config }: { exercise: ExerciseRow; config: SequenceConfig }) {
  const [round, setRound] = useState(0);
  const [opening, setOpening] = useState<Heard | null>(null);
  const [ladder, setLadder] = useState<Ladder>(() => ({ tempo: clampTempo(config.tempo.start), streak: 0 }));
  const [bumpedTo, setBumpedTo] = useState<number | null>(null);
  const [clickOn, setClickOn] = useState(false);
  const [droneOn, setDroneOn] = useState(false);
  const [view, setView] = useState<ShapeView>("full");
  const { droneLevel, headphones } = useSettings();
  const { beat } = useMetronome(ladder.tempo, clickOn);

  // The server keeps the ladder (GET /progress). An exercise last played
  // before it did has no progress row, so rebuild it from its recent runs.
  // Once the ladder has moved here, a late response mustn't undo it.
  const touched = useRef(false);
  const start = useApi(`ladder:${exercise.id}`, async (): Promise<Ladder | null> => {
    const row = (await api.listProgress()).find((p) => p.exercise_id === exercise.id);
    if (row?.tempo != null) return { tempo: row.tempo, streak: row.clean_streak };
    const runs = await api.listRuns({ exerciseId: exercise.id, limit: 50 });
    return runs.length ? ladderFromRuns(runs, config.tempo) : null;
  });
  useEffect(() => {
    if (start.data && !touched.current) setLadder(start.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start.data]);

  useEffect(() => () => stopDrone(), []);

  const spelling = sequenceSpelling(config);
  const droneRoot = sequenceKey(config).root;
  const nudgeBy = config.tempo.step || 4;

  const onFinish = (clean: boolean) => {
    touched.current = true;
    const next = advanceLadder(ladder, clean, config.tempo);
    setLadder({ tempo: next.tempo, streak: next.streak });
    setBumpedTo(next.bumped ? next.tempo : null);
  };
  const again = (note?: Heard) => {
    setOpening(note ?? null);
    setBumpedTo(null);
    setRound((r) => r + 1);
  };
  const nudge = (d: number) => {
    touched.current = true;
    setLadder((l) => ({ tempo: clampTempo(l.tempo + d), streak: 0 }));
  };
  const toggleClick = () => {
    if (!clickOn) unlockOutput();
    setClickOn(!clickOn);
  };
  const toggleDrone = () => {
    if (droneOn) stopDrone();
    else startDrone(droneRoot);
    setDroneOn(!droneOn);
  };

  const panel = (
    <>
      <section className="card flex flex-col gap-3 p-4" aria-labelledby="tempo-h">
        <div className="flex items-center justify-between gap-3">
          <h2 id="tempo-h" className="label-caps">
            Tempo
          </h2>
          <BeatDots beat={beat} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn w-11 px-0" aria-label={`Slower by ${nudgeBy} bpm`} onClick={() => nudge(-nudgeBy)}>
            −
          </button>
          <output className="min-w-[4.5rem] text-center font-mono text-3xl" aria-live="polite">
            {ladder.tempo}
            <span className="text-[13px] text-muted"> bpm</span>
          </output>
          <button type="button" className="btn w-11 px-0" aria-label={`Faster by ${nudgeBy} bpm`} onClick={() => nudge(nudgeBy)}>
            +
          </button>
          <button
            type="button"
            aria-pressed={clickOn}
            onClick={toggleClick}
            className={"btn ml-auto " + (clickOn ? "border-brass text-brass" : "")}
          >
            {clickOn ? "Click on" : "Click off"}
          </button>
        </div>
        <p className="text-[13px] text-muted">
          {config.tempo.step === 0
            ? `${ladder.streak} clean ${ladder.streak === 1 ? "run" : "runs"} in a row. This exercise keeps its tempo.`
            : `${ladder.streak} of ${config.tempo.cleanRunsToAdvance} clean runs to ${clampTempo(ladder.tempo + config.tempo.step)} bpm.`}{" "}
          Rhythm isn't graded yet: the click sets the pace.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-raised p-1" role="group" aria-label="Shape on the neck">
          {SHAPE_VIEWS.map((v) => (
            <button
              key={v.view}
              type="button"
              aria-pressed={view === v.view}
              onClick={() => setView(v.view)}
              className={
                "focus-ring min-h-[40px] rounded-lg px-3 text-[13px] " +
                (view === v.view ? "bg-brass font-semibold text-brass-ink" : "text-muted")
              }
            >
              {v.label}
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={droneOn} onClick={toggleDrone} className={"btn " + (droneOn ? "border-brass text-brass" : "")}>
          Drone on {noteName(droneRoot, spelling)}
        </button>
        <button type="button" onClick={() => again()} className="btn">
          Restart
        </button>
      </div>
      {droneOn && (
        <div className="card flex flex-col gap-2 p-3">
          <label className="flex items-center gap-3 text-[13px] text-muted">
            <span className="shrink-0">Drone level</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={droneLevel}
              onChange={(e) => updateSettings({ droneLevel: Number(e.target.value) })}
              className="w-full accent-[#e5a54b]"
            />
          </label>
          {!headphones && (
            <p className="text-[13px] text-faint">Use headphones with the drone: through a speaker, the mic hears it too.</p>
          )}
        </div>
      )}
    </>
  );

  return (
    <Round
      key={round}
      exercise={exercise}
      config={config}
      tempo={ladder.tempo}
      opening={opening}
      view={view}
      spelling={spelling}
      bumpedTo={bumpedTo}
      onFinish={onFinish}
      onAgain={again}
      panel={panel}
    />
  );
}

interface RoundProps {
  exercise: ExerciseRow;
  config: SequenceConfig;
  tempo: number;
  /** The note that started this run hands-free, if one did. */
  opening: Heard | null;
  view: ShapeView;
  spelling: Spelling;
  bumpedTo: number | null;
  onFinish: (clean: boolean) => void;
  onAgain: (opening?: Heard) => void;
  panel: ReactNode;
}

function Round({ exercise, config, tempo, opening, view, spelling, bumpedTo, onFinish, onAgain, panel }: RoundProps) {
  const fresh = useMemo(() => initSequence(config), [config]);
  const [s, dispatch] = useReducer(sequenceReducer, undefined, () =>
    opening ? sequenceReducer(fresh, { type: "heard", note: opening }) : fresh,
  );
  const ended = s.endedAt !== null;

  const mic = useNoteStream((n) => {
    const note = { midi: n.midi, at: n.at, position: n.position };
    // After a run, playing its first note starts the next one: no hands needed.
    if (ended) {
      if (s.notes.length && gradeNote(fresh, note).kind === "right") onAgain(note);
      return;
    }
    dispatch({ type: "heard", note });
  });

  // Keyed on the end time only, so the run is built, saved and counted once.
  const run = useMemo(
    () => (ended && s.startedAt !== null ? sequenceRun(s, exercise.id, wallClock(s.startedAt), tempo) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.endedAt],
  );
  const save = useSaveRun(run);
  useEffect(() => {
    if (run) onFinish(run.clean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const stats = sequenceStats(s);
  const first = s.notes[0]?.target;
  const keys = { toggle: () => (mic.status === "listening" ? mic.stop() : void mic.start()), restart: () => onAgain() };
  usePracticeKeys(keys);
  const frame = { lo: Math.max(0, config.frets.lo - 1), hi: config.frets.hi >= 12 ? config.frets.hi : config.frets.hi + 1 };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <a href={href({ name: "exercise", id: exercise.id })} className="focus-ring truncate rounded text-sm text-muted">
          ← {exercise.name}
        </a>
        <span className="shrink-0 font-mono text-[13px] text-muted">
          {s.notes.length > 0 && `${Math.min(s.index + (ended ? 0 : 1), s.notes.length)} of ${s.notes.length}`}
          {stats.accuracy !== null && ` · ${Math.round(stats.accuracy * 100)}%`}
        </span>
      </div>

      {s.notes.length === 0 ? (
        <p className="card p-4 text-[15px] text-muted">
          Nothing to play: none of these notes fit in frets {config.frets.lo}–{config.frets.hi} on these strings.
        </p>
      ) : (
        <div className="sticky top-0 z-10 -mx-5 flex flex-col gap-1 bg-ground/95 px-5 py-2 md:-mx-8 md:px-8 backdrop-blur">
          <Parts labels={partLabels(config)} current={s.notes[Math.min(s.index, s.notes.length - 1)].target.part} />
          <Lane s={s} spelling={spelling} />
          <div aria-live="polite" aria-atomic="true">
            <Feedback s={s} spelling={spelling} />
          </div>
        </div>
      )}

      {/* Phone: one column, the panel under the neck. From lg (direction C, wide):
          the lane stays across the top, the neck fills the left, and tempo,
          the ladder and the run's numbers sit in a side panel. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4">
          {ended && run && (
            <section className="card flex flex-col gap-3 p-4" aria-labelledby="result-h">
              <h2 id="result-h" className="font-display text-xl font-bold">
                {run.clean ? "Clean run" : `${run.notesClean}/${run.notesTotal} right first time`}
              </h2>
              <p className="font-mono text-[15px]">
                {formatDuration(run.durationMs)} · {run.tempo} bpm
              </p>
              {bumpedTo !== null && <p className="text-[15px] text-correct">Tempo up: {bumpedTo} bpm.</p>}
              <SaveLine status={save.status} retry={save.retry} />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => onAgain()} className="btn-primary">
                  Run again
                </button>
                {first && <span className="text-[15px] text-muted">or play {midiName(first.midi, spelling)} to go again</span>}
              </div>
            </section>
          )}

          {s.notes.length > 0 && !ended && <MicPanel mic={mic} compact fallback="No mic? Tap the notes on the neck." />}

          {s.notes.length > 0 && (
            <Fretboard
              frets={frame}
              highlight={config.frets}
              activeString={config.strings.length === 1 ? config.strings[0] : undefined}
              dots={dotsFor(s, view, spelling)}
              onPress={(string, fret) => mic.tap(midiAt(string, fret), { string, fret })}
              title={`Neck, frets ${frame.lo} to ${frame.hi}. Tap a position to play it.`}
            />
          )}
        </div>

        <aside className="flex flex-col gap-4" aria-label="Tempo and run">
          {s.notes.length > 0 && (
            <dl className="hidden grid-cols-2 gap-2 lg:grid">
              <div className="card flex flex-col items-center gap-1 py-2">
                <dt className="label-caps">Note</dt>
                <dd className="font-mono text-lg">
                  {Math.min(s.index + (ended ? 0 : 1), s.notes.length)}/{s.notes.length}
                </dd>
              </div>
              <div className="card flex flex-col items-center gap-1 py-2">
                <dt className="label-caps">Accuracy</dt>
                <dd className="font-mono text-lg">{stats.accuracy === null ? "–" : `${Math.round(stats.accuracy * 100)}%`}</dd>
              </div>
            </dl>
          )}
          {panel}
          <KeyHints keys={keys} />
        </aside>
      </div>
    </div>
  );
}

/** A multi-part source's chords or positions, the one being played lit. */
function Parts({ labels, current }: { labels: string[]; current: number }) {
  if (labels.length < 2) return null;
  return (
    <ol className="flex flex-wrap gap-1.5 text-[13px]" aria-label="Parts">
      {labels.map((l, i) => (
        <li
          key={i}
          aria-current={i === current ? "step" : undefined}
          className={"rounded-lg px-2 py-0.5 font-mono " + (i === current ? "bg-brass text-brass-ink" : "bg-raised text-muted")}
        >
          {l}
        </li>
      ))}
    </ol>
  );
}

/** The notes in order: played, the one now, and those to come. Scrolls to keep the current one centred. */
function Lane({ s, spelling }: { s: SequenceState; spelling: Spelling }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = ref.current;
    const chip = list?.children[Math.min(s.index, s.notes.length - 1)] as HTMLElement | undefined;
    if (!list || !chip) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: chip.offsetLeft - list.clientWidth / 2 + chip.offsetWidth / 2, behavior: reduce ? "auto" : "smooth" });
  }, [s.index, s.notes.length]);

  return (
    <ol ref={ref} className="relative flex gap-1.5 overflow-x-auto py-1" aria-label="Notes to play, in order">
      {s.notes.map((n, i) => {
        const now = i === s.index && s.endedAt === null;
        const state = n.done ? (n.missed ? "missed" : "clean") : now ? (n.missed ? "retry" : "now") : "todo";
        return (
          <li
            key={i}
            aria-current={now ? "step" : undefined}
            aria-label={`${midiName(n.target.midi, spelling)}, ${n.target.degree}: ${LANE_WORDS[state]}`}
            className={
              "flex h-14 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border-2 " +
              (state === "clean"
                ? "border-correct bg-correct text-correct-ink"
                : state === "missed"
                  ? "border-miss text-miss"
                  : state === "now"
                    ? "border-brass bg-raised text-ink"
                    : state === "retry"
                      ? "border-miss bg-raised text-ink"
                      : "border-line text-muted")
            }
          >
            <span className="font-display text-base font-bold leading-none">
              {noteName(n.target.midi, spelling)}
              {state === "missed" || state === "retry" ? "✕" : ""}
            </span>
            <span className="font-mono text-[11px] leading-none">{n.target.degree}</span>
          </li>
        );
      })}
    </ol>
  );
}

const LANE_WORDS = {
  clean: "right first time",
  missed: "played after a miss",
  now: "play this now",
  retry: "missed, play it again",
  todo: "to come",
} as const;

function Feedback({ s, spelling }: { s: SequenceState; spelling: Spelling }) {
  const f = s.last?.feedback;
  const name = (m: number) => midiName(m, spelling);
  const next = s.notes[s.index]?.target;
  let text: string;
  let tone = "text-muted";
  if (s.endedAt !== null) {
    text = "Done.";
  } else if (!f) {
    text = next ? `Start on ${name(next.midi)}. The run starts on your first note.` : "";
  } else {
    switch (f.kind) {
      case "right":
        tone = "text-correct";
        text = f.elsewhere
          ? `✓ ${name(f.midi)}: right pitch, somewhere else. It counts; the mic can't tell where you played it.`
          : `✓ ${name(f.midi)}`;
        break;
      case "repeat":
        text = `${name(f.midi)} again. Next: ${next ? name(next.midi) : ""}.`;
        break;
      case "wrong-octave":
        tone = "text-miss";
        text = `✕ ${name(f.midi)}: right note, wrong octave. It's ${name(f.expected)}.`;
        break;
      case "wrong-note":
        tone = "text-miss";
        text = s.startedAt === null ? `✕ Heard ${name(f.midi)}. Start on ${name(f.expected)}.` : `✕ Heard ${name(f.midi)}. Play ${name(f.expected)}.`;
        break;
    }
  }
  return <p className={"min-h-[1.5em] text-lg leading-snug " + tone}>{text}</p>;
}

/**
 * The shape as the view allows (all of it once the run is over), the next
 * note ringed when the shape shows, the note just played lit, and a miss
 * where a tap landed. A miss from the mic has no place on the neck: the mic
 * can't say where it was played.
 */
function dotsFor(s: SequenceState, view: ShapeView, spelling: Spelling): Dot[] {
  const dots = new Map<string, Dot>();
  const put = (string: number, fret: number, tone: Dot["tone"], midi: number, degree?: string) =>
    dots.set(`${string}:${fret}`, { string, fret, tone, name: noteName(midi, spelling), degree });
  const ended = s.endedAt !== null;
  const shown = ended ? "full" : view;
  // A multi-part source (ii–V–I, CAGED) shows the part being played: its
  // shape and degrees, not every chord on top of each other.
  const part = s.notes[Math.min(s.index, s.notes.length - 1)]?.target.part ?? 0;

  for (const { target: t } of s.notes) {
    if (t.part !== part) continue;
    if (shown === "full" || (shown === "roots" && t.interval === 0)) put(t.string, t.fret, t.interval === 0 ? "root" : "note", t.midi, t.degree);
  }
  if (ended) return [...dots.values()];

  const next = s.notes[s.index]?.target;
  if (next && shown === "full") put(next.string, next.fret, "target", next.midi, next.degree);

  const last = s.last;
  if (last?.feedback.kind === "right" && s.index > 0) {
    const t = s.notes[s.index - 1].target;
    const at = last.heard.position ?? t;
    put(at.string, at.fret, "correct", last.heard.midi, t.degree);
  }
  if ((last?.feedback.kind === "wrong-note" || last?.feedback.kind === "wrong-octave") && last.heard.position) {
    put(last.heard.position.string, last.heard.position.fret, "miss", last.heard.midi);
  }
  return [...dots.values()];
}

/** Four beats, the downbeat larger; the one being heard lit. */
function BeatDots({ beat }: { beat: number | null }) {
  return (
    <span className="flex items-center gap-1.5" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={
            "rounded-full " +
            (i === 0 ? "h-3 w-3 " : "h-2 w-2 ") +
            (beat !== null && beat % 4 === i ? "bg-brass" : "bg-raised")
          }
        />
      ))}
    </span>
  );
}
