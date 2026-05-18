#!/usr/bin/env bash
# Creates the `auth_writer` login role used by apps/auth.
#
# auth_writer is the ONLY role with write access to shared.users,
# shared.user_credentials, and shared.sessions. It does not own those
# tables (shared_admin does), so a compromise of this role cannot drop
# the schema.
#
# Password comes from APP_AUTH_PASSWORD; the value must also be passed
# through to the auth service in docker-compose.yml.
set -euo pipefail

: "${APP_AUTH_PASSWORD:?set APP_AUTH_PASSWORD in .env}"

psql_exec() {
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "$1"
}

echo "-> provisioning auth_writer role"
psql_exec "CREATE ROLE auth_writer LOGIN PASSWORD '$APP_AUTH_PASSWORD';"
psql_exec "GRANT CONNECT ON DATABASE \"$POSTGRES_DB\" TO auth_writer;"
psql_exec "GRANT USAGE ON SCHEMA shared TO auth_writer;"
psql_exec "GRANT SELECT, INSERT, UPDATE, DELETE ON shared.users TO auth_writer;"
psql_exec "GRANT SELECT, INSERT, UPDATE, DELETE ON shared.user_credentials TO auth_writer;"
psql_exec "GRANT SELECT, INSERT, UPDATE, DELETE ON shared.sessions TO auth_writer;"
psql_exec "ALTER ROLE auth_writer SET search_path = shared, public;"
