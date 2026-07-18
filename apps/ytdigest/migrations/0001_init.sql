-- Unqualified names resolve into the `ytdigest` schema via the role's search_path.

CREATE TABLE channels (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  youtube_channel_id    citext NOT NULL UNIQUE,
  title                 text NOT NULL,
  thumbnail_url         text,
  uploads_playlist_id   text NOT NULL,
  last_polled_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             uuid NOT NULL REFERENCES shared.users(id),
  channel_id          uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  cadence             text NOT NULL CHECK (cadence IN ('daily','weekly')),
  digest_day_of_week  smallint CHECK (digest_day_of_week BETWEEN 0 AND 6),
  notify_mode         text NOT NULL DEFAULT 'rules' CHECK (notify_mode IN ('all','rules')),
  last_digested_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel_id),
  CHECK (cadence <> 'weekly' OR digest_day_of_week IS NOT NULL)
);

CREATE INDEX subscriptions_user_idx ON subscriptions (user_id);
CREATE INDEX subscriptions_channel_idx ON subscriptions (channel_id);

CREATE TABLE criteria_rules (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES shared.users(id),
  scope           text NOT NULL CHECK (scope IN ('subscription','global')),
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE CASCADE,
  name            text NOT NULL,
  rule_json       jsonb NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (scope = 'subscription' AND subscription_id IS NOT NULL
     OR  scope = 'global' AND subscription_id IS NULL)
);

CREATE INDEX criteria_rules_user_idx ON criteria_rules (user_id);
CREATE INDEX criteria_rules_subscription_idx ON criteria_rules (subscription_id);

CREATE TABLE videos (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id        uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  youtube_video_id  citext NOT NULL UNIQUE,
  title             text NOT NULL,
  description       text,
  published_at      timestamptz NOT NULL,
  duration_seconds  int,
  thumbnail_url     text,
  first_seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX videos_channel_published_idx ON videos (channel_id, published_at DESC);

CREATE TABLE video_stats_snapshots (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id      uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  view_count    bigint NOT NULL,
  like_count    bigint,
  comment_count bigint
);

CREATE INDEX video_stats_snapshots_video_captured_idx ON video_stats_snapshots (video_id, captured_at);

CREATE TABLE digest_runs (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES shared.users(id),
  cadence     text NOT NULL CHECK (cadence IN ('daily','weekly')),
  run_date    date NOT NULL,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX digest_runs_user_date_idx ON digest_runs (user_id, run_date DESC);

CREATE TABLE digest_items (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  digest_run_id     uuid NOT NULL REFERENCES digest_runs(id) ON DELETE CASCADE,
  video_id          uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  subscription_id   uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  matched_rule_id   uuid REFERENCES criteria_rules(id) ON DELETE SET NULL,
  reason_json       jsonb,
  UNIQUE (digest_run_id, video_id)
);

CREATE TABLE notified_videos (
  user_id       uuid NOT NULL REFERENCES shared.users(id),
  video_id      uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  notified_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);
