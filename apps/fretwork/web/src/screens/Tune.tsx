import { STANDARD_TUNING, STRING_LETTERS, midiName, midiToFreq } from "../../../src/theory/index.js";
import { playNotes } from "../audio/output";
import { useNoteStream } from "../audio/useNoteStream";
import { MicPanel } from "../components/MicPanel";
import { IN_TUNE, Needle } from "../components/Needle";
import { href } from "../router";
import { useSettings } from "../settings";

/**
 * A chromatic tuner on the same note stream the engines use, so it doubles
 * as a check that the mic hears the guitar before practising. Each string's
 * chip plays its open note, for tuning by ear.
 */
export function Tune() {
  const mic = useNoteStream();
  const { a4 } = useSettings();
  const live = mic.status === "listening" ? mic.live : null;

  // The open string nearest the note being played, as a hint for which peg to turn.
  const nearestString = live
    ? STANDARD_TUNING.reduce((best, open, i) =>
        Math.abs(live.midi + live.cents / 100 - open) <
        Math.abs(live.midi + live.cents / 100 - STANDARD_TUNING[best])
          ? i
          : best,
      0)
    : -1;
  const inTune = live && Math.abs(live.cents) <= IN_TUNE;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-3xl font-bold">Tune up</h1>
        <a href={href({ name: "settings" })} className="focus-ring rounded font-mono text-[13px] text-muted">
          A4 = {a4} Hz
        </a>
      </header>

      <MicPanel mic={mic} />

      <section className="card flex flex-col items-center gap-4 p-6" aria-label="Tuner">
        <p className="sr-only" aria-live="polite">
          {live ? `${midiName(live.midi)}, ${inTune ? "in tune" : live.cents > 0 ? "sharp" : "flat"}` : ""}
        </p>
        <div className="flex h-24 items-end gap-1">
          <span className={"font-display text-7xl font-bold leading-none " + (inTune ? "text-correct" : live ? "text-ink" : "text-faint")}>
            {live ? midiName(live.midi).replace(/-?\d+$/, "") : "–"}
          </span>
          <span className="pb-2 font-mono text-lg text-muted">{live ? midiName(live.midi).match(/-?\d+$/)?.[0] : ""}</span>
        </div>

        <Needle live={live} />

        <p className="font-mono text-[15px] text-muted">
          {live ? (
            <>
              {live.cents >= 0 ? "+" : "−"}
              {Math.abs(live.cents).toFixed(0)} cents · {live.freq.toFixed(1)} Hz
            </>
          ) : mic.status === "listening" ? (
            "Play one string"
          ) : (
            "\u00a0"
          )}
        </p>

        <ol className="grid w-full max-w-sm grid-cols-6 gap-1.5">
          {[...STANDARD_TUNING].reverse().map((open, i) => {
            const idx = STANDARD_TUNING.length - 1 - i;
            const on = idx === nearestString;
            return (
              <li key={open}>
                <button
                  type="button"
                  onClick={() => playNotes([open], { duration: 2 })}
                  aria-label={`Play ${midiName(open)}, ${midiToFreq(open, a4).toFixed(1)} Hz`}
                  className={
                    "focus-ring flex min-h-[44px] w-full flex-col items-center rounded-lg border py-2 " +
                    (on ? (inTune ? "border-correct text-correct" : "border-brass text-brass") : "border-line text-muted")
                  }
                >
                  <span className="font-display text-lg font-bold leading-none">{STRING_LETTERS[idx]}</span>
                  <span className="font-mono text-[10px]">{midiToFreq(open, a4).toFixed(0)}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="text-[13px] text-faint">Tap a string to hear its note.</p>
      </section>
    </div>
  );
}
