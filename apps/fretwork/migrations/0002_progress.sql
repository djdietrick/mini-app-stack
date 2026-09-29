-- Aggregates folded from each run as it is recorded (src/domain/progress.ts),
-- in the same transaction as the insert. Not backfilled from older runs.

-- The tempo ladder and streak, per exercise practiced.
CREATE TABLE exercise_progress (
  user_id            uuid NOT NULL REFERENCES shared.users(id),
  -- Like runs.exercise_id: a built-in's fixed id or an exercises.id, no FK.
  exercise_id        uuid NOT NULL,
  tempo              int,
  clean_streak       int NOT NULL DEFAULT 0 CHECK (clean_streak >= 0),
  best_tempo         int,
  runs               int NOT NULL DEFAULT 0 CHECK (runs >= 0),
  last_practiced_at  timestamptz,
  PRIMARY KEY (user_id, exercise_id)
);

-- The fretboard map: totals per position the user was asked for.
CREATE TABLE position_stats (
  user_id   uuid NOT NULL REFERENCES shared.users(id),
  string    int NOT NULL CHECK (string BETWEEN 1 AND 6),
  fret      int NOT NULL CHECK (fret BETWEEN 0 AND 24),
  attempts  int NOT NULL CHECK (attempts >= 0),
  hits      int NOT NULL CHECK (hits >= 0 AND hits <= attempts),
  -- Summed over hits only.
  total_ms  bigint NOT NULL CHECK (total_ms >= 0),
  PRIMARY KEY (user_id, string, fret)
);
