-- Shared schema: cross-app tables (users, orgs, feature flags, etc.)
-- Owned by a dedicated `shared_admin` role; app roles get read-only access
-- by default. Writes to shared tables go through apps/auth, which connects
-- as `auth_writer` (provisioned in 07-auth-role.sh).

CREATE ROLE shared_admin NOLOGIN;
CREATE SCHEMA IF NOT EXISTS shared AUTHORIZATION shared_admin;

-- Central users table. apps/auth owns writes here; other apps reference
-- user_id and join on this when they need user metadata.
CREATE TABLE shared.users (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             citext UNIQUE NOT NULL,
  display_name      text,
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Password / credential storage kept separate so app roles can be granted
-- access to `shared.users` without ever seeing secrets. Only auth_writer
-- gets SELECT on this table.
CREATE TABLE shared.user_credentials (
  user_id       uuid PRIMARY KEY REFERENCES shared.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Sessions. `token_hash` stores a SHA-256 of the opaque cookie token so a
-- DB read does not yield a usable session. Only auth_writer ever
-- reads/writes this table; other apps call apps/auth /sessions/verify.
CREATE TABLE shared.sessions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES shared.users(id) ON DELETE CASCADE,
  token_hash    bytea UNIQUE NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON shared.sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON shared.sessions(expires_at);

-- Per-app feature flags / config. Apps read this; only shared_admin writes.
CREATE TABLE shared.app_config (
  app_name text NOT NULL,
  key      text NOT NULL,
  value    jsonb NOT NULL,
  PRIMARY KEY (app_name, key)
);
