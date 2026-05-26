-- Household sharing. Pantry owns households here; future apps can borrow the
-- concept by lifting these tables into the shared schema later if needed.
--
-- Dev-only migration: drops all existing pantry rows. Onboarding will force
-- every user to create or join a household before they see the app.

CREATE TABLE households (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE household_members (
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES shared.users(id),
  role          text NOT NULL CHECK (role IN ('owner','member')),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

CREATE INDEX household_members_user_idx ON household_members (user_id);

-- Single-use, hashed tokens. Same shape as shared.sessions.
CREATE TABLE household_invites (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  created_by    uuid NOT NULL REFERENCES shared.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   uuid REFERENCES shared.users(id)
);

CREATE INDEX household_invites_household_idx ON household_invites (household_id);

CREATE TABLE user_settings (
  user_id              uuid PRIMARY KEY REFERENCES shared.users(id),
  active_household_id  uuid REFERENCES households(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Rotate pantry data onto households. Dev only: drop existing rows.
TRUNCATE items, tags, grocery_lists RESTART IDENTITY CASCADE;

ALTER TABLE items DROP CONSTRAINT items_user_id_name_key;
ALTER TABLE items DROP COLUMN user_id;
ALTER TABLE items ADD COLUMN household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE;
ALTER TABLE items ADD CONSTRAINT items_household_name_key UNIQUE (household_id, name);
DROP INDEX IF EXISTS items_user_status_idx;
CREATE INDEX items_household_status_idx ON items (household_id, status);

ALTER TABLE tags DROP CONSTRAINT tags_user_id_kind_name_key;
ALTER TABLE tags DROP COLUMN user_id;
ALTER TABLE tags ADD COLUMN household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE;
ALTER TABLE tags ADD CONSTRAINT tags_household_kind_name_key UNIQUE (household_id, kind, name);

ALTER TABLE grocery_lists DROP COLUMN user_id;
ALTER TABLE grocery_lists ADD COLUMN household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS grocery_lists_user_status_idx;
CREATE INDEX grocery_lists_household_status_idx ON grocery_lists (household_id, status, created_at DESC);
