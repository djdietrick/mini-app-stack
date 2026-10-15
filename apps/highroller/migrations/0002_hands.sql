-- Hands: one row per hand, every game. `state` is the engine's full state,
-- deck and hole cards included; only `view` is ever sent to the client.
CREATE TABLE hands (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES players(user_id),
  game        text NOT NULL,
  variant     text,
  status      text NOT NULL CHECK (status IN ('active', 'settled')),
  version     int NOT NULL DEFAULT 0,
  state       jsonb NOT NULL,
  view        jsonb NOT NULL,
  wagered     bigint NOT NULL CHECK (wagered >= 0),
  returned    bigint NOT NULL DEFAULT 0 CHECK (returned >= 0),
  results     jsonb,
  created_at  timestamptz NOT NULL,
  settled_at  timestamptz,
  CHECK ((status = 'settled') = (settled_at IS NOT NULL))
);

-- At most one unfinished hand per player per game.
CREATE UNIQUE INDEX hands_one_active_idx ON hands (user_id, game) WHERE status = 'active';
CREATE INDEX hands_user_created_idx ON hands (user_id, created_at DESC, id DESC);
CREATE INDEX hands_user_game_created_idx ON hands (user_id, game, created_at DESC, id DESC);
-- The boot-time purge of settled hands older than 90 days.
CREATE INDEX hands_settled_idx ON hands (settled_at) WHERE status = 'settled';

-- Per player, per game: folded from each settled hand in its transaction.
CREATE TABLE game_stats (
  user_id          uuid NOT NULL REFERENCES players(user_id),
  game             text NOT NULL,
  hands            int NOT NULL DEFAULT 0,
  wagered          bigint NOT NULL DEFAULT 0,
  returned         bigint NOT NULL DEFAULT 0,
  wins             int NOT NULL DEFAULT 0,
  losses           int NOT NULL DEFAULT 0,
  pushes           int NOT NULL DEFAULT 0,
  biggest_win      bigint NOT NULL DEFAULT 0,
  -- Σ theoretical RTP × wagered.
  expected_return  double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, game)
);

-- Per ISO week (UTC) and player, for the leaderboards.
CREATE TABLE weekly_stats (
  week         text NOT NULL,
  user_id      uuid NOT NULL REFERENCES players(user_id),
  hands        int NOT NULL DEFAULT 0,
  wagered      bigint NOT NULL DEFAULT 0,
  net          bigint NOT NULL DEFAULT 0,
  biggest_win  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (week, user_id)
);

CREATE INDEX weekly_stats_net_idx ON weekly_stats (week, net DESC);
