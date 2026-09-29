import { noteName, shapeInWindow } from "../../../src/theory/index.js";
import { playNotes } from "../audio/output";
import { useNoteStream } from "../audio/useNoteStream";
import { type Dot, Fretboard } from "../components/Fretboard";
import { LevelMeter, MicPanel } from "../components/MicPanel";
import { href } from "../router";
import { A4_RANGE, DEFAULT_SETTINGS, GATE_RANGE, type LabelMode, updateSettings, useSettings } from "../settings";

const LABEL_MODES: { mode: LabelMode; label: string }[] = [
  { mode: "names", label: "Note names" },
  { mode: "degrees", label: "Degrees" },
  { mode: "none", label: "None" },
];

/**
 * A minor pentatonic box 1 for the preview, with one dot in each feedback
 * state so the label and handedness choices can be judged on all of them.
 */
const PENTATONIC_PREVIEW: Dot[] = shapeInWindow(9, [0, 3, 5, 7, 10], { lo: 5, hi: 8 }).map((n, i) => ({
  string: n.string,
  fret: n.fret,
  name: noteName(n.midi),
  degree: n.degree,
  tone: i === 3 ? "correct" : i === 4 ? "miss" : i === 5 ? "target" : n.interval === 0 ? "root" : "note",
}));

/** Gate slider position (0–100) ↔ RMS, on a log scale so each step is the same in dB. */
const gateToPos = (g: number) =>
  (Math.log(g / GATE_RANGE.min) / Math.log(GATE_RANGE.max / GATE_RANGE.min)) * 100;
const posToGate = (p: number) => GATE_RANGE.min * (GATE_RANGE.max / GATE_RANGE.min) ** (p / 100);

const SWITCH =
  "focus-ring h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-raised transition before:block before:h-5 before:w-5 before:translate-x-0.5 before:rounded-full before:bg-muted before:transition checked:bg-brass checked:before:translate-x-[22px] checked:before:bg-brass-ink";

/** Settings for this device: how the neck is drawn, how the mic listens and how the app sounds. */
export function Settings() {
  const settings = useSettings();
  const mic = useNoteStream();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-bold">Settings</h1>

      <section className="flex flex-col gap-3" aria-labelledby="neck-h">
        <h2 id="neck-h" className="label-caps">The neck</h2>
        <div className="card flex flex-col gap-4 p-4">
          <label className="flex min-h-[44px] items-center justify-between gap-3">
            <span className="text-[15px]">Left-handed</span>
            <input
              type="checkbox"
              role="switch"
              checked={settings.leftHanded}
              onChange={(e) => updateSettings({ leftHanded: e.target.checked })}
              className={SWITCH}
            />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[15px]">Labels on the dots</legend>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-raised p-1">
              {LABEL_MODES.map(({ mode, label }) => (
                <label
                  key={mode}
                  className={
                    "flex min-h-[40px] cursor-pointer items-center justify-center rounded-lg text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brass " +
                    (settings.labels === mode ? "bg-brass font-semibold text-brass-ink" : "text-muted")
                  }
                >
                  <input
                    type="radio"
                    name="labels"
                    value={mode}
                    checked={settings.labels === mode}
                    onChange={() => updateSettings({ labels: mode })}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-[13px] text-faint">"None" hides them, for practising from memory.</p>
          </fieldset>

          <Fretboard
            frets={{ lo: 4, hi: 9 }}
            highlight={{ lo: 5, hi: 8 }}
            dots={PENTATONIC_PREVIEW}
            title="Preview: A minor pentatonic, with a target, a hit and a miss"
          />
          <p className="text-[13px] text-faint">
            The ringed dot is the target. Filled with a tick is a hit; a dark ring with a cross is a miss.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="mic-h">
        <h2 id="mic-h" className="label-caps">Microphone</h2>
        <MicPanel mic={mic} />
        <div className="card flex flex-col gap-3 p-4">
          <label htmlFor="gate" className="text-[15px]">
            Sensitivity
          </label>
          <input
            id="gate"
            type="range"
            min={0}
            max={100}
            step={1}
            // Right is more sensitive: a lower gate.
            value={100 - gateToPos(settings.gate)}
            onChange={(e) => updateSettings({ gate: posToGate(100 - Number(e.target.value)) })}
            className="w-full accent-[#e5a54b]"
          />
          <div className="flex justify-between text-[13px] text-faint">
            <span>Ignores more noise</span>
            <span>Hears quieter notes</span>
          </div>
          <LevelMeter level={mic.level} />
          <p className="text-[13px] text-faint">
            Notes count once the level passes the brass mark. Turn the mic on and play to check.
          </p>
          <button
            type="button"
            className="btn self-start"
            onClick={() => updateSettings({ gate: DEFAULT_SETTINGS.gate })}
            disabled={settings.gate === DEFAULT_SETTINGS.gate}
          >
            Reset sensitivity
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="sound-h">
        <h2 id="sound-h" className="label-caps">Sound</h2>
        <div className="card flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-2">
            <span className="text-[15px]">Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) => updateSettings({ volume: Number(e.target.value), muted: false })}
              className="w-full accent-[#e5a54b]"
            />
          </label>
          <label className="flex min-h-[44px] items-center justify-between gap-3">
            <span className="text-[15px]">Mute</span>
            <input
              type="checkbox"
              role="switch"
              checked={settings.muted}
              onChange={(e) => updateSettings({ muted: e.target.checked })}
              className={SWITCH}
            />
          </label>
          <label className="flex min-h-[44px] items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-[15px]">I use headphones</span>
              <span className="text-[13px] text-faint">
                Off, the mic stops listening while the app plays a note, so it doesn't grade its own sound. On, it
                keeps listening.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={settings.headphones}
              onChange={(e) => updateSettings({ headphones: e.target.checked })}
              className={SWITCH}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn" onClick={() => playNotes([69])}>
              Play A4
            </button>
            <span className="text-[13px] text-faint">At {settings.a4} Hz. Tones follow the reference pitch below.</span>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="ref-h">
        <h2 id="ref-h" className="label-caps">Reference pitch</h2>
        <div className="card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px]">A4</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn w-11 px-0"
                aria-label="Lower A4 by 1 Hz"
                disabled={settings.a4 <= A4_RANGE.min}
                onClick={() => updateSettings({ a4: settings.a4 - 1 })}
              >
                −
              </button>
              <output className="w-20 text-center font-mono text-lg" aria-live="polite">
                {settings.a4} Hz
              </output>
              <button
                type="button"
                className="btn w-11 px-0"
                aria-label="Raise A4 by 1 Hz"
                disabled={settings.a4 >= A4_RANGE.max}
                onClick={() => updateSettings({ a4: settings.a4 + 1 })}
              >
                +
              </button>
            </div>
          </div>
          <p className="text-[13px] text-faint">
            Standard is 440. Change it to match a piano or a recording that's tuned differently.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => updateSettings({ a4: DEFAULT_SETTINGS.a4 })}
              disabled={settings.a4 === DEFAULT_SETTINGS.a4}
            >
              Reset to 440
            </button>
            <a href={href({ name: "tune" })} className="btn focus-ring">
              Tune up
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
