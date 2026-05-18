#!/usr/bin/env bash
# Creates one schema + dedicated role per app in the shared `appstack` database.
#
# Each app gets:
#   - a schema named after the app
#   - a role with login privileges, owning that schema
#   - SELECT access to the `shared` schema (users, sessions, app_config, etc.)
#   - a password sourced from APP_<UPPERCASE_NAME>_PASSWORD env var
#     (falls back to the app name itself — fine for local, set real values for prod)
#
# To add a new app: append its name to the APPS array, set APP_<NAME>_PASSWORD
# in your .env (and pass it through to the postgres service in docker-compose.yml),
# then re-create the postgres volume (or run the equivalent SQL manually).
set -euo pipefail

APPS=(crate)

psql_exec() {
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "$1"
}

for app in "${APPS[@]}"; do
  upper="$(echo "$app" | tr '[:lower:]' '[:upper:]')"
  pw_var="APP_${upper}_PASSWORD"
  pw="${!pw_var:-$app}"

  echo "-> provisioning schema/role for app: $app"
  psql_exec "CREATE ROLE \"$app\" LOGIN PASSWORD '$pw';"
  psql_exec "CREATE SCHEMA IF NOT EXISTS \"$app\" AUTHORIZATION \"$app\";"
  psql_exec "GRANT CONNECT ON DATABASE \"$POSTGRES_DB\" TO \"$app\";"

  # Read-only access to shared tables so every app can resolve users/config.
  # REFERENCES is needed so app schemas can FK into shared.users etc.; it does
  # not grant any write access on its own.
  psql_exec "GRANT USAGE ON SCHEMA shared TO \"$app\";"
  psql_exec "GRANT SELECT, REFERENCES ON ALL TABLES IN SCHEMA shared TO \"$app\";"
  psql_exec "ALTER DEFAULT PRIVILEGES FOR ROLE shared_admin IN SCHEMA shared GRANT SELECT, REFERENCES ON TABLES TO \"$app\";"

  # search_path: app's own schema first, then shared, then public.
  psql_exec "ALTER ROLE \"$app\" SET search_path = \"$app\", shared, public;"
done
