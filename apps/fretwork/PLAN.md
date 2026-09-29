# Fretwork — plan

A guitar practice app. It helps you learn where every note is on the fretboard and drill scales and arpeggios. You can add your own exercises, and the microphone tells you whether you played the right note.

Work is tracked in GitHub: **#9** is the tracking issue, with one sub-issue per piece below. Keep this file in step with those issues when decisions change.

## Decisions (locked in)

- **Phone first.** The target is portrait, with the phone on a music stand and both hands on the guitar. Layouts must stretch to tablet and desktop later (#23) without rewriting screens.
- **Three practice screens, one per engine.** All three came out of the design workshop and all three stay:
  | Engine | Screen | Built-in examples |
  |---|---|---|
  | `find` | A · Fretboard first: the neck dominates the screen; find the target on it | Note hunt |
  | `respond` | B · Flashcards + tuner: one big prompt, a live cents needle | String flashcards, Play what you hear |
  | `sequence` | C · Sequence lane: upcoming notes, shape on the neck, tempo ladder | Pentatonic box 1, triads, arpeggios |
- **Sessions:** the app suggests one, and you can also build and save your own routines (#20).
- **Both deployment targets**, like every app in the stack: Fastify + Postgres self-hosted, a Function + Firestore in the cloud. See the root `CLAUDE.md`.
- **Audio never leaves the browser.** Pitch detection and grading run in the SPA; the API only stores exercises and graded runs. There is no audio upload, no server-side DSP, and nothing to scale.

## Pitch ≠ position

A microphone hears a pitch, not where it was played. E4 is fret 0 on the high E, fret 5 on the B and fret 9 on the G, and all three sound the same. Every exercise is designed around that:

- **Single-string prompts are fully checkable.** On one string, a pitch occurs once in frets 0–11.
- **Narrow fret windows make pitches unique.** Exercises that ask for a specific place use them, with `grading: "exact"`, so the octave must be right too.
- Otherwise the app **grades the pitch and says so**, for example "right pitch; the mic can't tell strings apart". It never claims to know which string you used.

## Where things live

```
apps/fretwork/
  src/theory/      pure TS, no deps: notes, tuning, positions, formulas, patterns,
                   pitch.ts (MPM detector) and onsets.ts (frames → note events)
  src/practice/    each engine's grading as a pure reducer (find.ts, respond.ts, sequence.ts),
                   and the click's timing (metronome.ts); all node-tested
  src/domain/      types.ts (zod exercise/run model), catalog.ts (built-ins), routes.ts
  src/repo/        types.ts (the port), postgres.ts, firestore.ts
  migrations/      Postgres schema `fretwork`
  web/src/         the SPA; imports ../../src/theory directly, and wire types type-only
    audio/         context.ts (the one AudioContext), noteStream.ts (the one mic),
                   useNoteStream(), capture.ts, output.ts (tones, drone, click), useMetronome()
    practice/      one screen per engine, plus shared clock and run saving (common.ts)
    settings.ts    per-device settings in localStorage: handedness, labels, A4, mic gate,
                   volume, mute, drone level, headphones
  web/public/      capture.worklet.js (served as a file; see capture.ts)
```

## Listening (#11)

- **Detector:** McLeod Pitch Method on 2048-sample frames at 44.1/48 kHz (4096 at 96 kHz), 70–1400 Hz. It uses an FFT autocorrelation and costs about 0.3 ms per frame on a laptop. It runs on the main thread; move it into a Worker if a phone struggles.
- **Tracker:** a note fires once it has held within ±50 cents for 60 ms. It won't fire again while that note rings. A re-pick of the same note (RMS 1.6× the level it had fallen to) makes it fire again. The noise gate has hysteresis.
- **Capture:** an AudioWorklet posts the newest frame every quarter frame (~11 ms), with an AnalyserNode on a timer as the fallback. Phone voice DSP is switched off in `getUserMedia`. The AudioContext is created inside the tap that starts the mic, because iOS requires it.
- **One stream:** `useNoteStream()` gives screens the status (`idle | asking | listening | denied | unsupported`), a live pitch for the tuner, and note events. Taps on the neck go through the same stream (`tap(midi, position)`), so engines never branch on input source. Only a tap carries a position; the mic never does. The mic is released when the last screen using it unmounts.
- Settings (`#/settings`): A4 reference, mic sensitivity with a level meter, handedness, and dot labels. A tuner is at `#/tune`.

## The neck (#12)

- **Vertical on narrow screens, not pan/zoom.** The player's hands are on the guitar, so a neck that needs a gesture to see is no use mid-exercise. Vertical fits frets 0–12 at 360 px with ≥44 px targets. `orientation="auto"` picks vertical whenever horizontal cells would be narrower than a thumb (48 px to tap; 28 px just to look at, 18 px in landscape).
- **Feedback:** `target` pulses. `correct` and `miss` flash when they appear or change tone. Under `prefers-reduced-motion` the pulse becomes a still ring. Hit and miss never rely on colour: a light filled dot with a tick against a dark ring with a cross. `activeString` shades one string.
- **Labels:** dots carry `name` and `degree`; the label mode (names / degrees / none) picks one. **Left-handed** mirrors either orientation.
- **Keyboard:** the neck is one tab stop. Arrow keys follow the picture, and Enter or Space presses.

## Find (#13)

- `#/practice/:id` loads the exercise and picks the engine's screen. Start on an exercise's page links there once its engine has one.
- **Grading** (`src/practice/find.ts`) is a reducer over slots. String by string gives one slot per string, low E first, holding every position of the note on that string in the window. Any order gives one slot per position.
- **String by string:** the exact pitch counts, wherever it was played. A tap on another string at the same pitch says "the mic can't tell strings apart" and still counts. The right name in the wrong octave is a miss that names the octave wanted, and anything else is a miss. Grading `pitch-class` accepts any octave.
- **Any order:** a pitch lights every unfound position with that pitch. A pitch already lit is neither a hit nor a miss. So is the right name outside the window under `pitch-class`; under `exact` that is a wrong-octave miss.
- **Clean** means found with no miss, and no hint showing, since the previous find. The clock starts on the screen and restarts when the mic comes on, as long as nothing has been played. Time is per slot, from the previous find.
- Run results hold one note per slot at the target position (the found one, or the first when time ran out). The heatmap reads them later.
- **Screen:** the prompt and feedback stick to the top while the neck scrolls. Below them are the compact mic bar, per-string chips with times, and the controls: Show positions, Restart, and Next note (up a fourth). The neck is always tappable, so the screen works without a mic.

## Respond (#14)

- **Grading** is in `src/practice/respond.ts`. Actions carry their own timestamps and random numbers, so the tests can replay any deck exactly.
  - `note-on-string`: the exact pitch on that string. Either end of the window's octave counts (0 or 12). A tap of the same pitch on another string counts, with the usual explanation.
  - `interval`: the root in any octave first, then the note exactly that far above it. Playing the root again restarts the interval from there, and is not a miss.
  - `play-heard-note`: the exact pitch. The card's note plays as it is dealt once sound is unlocked; before that, and to replay, a Play button.
- **`intervals`** is an optional config field. It defaults to the 3rds, the 4th, the 5th and the octave, and cards the window can't hold are dropped.
- **`timeLimitSec` is per card** for this engine; it is per run for `find`.
- **Adaptive deck:** each card is drawn at random, weighted by how that card went earlier in the deck (missed 4, slow 2, quick 0.5, unseen 1). The card just shown is never drawn next.
- **Screen:** a big prompt card, a cents needle while the mic listens, the answer on a single-string strip (the whole neck for intervals), Skip and Next, and streak / score / average. A right answer moves on after 0.9 s; after a skip or timeout, the revealed answer waits for Next. An answered interval card can be heard (root, then the upper note).
- The strip's cells are at least 44 px and wrap into balanced rows, so frets 0–12 are two rows of 7 on a 360 px phone.

## Sound (#16)

- **One AudioContext** (`web/src/audio/context.ts`) for the mic and the output: one clock, one thing for iOS to unlock. It is created or resumed inside a tap and never closed. On iOS 17+ the Audio Session API is set to `playback` (tones sound with the silent switch on) and to `play-and-record` while the mic is on.
- **Tones:** a sawtooth plus a sine through a closing low-pass, with a fast attack and an exponential decay. Oscillators are exactly in tune at the player's A4; Karplus–Strong would need a fractional delay to be. Settings has a Play A4 button, and the tuner's string chips play each open string.
- **Click:** the look-ahead pattern. A 25 ms timer schedules the beats due in the next 120 ms on the audio clock; the arithmetic is `src/practice/metronome.ts` (tested: 1000 beats at 200 bpm with a jittery timer land exactly on the grid). A tempo change applies from the next unscheduled beat; beats missed while the timer was starved are skipped, not burst. Accented downbeat, 4 beats to a bar.
- **Drone:** root and fifth in the lowest guitar octave, with its own level. Offered on the sequence screen.
- **Self-hearing (decided):**
  - Prompt tones hold the mic deaf while they sound, plus the output latency and a 150 ms tail (`holdInput` in noteStream.ts). The player is listening then anyway.
  - The click is not gated: a 30 ms blip at 1.7–2.2 kHz is above the detector's 70–1400 Hz and shorter than the 60 ms a note must hold, so notes on the beat still count.
  - The drone can't be gated (it sustains), so it is for headphones, and the screen says so.
  - Settings → "I use headphones" turns the hold off. That is also how to check a tone's tuning with the app's own tuner.
- Master volume and mute are per-device settings.
- **Pending a real-phone check:** click timing over 5 minutes at 200 bpm, output level on iOS while the mic is on (iOS routes play-and-record audio differently), and whether the hold's tail is long enough in a live room.

## Sequence (#15)

- **Grading** (`src/practice/sequence.ts`): the notes are `applyPattern(shapeInWindow(...), pattern)`. Order and pitch count; rhythm doesn't (v1). A wrong note marks the note asked for as missed and the player stays on it. The note just played, heard again, is ignored (a re-pick, or a string still ringing). `exact` wants the shape's pitch and names the octave when it is wrong; `pitch-class` takes any octave. A clean run is every note right first time.
- **The run starts on its first note played right.** Noodling before that is shown but never counted. After a run, playing its first note starts the next one, so a player can keep going without touching the phone.
- **Tempo ladder:** `advanceLadder` (clean runs in a row; `cleanRunsToAdvance` of them add `step` bpm; an unclean run resets the streak; step 0 is off; capped at 300). Until #18 keeps progress on the server, the screen rebuilds the ladder from the exercise's last 50 runs (`ladderFromRuns`); a run at a tempo set by hand restarts the streak there. #18 should apply the same `advanceLadder` server-side.
- **Screen:** the lane (chips for played clean / played after a miss / now / to come, scrolled to keep the current one centred) and the feedback stick to the top. Below: the mic bar, the neck (shape per the Full → Roots → Hidden toggle, the next note ringed only in Full, the note just played lit, a tapped miss where it landed), then tempo ± with a beat indicator, the click toggle, the ladder's progress, the drone, and Restart. Runs post `{ tempo, clean, notes[] }` with each note at its shape position.

- **Engine grading logic stays pure**, under `src/`, so `node --test` covers it. The SPA wires it to the mic and the UI.
- The Firestore collections are `fretwork_exercises` and `fretwork_runs`. The cloud function is `fretworkApi`, and the Hosting target is `fretwork`.

## Data model

**Exercise.** `{ id, name, category, engine, config, builtin, created_at, updated_at }`.

- `config` is a discriminated union on `engine` (`src/domain/types.ts`). It is stored verbatim as JSONB, or as a Firestore map, so **new fields must be optional or defaulted**.
- **Built-ins** live in code with fixed UUIDs. They are read-only, and duplicating one is how you customise it (#17). Only user-created exercises are rows.

**Run.** Appended once a run is graded: `{ exercise_id, started_at, duration_ms, tempo, notes_total, notes_clean, clean, notes[] }`.

- `notes[]` holds `{ midi, ok, ms, string, fret }` for each target. It is stored but not listed, and it feeds the heatmap.
- `exercise_id` has no foreign key: built-ins are not rows, and a deleted exercise keeps its history.

**Planned** (#18):

- per-exercise progress (the tempo ladder: current, best, clean streak), updated atomically with each run
- per-position stats (attempts, hits, total ms) for the fretboard map
- routines (#20)

## API (as built)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | public |
| GET | `/exercises` | built-ins (catalog order), then yours (newest first) |
| GET | `/exercises/:id` | built-in or yours; 404 otherwise |
| POST | `/exercises` | 201; 400 with flattened zod errors |
| PATCH | `/exercises/:id` | partial; 403 `BUILTIN_READ_ONLY` for built-ins |
| DELETE | `/exercises/:id` | 403 for built-ins; runs are kept |
| POST | `/runs` | 201; 404 `exercise not found` unless built-in or yours |
| GET | `/runs?exerciseId=&limit=` | newest first; limit 1–200, default 50 |

## Milestones

1. **Foundation**
   - #10 scaffold (this branch)
   - #24 first cloud deploy
   - #11 pitch detection (done; real-phone check pending)
   - #12 fretboard component (done; real-phone check pending)
2. **Practice**
   - #13 `find` engine (done)
   - #14 `respond` engine (done, apart from `play-heard-note`, which waits on #16)
   - #16 audio output (click, tones, drone; done; real-phone check pending)
   - #15 `sequence` engine (done; the ladder moves server-side with #18)
3. **Make it yours**
   - #17 exercise builder
   - #20 suggested sessions and routines
   - #21 complete the starter catalog
4. **Track it**
   - #18 progress data
   - #19 progress screen
5. **Polish**
   - #22 phone ergonomics (wake lock, PWA)
   - #23 larger screens

## Working on it

```bash
pnpm --filter @stack/fretwork typecheck   # server and web
pnpm --filter @stack/fretwork build:web
pnpm --filter @stack/fretwork dev:web     # Vite on :5176, proxies /api and /auth to :3104

# Contract tests on both backends (the root CLAUDE.md shows how to provision Postgres)
FRETWORK_TEST_DATABASE_URL=postgres://fretwork:fretwork@localhost:5432/appstack \
FRETWORK_TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/appstack \
  pnpm exec firebase emulators:exec --only firestore --project demo-ci "pnpm --filter @stack/fretwork test"
```

The UI directions and the starter-exercise list came from a design canvas made in the planning session ("Fretboard Practice — UI Workshop", in the owner's Claude artifacts).
