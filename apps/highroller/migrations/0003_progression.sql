-- Progression: the shop's inventory and equipped cosmetics, and quest and
-- achievement progress.

-- Item ids by kind ({ card_back, felt, chip_set }); a missing kind is the default.
ALTER TABLE players ADD COLUMN equipped jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Cosmetics bought. The defaults are always owned and never stored. Item ids
-- are src/domain/catalog.ts's fixed UUIDs, so there is no foreign key.
CREATE TABLE inventory (
  user_id      uuid NOT NULL REFERENCES players(user_id),
  item_id      uuid NOT NULL,
  acquired_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

-- One row per quest per period ('d:2026-10-15', 'w:2026-W42' or 'ever' for
-- achievements), written only once there is progress. Quest ids are
-- src/domain/quests.ts's fixed ids.
CREATE TABLE quest_progress (
  user_id     uuid NOT NULL REFERENCES players(user_id),
  quest_id    text NOT NULL,
  period      text NOT NULL,
  -- Never falls; for streak quests it is the longest run.
  progress    bigint NOT NULL DEFAULT 0 CHECK (progress >= 0),
  -- The current run, for streak quests.
  run         int NOT NULL DEFAULT 0 CHECK (run >= 0),
  -- Keys seen, for "play N different games".
  marks       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Rewards claimed: 0 or 1 for a quest, tiers claimed for an achievement.
  claimed     int NOT NULL DEFAULT 0 CHECK (claimed >= 0),
  updated_at  timestamptz NOT NULL,
  claimed_at  timestamptz,
  PRIMARY KEY (user_id, quest_id, period)
);

-- The balance chart reads the last ledger entry before each day's end.
CREATE INDEX ledger_user_created_idx ON ledger (user_id, created_at DESC, seq DESC);
