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
  src/theory/      pure TS, no deps: notes, tuning, positions, formulas, patterns
                   (the pitch detector and onset logic go here too, #11)
  src/domain/      types.ts (zod exercise/run model), catalog.ts (built-ins), routes.ts
  src/repo/        types.ts (the port), postgres.ts, firestore.ts
  migrations/      Postgres schema `fretwork`
  web/src/         the SPA; imports ../../src/theory directly, and wire types type-only
```

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
   - #11 pitch detection
   - #12 fretboard component
2. **Practice**
   - #13 `find` engine
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
