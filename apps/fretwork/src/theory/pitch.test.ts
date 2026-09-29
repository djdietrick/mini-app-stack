import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NoteTracker,
  PitchDetector,
  STANDARD_TUNING,
  frameSizeFor,
  freqToMidi,
  midiName,
  midiToFreq,
  rms,
  type NoteEvent,
} from "./index.js";
import { harmonics, noise, pluck, sawtooth, sine } from "./signals.testkit.js";

const RATES = [44100, 48000];

function cents(detected: number, expected: number): number {
  return 1200 * Math.log2(detected / expected);
}

describe("pitch detector", () => {
  it("sizes frames to hold three periods of the low E", () => {
    assert.equal(frameSizeFor(44100), 2048);
    assert.equal(frameSizeFor(48000), 2048);
    assert.equal(frameSizeFor(96000), 4096);
  });

  for (const sampleRate of RATES) {
    const size = frameSizeFor(sampleRate);
    const detector = new PitchDetector(size, { sampleRate });

    it(`finds frets 0–15 on every string within ±10 cents: sine, sawtooth and pluck at ${sampleRate} Hz`, () => {
      const worst = { sine: 0, sawtooth: 0, pluck: 0 };
      for (const open of STANDARD_TUNING) {
        for (let fret = 0; fret <= 15; fret++) {
          const f = midiToFreq(open + fret);
          const name = `${midiName(open + fret)} (${f.toFixed(1)} Hz)`;

          for (const [kind, frame] of [
            ["sine", sine(f, sampleRate, size)],
            ["sawtooth", sawtooth(f, sampleRate, size)],
          ] as const) {
            const est = detector.detect(frame);
            assert.ok(est, `${kind} ${name}: no pitch`);
            const off = cents(est.freq, f);
            assert.ok(Math.abs(off) <= 10, `${kind} ${name}: ${off.toFixed(1)} cents off`);
            worst[kind] = Math.max(worst[kind], Math.abs(off));
          }

          // Skip the pick's attack: analyse a frame 50 ms into the note.
          const p = pluck(f, sampleRate, size + Math.round(sampleRate * 0.05), { seed: open * 31 + fret });
          const est = detector.detect(p.samples.subarray(p.samples.length - size));
          assert.ok(est, `pluck ${name}: no pitch`);
          const off = cents(est.freq, p.freq);
          assert.ok(Math.abs(off) <= 10, `pluck ${name}: ${off.toFixed(1)} cents off`);
          worst.pluck = Math.max(worst.pluck, Math.abs(off));
        }
      }
      // Useful when tuning the detector; the assertion above is the contract.
      assert.ok(worst.sine < 10 && worst.sawtooth < 10 && worst.pluck < 10);
    });

    it(`does not flip the octave when the 2nd harmonic is stronger (${sampleRate} Hz)`, () => {
      for (const midi of [40, 45, 52, 57, 64, 76]) {
        const f = midiToFreq(midi);
        // 2nd harmonic twice the fundamental, then a decaying series.
        const est = detector.detect(harmonics(f, [0.2, 0.4, 0.15, 0.1, 0.05], sampleRate, size));
        assert.ok(est, `${midiName(midi)}: no pitch`);
        assert.equal(Math.round(freqToMidi(est.freq)), midi, `${midiName(midi)} read as ${est.freq.toFixed(1)} Hz`);
      }
    });

    it(`returns null for silence and noise (${sampleRate} Hz)`, () => {
      assert.equal(detector.detect(new Float32Array(size)), null);
      assert.equal(detector.detect(noise(size, 1e-5)), null);
      for (let seed = 1; seed <= 20; seed++) {
        assert.equal(detector.detect(noise(size, 0.3, seed)), null, `noise seed ${seed}`);
      }
    });
  }

  it("ignores a DC offset", () => {
    const sampleRate = 48000;
    const frame = sine(110, sampleRate, 2048, 0.2).map((v) => v + 0.3);
    const est = new PitchDetector(2048, { sampleRate }).detect(frame);
    assert.ok(est);
    assert.ok(Math.abs(cents(est.freq, 110)) < 5);
  });

  it("covers drop D and fret 24 on the high E", () => {
    const sampleRate = 48000;
    const detector = new PitchDetector(2048, { sampleRate });
    for (const f of [midiToFreq(38), midiToFreq(88)]) {
      const est = detector.detect(sawtooth(f, sampleRate, 2048));
      assert.ok(est, `${f} Hz: no pitch`);
      assert.ok(Math.abs(cents(est.freq, f)) <= 10);
    }
  });
});

/**
 * Plays a sequence of plucks through detector + tracker the way the browser
 * does: a frame every `hop` samples, the tracker's RMS over the newest half
 * frame. A pluck rings until the next one starts (picking a ringing string
 * restarts it), or until `damp` silences it.
 */
function play(
  notes: { midi: number; at: number; damp?: number }[],
  totalMs: number,
  opts: { sampleRate?: number; loss?: number; noiseFloor?: number } = {},
): NoteEvent[] {
  const sampleRate = opts.sampleRate ?? 48000;
  const total = Math.round((totalMs / 1000) * sampleRate);
  const signal = noise(total, opts.noiseFloor ?? 0.002, 99);
  notes.forEach((n, i) => {
    const start = Math.round((n.at / 1000) * sampleRate);
    const nextAt = notes[i + 1]?.at ?? totalMs;
    const end = Math.round((Math.min(n.damp ?? nextAt, nextAt) / 1000) * sampleRate);
    const { samples } = pluck(midiToFreq(n.midi), sampleRate, end - start, { seed: i + 1, loss: opts.loss });
    // A few ms fade at the end: a hand damping the string, not a click.
    const fade = Math.min(samples.length, Math.round(sampleRate * 0.005));
    for (let j = 0; j < samples.length; j++) {
      const g = j >= samples.length - fade ? (samples.length - j) / fade : 1;
      signal[start + j] += samples[j] * g;
    }
  });

  const size = frameSizeFor(sampleRate);
  const hop = size / 4;
  const detector = new PitchDetector(size, { sampleRate });
  const tracker = new NoteTracker();
  const events: NoteEvent[] = [];
  for (let end = size; end <= total; end += hop) {
    const frame = signal.subarray(end - size, end);
    const ev = tracker.push({
      pitch: detector.detect(frame),
      rms: rms(frame, size / 2),
      at: (end / sampleRate) * 1000,
    });
    if (ev) events.push(ev);
  }
  return events;
}

describe("note tracker", () => {
  it("emits exactly one event per pluck, including a re-picked ringing note", () => {
    const notes = [
      { midi: 45, at: 100 },
      { midi: 45, at: 600 }, // same note again while it still rings
      { midi: 48, at: 1100 },
      { midi: 52, at: 1500, damp: 1900 },
      { midi: 52, at: 2300 }, // same note after silence
      { midi: 64, at: 2700 },
      { midi: 67, at: 2950 }, // quick change
      { midi: 64, at: 3200 },
    ];
    const events = play(notes, 3700);
    assert.deepEqual(
      events.map((e) => midiName(e.midi)),
      notes.map((n) => midiName(n.midi)),
    );
    events.forEach((e, i) => {
      const late = e.at - notes[i].at;
      assert.ok(late >= 0 && late < 150, `${midiName(e.midi)} fired ${late.toFixed(0)} ms after the pluck`);
      assert.ok(Math.abs(e.cents) < 15, `${midiName(e.midi)}: ${e.cents.toFixed(1)} cents`);
    });
  });

  it("counts fast repeated notes on every string", () => {
    for (const open of STANDARD_TUNING) {
      const midi = open + 3;
      const notes = [0, 1, 2, 3].map((i) => ({ midi, at: 50 + i * 250 }));
      const events = play(notes, 1200);
      assert.equal(events.length, 4, `${midiName(midi)}: ${events.length} events`);
    }
  });

  it("fires nothing on silence or background noise", () => {
    assert.deepEqual(play([], 1000), []);
    assert.deepEqual(play([], 1000, { noiseFloor: 0.05 }), []);
  });

  it("keeps quiet while a single long note decays", () => {
    const events = play([{ midi: 40, at: 50 }], 3000, { loss: 0.999 });
    assert.deepEqual(events.map((e) => e.midi), [40]);
  });

  it("reads the note against the A4 reference", () => {
    const tracker = new NoteTracker({ a4: 432 });
    let ev: NoteEvent | null = null;
    for (let t = 0; t <= 100 && !ev; t += 10) {
      ev = tracker.push({ pitch: { freq: 432, clarity: 0.99 }, rms: 0.2, at: t });
    }
    assert.ok(ev);
    assert.equal(ev.midi, 69);
    assert.ok(Math.abs(ev.cents) < 0.01);
  });
});
