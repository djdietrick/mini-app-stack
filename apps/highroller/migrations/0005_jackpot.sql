-- The shared progressive jackpot (#57).

-- One row every qualifying hand touches. The amount is in hundredths of a
-- chip, so 2% of a whole-chip stake adds exactly. A contribution is
-- `amount = amount + c` (the row lock it takes is released at commit); a hit
-- reads it FOR UPDATE, pays it and sets it back to the seed, 250,000 chips.
CREATE TABLE jackpot (
  id          smallint PRIMARY KEY CHECK (id = 1),
  amount      bigint NOT NULL CHECK (amount >= 25000000),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO jackpot (id, amount) VALUES (1, 25000000);

-- Each win, for the lobby's "last won by". One per hand.
CREATE TABLE jackpot_hits (
  hand_id       uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES players(user_id),
  display_name  text NOT NULL,
  game          text NOT NULL,
  variant       text,
  amount        bigint NOT NULL CHECK (amount > 0),
  hand_label    text NOT NULL,
  created_at    timestamptz NOT NULL
);

CREATE INDEX jackpot_hits_created_idx ON jackpot_hits (created_at DESC);
