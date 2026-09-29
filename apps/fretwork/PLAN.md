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
  src/practice/    each engine's grading as a pure reducer (find.ts), node-tested
  src/domain/      types.ts (zod exercise/run model), catalog.ts (built-ins), routes.ts
  src/repo/        types.ts (the port), postgres.ts, firestore.ts
  migrations/      Postgres schema `fretwork`
  web/src/         the SPA; imports ../../src/theory directly, and wire types type-only
    audio/         noteStream.ts (the one mic), useNoteStream(), capture.ts
    practice/      one screen per engine, plus shared clock and run saving (common.ts)
    settings.ts    per-device settings in localStorage: handedness, labels, A4, mic gate
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
   - #14 `respond` engine
   - #16 audio output (click, tones, drone)
   - #15 `sequence` engine
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
