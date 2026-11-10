-- How far each user has got through each video, so the player can resume.
-- One row per (user, video), overwritten as they watch.

CREATE TABLE watch_progress (
  user_id           uuid NOT NULL REFERENCES shared.users(id),
  video_id          uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position_seconds  int NOT NULL CHECK (position_seconds >= 0),
  duration_seconds  int NOT NULL CHECK (duration_seconds > 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);
