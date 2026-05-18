-- Unqualified names resolve into the `crate` schema via the role's search_path.

CREATE TABLE artists (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               citext NOT NULL,
  sort_name          text,
  provider           text NOT NULL,
  provider_artist_id text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_artist_id)
);

CREATE TABLE albums (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title             citext NOT NULL,
  artist_id         uuid NOT NULL REFERENCES artists(id),
  release_year      int,
  artwork_url       text,
  apple_music_url   text,
  provider          text NOT NULL,
  provider_album_id text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_album_id)
);

CREATE TABLE queue (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES shared.users(id),
  album_id     uuid NOT NULL REFERENCES albums(id),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','listened','skipped')),
  added_at     timestamptz NOT NULL DEFAULT now(),
  listened_at  timestamptz,
  UNIQUE (user_id, album_id)
);

CREATE INDEX queue_user_status_idx ON queue (user_id, status);
