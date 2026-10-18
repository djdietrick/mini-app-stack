-- Social: leaderboards (#50), chip gifting (#51) and the big-win feed (#52).

-- Hidden players keep their own rank but leave every board, and show as
-- "A player" in the feed. Copied onto weekly_stats rows as `listed`.
ALTER TABLE players ADD COLUMN leaderboard_listed boolean NOT NULL DEFAULT true;
-- Gifting caps. Sent counts the sender's calendar day (their time zone);
-- received counts the UTC day.
ALTER TABLE players ADD COLUMN gifts_sent_today bigint NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN gifts_sent_on date;
ALTER TABLE players ADD COLUMN gifts_received_today bigint NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN gifts_received_on date;

-- Finding a recipient by email is case-insensitive.
CREATE INDEX players_email_idx ON players (lower(email));
-- The level board and its rank count.
CREATE INDEX players_listed_xp_idx ON players (xp DESC) WHERE leaderboard_listed;

ALTER TABLE weekly_stats ADD COLUMN listed boolean NOT NULL DEFAULT true;
-- The weekly boards and their rank counts read listed rows only.
DROP INDEX weekly_stats_net_idx;
CREATE INDEX weekly_stats_net_idx ON weekly_stats (week, net DESC) WHERE listed;
CREATE INDEX weekly_stats_biggest_win_idx ON weekly_stats (week, biggest_win DESC) WHERE listed;

-- One row per gift. The id is the client's, so a retried gift lands once.
-- Names are copied at the time of the gift, for the receiver's banner.
CREATE TABLE gifts (
  id            uuid PRIMARY KEY,
  from_user_id  uuid NOT NULL REFERENCES players(user_id),
  from_name     text NOT NULL,
  to_user_id    uuid NOT NULL REFERENCES players(user_id),
  to_name       text NOT NULL,
  amount        bigint NOT NULL CHECK (amount > 0),
  message       text,
  created_at    timestamptz NOT NULL
);

CREATE INDEX gifts_to_created_idx ON gifts (to_user_id, created_at DESC);

-- Big wins and jackpot hits from every player, newest first, kept 7 days.
-- At most one event of each kind per hand, so a retried settlement can't
-- write two.
CREATE TABLE feed_events (
  hand_id       uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('big_win', 'jackpot')),
  user_id       uuid NOT NULL REFERENCES players(user_id),
  display_name  text NOT NULL,
  game          text NOT NULL,
  variant       text,
  wagered       bigint NOT NULL,
  amount        bigint NOT NULL,
  multiplier    double precision NOT NULL,
  hand_label    text NOT NULL,
  created_at    timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  PRIMARY KEY (hand_id, kind)
);

CREATE INDEX feed_events_created_idx ON feed_events (created_at DESC);
CREATE INDEX feed_events_expires_idx ON feed_events (expires_at);
