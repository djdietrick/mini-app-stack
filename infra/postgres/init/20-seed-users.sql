-- Seeds a single placeholder user so apps can FK against shared.users until
-- apps/auth exists. The uuid here is fixed and mirrored by CRATE_USER_ID
-- (and any other future app that wants to target this row) in .env.
--
-- Init scripts only run on an empty data volume; to re-seed, pnpm infra:reset.

INSERT INTO shared.users (id, email, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'me@local', 'Local User')
ON CONFLICT (id) DO NOTHING;
