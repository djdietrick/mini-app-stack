ALTER TABLE albums ADD COLUMN genre text;

ALTER TABLE queue ADD COLUMN rating smallint CHECK (rating BETWEEN 1 AND 5);
