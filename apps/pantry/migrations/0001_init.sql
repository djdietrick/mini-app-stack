-- Unqualified names resolve into the `pantry` schema via the role's search_path.

CREATE TABLE items (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES shared.users(id),
  name        citext NOT NULL,
  quantity    int NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  size        text,
  status      text NOT NULL DEFAULT 'stocked' CHECK (status IN ('stocked','low','out')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX items_user_status_idx ON items (user_id, status);

CREATE TABLE tags (
  id        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id   uuid NOT NULL REFERENCES shared.users(id),
  name      citext NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('store','section','general')),
  color     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, name)
);

CREATE TABLE item_tags (
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX item_tags_tag_idx ON item_tags (tag_id);

CREATE TABLE grocery_lists (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES shared.users(id),
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX grocery_lists_user_status_idx ON grocery_lists (user_id, status, created_at DESC);

CREATE TABLE grocery_list_items (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  list_id         uuid NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
  item_id         uuid REFERENCES items(id) ON DELETE SET NULL,
  name_snapshot   text NOT NULL,
  quantity        int NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  checked_off     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX grocery_list_items_list_idx ON grocery_list_items (list_id);
