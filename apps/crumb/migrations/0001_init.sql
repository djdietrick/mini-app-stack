-- Unqualified names resolve into the `crumb` schema via the role's search_path.

CREATE TABLE starters (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES shared.users(id),
  name            text NOT NULL,
  flour           text NOT NULL DEFAULT '',
  -- Water ÷ flour of its usual feed, percent.
  hydration       int NOT NULL DEFAULT 100 CHECK (hydration BETWEEN 40 AND 200),
  location        text NOT NULL CHECK (location IN ('counter','fridge')),
  location_since  timestamptz NOT NULL DEFAULT now(),
  reserve_grams   int NOT NULL DEFAULT 20 CHECK (reserve_grams >= 0),
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX starters_user_created_idx ON starters (user_id, created_at);

CREATE TABLE feedings (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES shared.users(id),
  starter_id      uuid NOT NULL REFERENCES starters(id) ON DELETE CASCADE,
  fed_at          timestamptz NOT NULL,
  starter_g       real NOT NULL CHECK (starter_g > 0),
  flour_g         real NOT NULL CHECK (flour_g >= 0),
  water_g         real NOT NULL CHECK (water_g >= 0),
  temp_f          real,
  -- Logged afterwards; what the starter model learns from.
  peak_at         timestamptz,
  rise_pct        int,
  notes           text NOT NULL DEFAULT '',
  remind_at_peak  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedings_starter_fed_idx ON feedings (starter_id, fed_at DESC);

-- A user's own recipes. Built-ins live in code (src/domain/catalog.ts).
CREATE TABLE recipes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES shared.users(id),
  name        text NOT NULL,
  kind        text NOT NULL,
  -- { formula, steps, pieces, pieceGrams, notes }, validated by the route.
  config      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recipes_user_created_idx ON recipes (user_id, created_at DESC);

CREATE TABLE bakes (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES shared.users(id),
  -- A built-in's fixed id or a recipes.id. No foreign key: built-ins are not
  -- rows, and a bake keeps its plan when its recipe is deleted.
  recipe_id    uuid NOT NULL,
  recipe_name  text NOT NULL,
  kind         text NOT NULL,
  starter_id   uuid REFERENCES starters(id) ON DELETE SET NULL,
  status       text NOT NULL CHECK (status IN ('active','done','cancelled')),
  ready_at     timestamptz NOT NULL,
  pieces       int NOT NULL,
  piece_grams  int NOT NULL,
  temp_f       real NOT NULL,
  levain       jsonb NOT NULL,
  mix          jsonb NOT NULL,
  -- The planned steps, in order; rewritten whole as the bake moves along.
  steps        jsonb NOT NULL,
  notes        text NOT NULL DEFAULT '',
  rating       smallint CHECK (rating BETWEEN 1 AND 5),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bakes_user_created_idx ON bakes (user_id, created_at DESC);

-- Derived from starters and bakes, replaced a group at a time; sent by the
-- dispatcher (src/domain/reminders.ts).
CREATE TABLE reminders (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES shared.users(id),
  grp         text NOT NULL,
  key         text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  url         text NOT NULL,
  -- Where the email fallback goes; copied from the session that made it.
  email       text NOT NULL DEFAULT '',
  due_at      timestamptz NOT NULL,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE INDEX reminders_due_idx ON reminders (due_at) WHERE sent_at IS NULL;
CREATE INDEX reminders_user_grp_idx ON reminders (user_id, grp);

CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES shared.users(id),
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

CREATE TABLE user_settings (
  user_id          uuid PRIMARY KEY REFERENCES shared.users(id),
  email_reminders  text NOT NULL CHECK (email_reminders IN ('never','fallback','always')),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- The app's one VAPID key pair, made on first use. Every push subscription is
-- tied to its public key, so it must never change once devices subscribe.
CREATE TABLE vapid_keys (
  id           smallint PRIMARY KEY CHECK (id = 1),
  public_key   text NOT NULL,
  private_key  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
