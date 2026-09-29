-- Unqualified names resolve into the `fretwork` schema via the role's search_path.

-- A user's own exercises. Built-ins live in code (src/domain/catalog.ts).
CREATE TABLE exercises (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES shared.users(id),
  name        text NOT NULL,
  category    text NOT NULL CHECK (category IN ('notes','scales','arpeggios','ear')),
  -- Validated by the route's zod schema; config->>'engine' is the engine.
  config      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX exercises_user_created_idx ON exercises (user_id, created_at DESC);

-- One row per finished run, append-only.
CREATE TABLE runs (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES shared.users(id),
  -- A built-in's fixed id or an exercises.id. No foreign key because
  -- built-ins are not rows, and a deleted exercise keeps its history.
  exercise_id  uuid NOT NULL,
  started_at   timestamptz NOT NULL,
  duration_ms  int NOT NULL CHECK (duration_ms >= 0),
  tempo        int,
  notes_total  int NOT NULL CHECK (notes_total >= 0),
  notes_clean  int NOT NULL CHECK (notes_clean >= 0 AND notes_clean <= notes_total),
  clean        boolean NOT NULL,
  -- [{ midi, ok, ms, string, fret }]; feeds the fretboard heatmap.
  notes        jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX runs_user_started_idx ON runs (user_id, started_at DESC);
CREATE INDEX runs_user_exercise_started_idx ON runs (user_id, exercise_id, started_at DESC);
