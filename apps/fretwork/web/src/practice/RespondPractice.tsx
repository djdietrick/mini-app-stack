import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { RespondConfig } from "../../../src/domain/types.js";
import {
  type Card,
  type RespondState,
  answerMidi,
  initRespond,
  respondReducer,
  respondRun,
  respondStats,
} from "../../../src/practice/respond.js";
import { intervalName, midiAt, midiName, noteName, positionsOfMidi, stringName } from "../../../src/theory/index.js";
import type { ExerciseRow } from "../api";
import { audioRunning } from "../audio/context";
import { playNotes } from "../audio/output";
import { useNoteStream } from "../audio/useNoteStream";
import { type Dot, Fretboard } from "../components/Fretboard";
import { MicPanel } from "../components/MicPanel";
import { Needle } from "../components/Needle";
import { type StripDot, StringStrip } from "../components/StringStrip";
import { href } from "../router";
import { formatDuration, useNow, useSaveRun, wallClock } from "./common";
import { SaveLine } from "./SaveLine";

/** How long a right answer stays up before the next card. */
const BEAT_MS = 900;

/**
 * Direction B, flashcards + tuner: one big prompt, a cents needle for what the
 * mic hears, the answer revealed on the string, and streak, score and time.
 * Grading and the adaptive deck are the pure reducer in src/practice/respond.ts.
 *
 * "Play what you hear" plays each card's note as it is dealt, once a tap has
 * unlocked sound (before that, the card shows a button), and the mic is deaf
 * while it sounds (see audio/output.ts). An interval can be heard once
 * answered.
 */
export function RespondPractice({ exercise, config }: { exercise: ExerciseRow; config: RespondConfig }) {
  const [round, setRound] = useState(0);
  return <Deck key={round} exercise={exercise} config={config} onAgain={() => setRound((r) => r + 1)} />;
}

function Deck({ exercise, config, onAgain }: { exercise: ExerciseRow; config: RespondConfig; onAgain: () => void }) {
  const [s, dispatch] = useReducer(respondReducer, undefined, () =>
    respondReducer(initRespond(config), { type: "start", at: performance.now(), rand: Math.random() }),
  );
  const mic = useNoteStream((n) => dispatch({ type: "heard", note: { midi: n.midi, at: n.at, position: n.position } }));

  // Time spent allowing the mic shouldn't count against the card showing.
  useEffect(() => {
    if (mic.status === "listening") dispatch({ type: "reclock", at: performance.now() });
  }, [mic.status]);

  const ended = s.endedAt !== null;
  const asking = !ended && s.phase === "asking";
  const limitMs = config.timeLimitSec ? config.timeLimitSec * 1000 : null;
  const now = useNow(asking && limitMs !== null);

  useEffect(() => {
    if (asking && limitMs !== null && now - s.shownAt >= limitMs) dispatch({ type: "timeout", at: s.shownAt + limitMs });
  }, [asking, limitMs, now, s.shownAt]);

  // A right answer moves on by itself after a beat; a skip or timeout waits for Next.
  const right = s.phase === "answered" && s.last?.feedback.kind === "right";
  useEffect(() => {
    if (!right || ended) return;
    const id = window.setTimeout(() => dispatch({ type: "next", at: performance.now(), rand: Math.random() }), BEAT_MS);
    return () => window.clearTimeout(id);
  }, [right, ended, s.index]);

  // Keyed on the end time only, so the run is built (and saved) once.
  const run = useMemo(
    () => (ended && s.results.length ? respondRun(s, exercise.id, wallClock(s.startedAt ?? s.endedAt!)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.endedAt],
  );
  const save = useSaveRun(run);
  const stats = respondStats(s);
  const next = () => dispatch({ type: "next", at: performance.now(), rand: Math.random() });

  // Each heard-note card plays as it is dealt, once sound is unlocked. The ref
  // keeps a card from playing twice (StrictMode runs effects twice in dev).
  const played = useRef(-1);
  useEffect(() => {
    if (s.card?.kind !== "play-heard-note" || s.phase !== "asking" || played.current === s.index) return;
    if (!audioRunning()) return;
    played.current = s.index;
    playNotes([s.card.midi]);
  }, [s.card, s.phase, s.index]);
  const hear = () => {
    const card = s.card;
    if (!card) return;
    played.current = s.index;
    if (card.kind === "play-heard-note") {
      playNotes([card.midi]);
      // A card waiting for its first play shouldn't be timed until it is heard.
      dispatch({ type: "reclock", at: performance.now() });
    } else if (card.kind === "interval") {
      const upper = answerMidi(card, s.rootMidi);
      playNotes([upper - card.semitones, upper]);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <a href={href({ name: "exercise", id: exercise.id })} className="focus-ring truncate rounded text-sm text-muted">
          ← {exercise.name}
        </a>
        <span className="shrink-0 font-mono text-[13px] text-muted">
          {ended ? `${s.results.length} cards` : `Card ${s.index + 1} of ${s.total}`}
          {asking && limitMs !== null && (
            <span className={Math.max(0, limitMs - (now - s.shownAt)) < 3000 ? " text-miss" : " text-brass"}>
              {" "}· {Math.ceil(Math.max(0, limitMs - (now - s.shownAt)) / 1000)} s
            </span>
          )}
        </span>
      </div>

      {s.pool.length === 0 ? (
        <p className="card p-4 text-[15px] text-muted">
          Nothing to ask: none of these notes fit in frets {config.frets.lo}–{config.frets.hi} on these strings.
        </p>
      ) : ended ? (
        <section className="card flex flex-col gap-3 p-5" aria-labelledby="result-h">
          <h1 id="result-h" className="font-display text-2xl font-bold">
            Deck done
          </h1>
          <p className="font-mono text-[15px]">
            {stats.right}/{stats.answered} right first time
            {stats.averageMs !== null && ` · ${formatDuration(stats.averageMs)} average`}
          </p>
          <SaveLine status={save.status} retry={save.retry} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onAgain} className="btn-primary">
              Another deck
            </button>
            <a href={href({ name: "library" })} className="btn focus-ring">
              Library
            </a>
          </div>
        </section>
      ) : (
        <>
          {s.card && <Prompt card={s.card} s={s} onHear={hear} />}
          {mic.status !== "listening" && (
            <MicPanel mic={mic} compact fallback={`No mic? Tap the answer ${s.card?.kind === "note-on-string" ? "on the string" : "on the neck"}.`} />
          )}
          {mic.status === "listening" && (
            <div className="flex flex-col items-center gap-1">
              <Needle live={mic.live} className="h-10" />
              <span className="font-mono text-[13px] text-muted">
                {mic.live ? `${midiName(mic.live.midi)} ${mic.live.cents >= 0 ? "+" : "−"}${Math.abs(mic.live.cents).toFixed(0)}¢` : "Listening"}
              </span>
            </div>
          )}
          {s.card && <Answer card={s.card} s={s} config={config} tap={mic.tap} />}
          <div className="flex gap-2">
            {s.phase === "asking" ? (
              <button type="button" onClick={() => dispatch({ type: "skip", at: performance.now() })} className="btn">
                Skip
              </button>
            ) : (
              <button type="button" onClick={next} className="btn-primary">
                {s.results.length >= s.total ? "Finish" : "Next"}
              </button>
            )}
          </div>
        </>
      )}

      {s.pool.length > 0 && (
        <dl className="grid grid-cols-3 gap-2">
          <Stat label="Streak" value={String(stats.streak)} />
          <Stat label="Score" value={`${stats.right}/${stats.answered}`} />
          <Stat label="Average" value={stats.averageMs === null ? "–" : formatDuration(stats.averageMs)} />
        </dl>
      )}
    </div>
  );
}

function Prompt({ card, s, onHear }: { card: Card; s: RespondState; onHear: () => void }) {
  const answered = s.phase === "answered";
  const tone = answered ? (s.last?.feedback.kind === "right" ? "border-correct" : "border-miss") : "border-line";
  return (
    <section className={"card flex flex-col items-center gap-2 border-2 px-4 py-6 text-center " + tone} aria-live="polite" aria-atomic="true">
      {card.kind === "note-on-string" && (
        <>
          <span className="font-display text-7xl font-bold leading-none text-brass">{noteName(card.pc)}</span>
          <span className="font-display text-xl text-muted">on the {stringName(card.string)} string</span>
        </>
      )}
      {card.kind === "interval" && (
        <>
          <span className="font-display text-4xl font-bold leading-tight">
            <span className={s.rootMidi !== null ? "text-correct" : "text-brass"}>{noteName(card.root)}</span>
            <span className="text-muted"> → </span>
            <span className="text-brass">{intervalName(card.semitones)}</span>
          </span>
          <span className="text-[15px] text-muted">
            {s.rootMidi === null ? `Play ${noteName(card.root)}, then the note a ${intervalName(card.semitones)} above.` : `Now a ${intervalName(card.semitones)} above ${midiName(s.rootMidi)}.`}
          </span>
          {answered && (
            <button type="button" onClick={onHear} className="btn">
              Hear it
            </button>
          )}
        </>
      )}
      {card.kind === "play-heard-note" && (
        <>
          <span className="font-display text-3xl font-bold">Play the note you hear</span>
          <button type="button" onClick={onHear} className={answered ? "btn" : "btn-primary"}>
            {answered ? "Hear it again" : "▶ Play it"}
          </button>
        </>
      )}
      <Feedback s={s} />
    </section>
  );
}

function Feedback({ s }: { s: RespondState }) {
  const f = s.last?.feedback;
  if (!f) return <p className="min-h-[1.5em] text-[15px] text-faint">&nbsp;</p>;
  const card = s.card!;
  let text = "";
  let tone = "text-miss";
  switch (f.kind) {
    case "right": {
      tone = "text-correct";
      const r = s.results[s.results.length - 1];
      text = f.elsewhere
        ? `✓ ${midiName(f.midi)}: right pitch, on another string. It counts; the mic can't tell strings apart.`
        : `✓ ${midiName(f.midi)} · ${formatDuration(r.ms)}`;
      break;
    }
    case "root":
      tone = "text-correct";
      text = `${midiName(f.midi)} ✓ Now the ${card.kind === "interval" ? intervalName(card.semitones) : "next note"}.`;
      break;
    case "wrong-octave":
      text = `✕ ${midiName(f.midi)}: right note, wrong octave. It's ${midiName(f.expected)}.`;
      break;
    case "wrong-note":
      text =
        card.kind === "interval" && s.rootMidi === null
          ? `✕ ${midiName(f.midi)}: start on ${noteName(card.root)}.`
          : `✕ Heard ${midiName(f.midi)}.`;
      break;
    case "wrong-interval":
      text = `✕ ${midiName(f.midi)} is ${f.semitones > 0 && f.semitones <= 12 ? `a ${intervalName(f.semitones)}` : `${f.semitones} semitones`} from the root.`;
      break;
    case "skipped":
    case "timeout":
      tone = "text-muted";
      text = `${f.kind === "timeout" ? "Time's up. " : ""}The answer: ${midiName(answerMidi(card, s.rootMidi))}.`;
      break;
  }
  return <p className={"min-h-[1.5em] text-[15px] " + tone}>{text}</p>;
}

/** The answer's place: the one string for note-on-string, the neck otherwise. Also the tap fallback. */
function Answer({
  card,
  s,
  config,
  tap,
}: {
  card: Card;
  s: RespondState;
  config: RespondConfig;
  tap: (midi: number, position?: { string: number; fret: number }) => void;
}) {
  const answered = s.phase === "answered";
  const f = s.last?.feedback;
  const missAt = !answered && (f?.kind === "wrong-note" || f?.kind === "wrong-octave" || f?.kind === "wrong-interval") ? s.last?.heard : null;

  if (card.kind === "note-on-string") {
    const dots: StripDot[] = [];
    if (missAt?.position?.string === card.string) dots.push({ fret: missAt.position.fret, tone: "miss", name: noteName(missAt.midi) });
    else if (missAt && !missAt.position) {
      for (const p of positionsOfMidi(missAt.midi, config.frets, [card.string])) dots.push({ fret: p.fret, tone: "miss", name: noteName(missAt.midi) });
    }
    if (answered) {
      const r = s.results[s.results.length - 1];
      const shown = f?.kind === "right" && r.position ? [r.position] : card.targets;
      for (const p of shown) dots.push({ fret: p.fret, tone: f?.kind === "right" ? "correct" : "hint", name: noteName(card.pc) });
    }
    return (
      <StringStrip
        string={card.string}
        frets={config.frets}
        dots={dots}
        onPress={(fret) => tap(midiAt(card.string, fret), { string: card.string, fret })}
      />
    );
  }

  // Interval and heard note: the whole window, since either could be anywhere on it.
  const dots: Dot[] = [];
  const put = (midi: number, tone: Dot["tone"]) => {
    for (const p of positionsOfMidi(midi, config.frets, config.strings)) dots.push({ string: p.string, fret: p.fret, tone, name: noteName(midi) });
  };
  if (s.rootMidi !== null && card.kind === "interval") put(s.rootMidi, "root");
  if (answered) put(answerMidi(card, s.rootMidi), f?.kind === "right" ? "correct" : "hint");
  if (missAt) {
    if (missAt.position) dots.push({ ...missAt.position, tone: "miss", name: noteName(missAt.midi) });
  }
  return (
    <Fretboard
      frets={config.frets}
      dots={dots}
      onPress={(string, fret) => tap(midiAt(string, fret), { string, fret })}
      title={`Neck, frets ${config.frets.lo} to ${config.frets.hi}. Tap a position to play it.`}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card flex flex-col items-center gap-1 py-2">
      <dt className="label-caps">{label}</dt>
      <dd className="font-mono text-lg">{value}</dd>
    </div>
  );
}
