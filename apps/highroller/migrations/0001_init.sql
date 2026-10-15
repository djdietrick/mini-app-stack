-- Unqualified names resolve into the `highroller` schema via the role's search_path.
-- Chips are bigint. Drizzle hands bigint back as a string; the repo converts.

-- One row per player, created on their first request. The name and email are
-- copied from the session (and refreshed when they change), so gifting and
-- leaderboards never need shared.users, which has no cloud twin.
CREATE TABLE players (
  user_id          uuid PRIMARY KEY REFERENCES shared.users(id),
  display_name     text NOT NULL,
  email            text NOT NULL,
  -- The fast copy of the ledger's running total; both change in one transaction.
  balance          bigint NOT NULL CHECK (balance >= 0),
  xp               bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
  -- Consecutive days the daily bonus was claimed, ending on last_daily_on.
  daily_streak     int NOT NULL DEFAULT 0 CHECK (daily_streak >= 0),
  -- Calendar days in the player's time zone, as the SPA sent them.
  last_daily_on    date,
  last_bailout_on  date,
  -- The last ledger entry's seq.
  ledger_seq       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Every balance change, append-only. seq counts up per player from 1, so
-- entries written in one transaction (a bet and its payout) keep their order.
CREATE TABLE ledger (
  user_id        uuid NOT NULL REFERENCES players(user_id),
  seq            int NOT NULL,
  kind           text NOT NULL CHECK (kind IN (
                   'initial_grant', 'bet', 'payout', 'daily_bonus', 'bailout', 'purchase',
                   'gift_in', 'gift_out', 'quest_reward', 'achievement_reward', 'jackpot')),
  amount         bigint NOT NULL,
  balance_after  bigint NOT NULL CHECK (balance_after >= 0),
  -- No foreign key: settled hands are purged after 90 days, their ledger rows stay.
  hand_id        uuid,
  ref            text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Newest first is (user_id, seq DESC): the primary key's index serves it backwards.
  PRIMARY KEY (user_id, seq)
);
