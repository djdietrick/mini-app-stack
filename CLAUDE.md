# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo purpose

Monorepo (pnpm workspaces) of small self-hosted microservices and the shared data infrastructure that backs them. Apps live under `apps/`, shared TS code under `packages/`. The data layer (Postgres + Mongo + Redis) is defined in `infra/` and orchestrated by the root `docker-compose.yml`.

## Common commands

Run from the repo root.

```bash
# Infrastructure (Postgres + Mongo + Redis)
pnpm infra:up       # start data services in the background
pnpm infra:down     # stop services, keep volumes
pnpm infra:logs     # tail logs from all services
pnpm infra:reset    # DESTROY all data volumes (re-runs init scripts on next up)

# Typecheck a single workspace package
pnpm --filter @stack/db-clients typecheck
```

Workspace install: `pnpm install` at the root. Adding a dependency to a specific package: `pnpm --filter <name> add <dep>`.

## Architecture

### Shared-everything data model

The stack is deliberately *not* "one DB per app." There is one shared database per engine, and apps share a single user identity. This is the core architectural decision; most other things follow from it.

- **Postgres** — single database `appstack`. Each app gets its own schema (`crate`, `pantry`, …) plus a dedicated login role that owns it. A separate `shared` schema holds cross-app tables. App roles get **read-only** access to `shared` and have `search_path = <app>, shared, public`, so unqualified table references resolve naturally.
- **Mongo** — single database `appstack`. All apps connect as one user (`appstack`) and namespace via collection prefixes (`notes_items`, `timer_sessions`). The `createMongoClient` helper applies the prefix automatically.
- **Redis** — single instance. Apps namespace via `keyPrefix` and/or logical db index (0–15).

### Auth / identity boundary

Shared identity is the load-bearing piece of the design — a user signs up once and has access to every app. To make this safe:

- `shared.users` (id, email, display_name, email_verified_at) is readable by every app role.
- `shared.user_credentials` (password_hash) is **owned by `shared_admin`** and never granted to app roles. Apps cannot read password hashes even by accident.
- `shared.sessions` (with `token_hash`) is issued by `apps/auth`, which connects as the dedicated `auth_writer` login role. Other apps **never** touch this table directly — they call `apps/auth` `/sessions/verify` via `@stack/auth-client`.
- `shared.app_config` holds per-app feature flags as JSONB; app roles read, only `shared_admin` writes.

When adding any new shared concept, follow this pattern: data in `shared`, writes restricted to `shared_admin`, reads granted via `10-app-schemas.sh`.

### Provisioning lifecycle

`infra/postgres/init/*` and `infra/mongo/init/*` are mounted into the official images' init directories. **They only run on an empty data volume.** Editing them and restarting does nothing — you must either run the equivalent SQL/JS by hand or `pnpm infra:reset` (destructive).

The Postgres init runs in lexicographic order:

1. `00-extensions.sql` — enables `uuid-ossp`, `pgcrypto`, `citext` cluster-wide.
2. `05-shared-schema.sql` — creates `shared_admin` role and the `shared.*` tables.
3. `10-app-schemas.sh` — iterates over the `APPS=()` bash array, creating each app's schema + role and granting read access to `shared`.

To add a new app to the data layer: append its name to `APPS=()` in `10-app-schemas.sh`, add `APP_<NAME>_PASSWORD` to `.env` (and `.env.example`), and pass it through to the `postgres` service in `docker-compose.yml`. Then reset (destructive) or — for a live database with existing data — run the role/schema/grant SQL by hand against the running container (back up first with `pg_dump`); see README "Adding a new app" for the exact snippet.

### Shared TS clients

`packages/db-clients` (`@stack/db-clients`) is the only sanctioned way for apps to open connections. Each helper returns a handle with a `close()` method:

- `createPostgresClient({ url, schema })` — postgres.js + Drizzle, sets `search_path` from `schema`.
- `createMongoClient({ url, database?, collectionPrefix? })` — official driver. Use `handle.collection("items")` so the prefix is applied automatically; only reach for `handle.db.collection(...)` if you need to bypass it.
- `createRedisClient({ url, keyPrefix?, db? })` — ioredis.

Apps should depend on `@stack/db-clients` rather than importing `postgres` / `mongodb` / `ioredis` directly, so connection conventions (pool sizes, prefixing, search_path) stay consistent.

### Auth

`apps/auth` is the only service that writes to `shared.*`. It runs as the `auth_writer` Postgres role (provisioned by `infra/postgres/init/07-auth-role.sh`) and exposes:

- `POST /signup`, `POST /login`, `POST /logout`, `GET /me` — user-facing endpoints. Sets/clears an opaque session cookie (`AUTH_COOKIE_NAME`, default `stack_session`).
- `POST /sessions/verify` — service-to-service. Body `{ token }`. Requires header `x-auth-verify-secret: $AUTH_VERIFY_SECRET`. Returns `{ userId, email, displayName }` or 401.

Tokens are 32 random bytes stored hashed (SHA-256) in `shared.sessions.token_hash`, so a DB leak does not yield usable sessions. Password hashing uses argon2id.

#### How other apps use auth

- **Backend**: depend on `@stack/auth-client` and register the Fastify hook:
  ```ts
  import { AuthClient } from "@stack/auth-client";
  import { registerAuth } from "@stack/auth-client/fastify";

  const auth = new AuthClient({ authUrl: process.env.AUTH_URL!, verifySecret: process.env.AUTH_VERIFY_SECRET! });
  registerAuth(app, { client: auth });
  // routes can now read req.user.userId
  ```
  The hook reads the session cookie, calls `/sessions/verify`, caches the result in-process for 5s, and returns 401 on miss. `/health` is public by default.

- **Frontend**: depend on `@stack/auth-ui`, wrap the root in `<AuthProvider authUrl="...">`, and gate the app with `<AuthGate>`:
  ```tsx
  <AuthProvider authUrl="">
    <AuthGate>
      <App />
    </AuthGate>
  </AuthProvider>
  ```
  `authUrl=""` works when the app's backend proxies `/login`, `/signup`, `/me`, `/logout` to `apps/auth`. Use a full origin (e.g. `https://auth.stack.local`) for cross-subdomain setups; the cookie domain (`AUTH_COOKIE_DOMAIN`) must cover both.

The cookie is HttpOnly + SameSite=Lax. In production, set `AUTH_COOKIE_SECURE=true` and `AUTH_COOKIE_DOMAIN=.your-domain` so subdomain apps share the session.

## Conventions

- **Package manager**: pnpm (declared in `packageManager`). Node ≥ 20.
- **Module system**: ESM throughout (`"type": "module"`). TS imports use `.js` extensions for relative paths so the same source works after compilation.
- **Env handling**: `.env` at the repo root drives `docker-compose.yml`. Required vars use the `${VAR:?message}` form so compose fails fast if they're missing.
- When scaffolding a new app, follow the shared-everything pattern above and depend on `@stack/db-clients`. Existing apps (`apps/crate`, `apps/pantry`) are good references — each is a Fastify backend + Vite/React SPA, proxies `/auth/*` to `apps/auth`, and runs SQL migrations from `migrations/*.sql` on boot via `src/migrate.ts`.

### apps/pantry

Kitchen inventory + grocery lists. Runs as the `pantry` Postgres role on port `3102`.

- Data model (`pantry` schema):
  - `items` — name, quantity, size, status (`stocked`/`low`/`out`), notes; unique per `(user_id, name)`.
  - `tags` — typed by `kind` (`store`/`section`/`general`); joined via `item_tags`.
  - `grocery_lists` + `grocery_list_items` — list items snapshot `name_snapshot` and optionally reference an `items.id` (nullable so ad-hoc untracked entries are supported).
- Key endpoint: `POST /lists/:id/finish` accepts `{ updates: [{ listItemId, quantity }] }`, defaults missing quantities to 1, writes each linked `items.quantity` and flips its status to `stocked`, then marks the list completed. This is the only path that mutates inventory from list activity — checking items off during shopping only toggles `checked_off`.
- UX is mobile-first: flat filterable Pantry screen with inline 3-state status toggle; list builder pre-selects everything that's not `stocked` and groups results Out → Low → Other; Shopping view groups items by their first `section` tag for in-store flow.
