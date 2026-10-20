-- Reminders are Web Push only: no email fallback, so no per-reminder address
-- and no email setting.
ALTER TABLE reminders DROP COLUMN email;
DROP TABLE user_settings;
