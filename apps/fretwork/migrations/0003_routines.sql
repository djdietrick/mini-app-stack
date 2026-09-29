-- A player's own practice routines: a name and an ordered list of
-- { exercise_id, minutes }. Stored as JSONB in order; exercise ids have no FK
-- (built-ins are not rows, and the session runner skips a deleted exercise).
CREATE TABLE routines (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES shared.users(id),
  name        text NOT NULL,
  items       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX routines_user_created_idx ON routines (user_id, created_at DESC);
