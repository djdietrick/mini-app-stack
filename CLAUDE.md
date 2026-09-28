# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo purpose

Monorepo (pnpm workspaces) of small microservices and the shared data infrastructure that backs them. Apps live under `apps/`, shared TS code under `packages/`. The data layer (Postgres + Redis) is defined in `infra/` and orchestrated by the root `docker-compose.yml`.

**There are two deployment targets and both are permanent**: the self-hosted Docker stack, and Firebase/GCP. The same domain code and route tables serve both — see "Dual deployment targets" below. When changing anything data- or transport-related, assume you must satisfy both.

## Common commands

Run from the repo root.

```bash
# Infrastructure (Postgres + Redis)
pnpm infra:up       # start data services in the background
pnpm infra:down     # stop services, keep volumes
pnpm infra:logs     # tail logs from all services
pnpm infra:reset    # DESTROY all data volumes (re-runs init scripts on next up)

# Typecheck a single workspace package
pnpm --filter @stack/db-clients typecheck

# Whole workspace
pnpm typecheck
pnpm build:web
pnpm test

# Run tests with a Firestore emulator, so the Firestore contract tests run
# instead of self-skipping. This is what CI does.
pnpm exec firebase emulators:exec --only firestore --project demo-ci "pnpm test"

# Firebase emulator suite (auth + firestore + functions + hosting)
pnpm emulators:up
pnpm emulators:down
```

Workspace install: `pnpm install` at the root. Adding a dependency to a specific package: `pnpm --filter <name> add <dep>`.

## Architecture

### Shared-everything data model

The stack is deliberately *not* "one DB per app." There is one shared database per engine, and apps share a single user identity. This is the core architectural decision; most other things follow from it.

- **Postgres** — single database `appstack`. Each app gets its own schema (`crate`, `pantry`, …) plus a dedicated login role that owns it. A separate `shared` schema holds cross-app tables. App roles get **read-only** access to `shared` and have `search_path = <app>, shared, public`, so unqualified table references resolve naturally.
- **Firestore** (cloud only) — single database per environment. Apps namespace via collection prefixes (`crate_queue`, `pantry_items`); the `createFirestoreClient` helper applies the prefix automatically.
- **Redis** — single instance. Apps namespace via `keyPrefix` and/or logical db index (0–15).

### Dual deployment targets

Everything that differs between self-hosted and Firebase sits behind exactly three ports. Nothing else in the codebase knows which target it is running on, and **no domain code may import Fastify, Express, `postgres`, or `firebase-admin` directly.**

1. **Transport** — `@stack/service-kit`. A route is a descriptor: `method`, `path`, optional zod `input` (`params`/`query`/`body`), and `handler(ctx, input)`. `ctx` carries `{ repo, user, scope, log }` and deliberately has no request or reply on it. `toFastifyPlugin` serves the table self-hosted; `toExpressApp` serves it inside a Cloud Function. Domain code throws `AppError` (`notFound()`, `conflict("CODE")`, …) and each adapter maps it to HTTP.
2. **Data** — a per-app repository port at `apps/<app>/src/repo/types.ts`, implemented by `postgres.ts` and `firestore.ts`. Repo methods return `boolean` for "did it match" rather than throwing; the route decides the 404.
3. **Identity** — `SessionVerifier` in `@stack/auth-client`: `stackVerifier` (calls `apps/auth`) or `firebaseVerifier` (verifies a Firebase session cookie).

Selected by entrypoint, not env: `apps/<app>/src/index.ts` wires the self-hosted implementations and `functions/src/index.ts` the cloud ones. There are no `DATA_BACKEND`-style runtime switches, and adding one would be the wrong fix for anything. Frontends pick their auth provider at build time with `VITE_AUTH_MODE`.

All three apps run on both targets. `apps/crate` is the reference implementation; `apps/pantry` is the example to copy for per-request scope (its active household) or multi-user data; `apps/ytdigest` is the example for scheduled work and secrets (`src/domain/poll.ts` and `digest.ts` are driven by `scheduler.ts` self-hosted and by `onSchedule` functions in the cloud).

**Things that will bite you when writing a Firestore implementation:**

- No joins. Denormalise onto the document (crate copies album/artist metadata onto each queue doc) and accept that the copy does not retro-update.
- No unique constraints. Either use a deterministic document id, or do the check and the write inside one `runTransaction`.
- Transactions must do all reads before any write, cap at 500 writes, and **the callback must be idempotent** — it is retried on contention, so no side effects outside the transaction.
- `in` filters cap at 30 values; chunk anything larger (see `statusFor`).
- No `ORDER BY random()` and no `GROUP BY`; aggregate in memory when the set is per-user and small.
- Document ids are app-generated UUIDs, not Firestore auto-ids, so `z.string().uuid()` route validation holds on both backends.
- Firestore TTL is a per-collection policy on a timestamp field and deletes asynchronously, so code still checks `expiresAt` on read.

**And one that bites the Postgres side:** timestamps from Postgres are strings, and Date parameters throw. `createPostgresClient` wraps postgres.js in Drizzle, which replaces its date parsers and serializers: `timestamptz` comes back as `"2026-09-27 16:40:17.324+00"`, `bigint` as a string, and passing a JS `Date` as a query parameter throws. Repos pass ISO strings in and convert to `Date`/`Number` on the way out wherever domain code does arithmetic (see `apps/ytdigest/src/repo/postgres.ts`).

**Wire formats are contracts.** crate's queue rows are snake_case because they began as Postgres rows and `apps/crate/web/src/api.ts` reads those keys. The Firestore repo reproduces them exactly. Do not "clean up" field names.

**Cloud routing.** Firebase Hosting forwards the *original* path to a rewritten function, so `/api/search` arrives as `/api/search`. Each function mounts its route table under the prefix Hosting rewrites to, mirroring Fastify's `{ prefix: "/api" }`.

**`firestore.rules` is deny-all on purpose.** Browsers never touch Firestore; everything goes through Functions on the Admin SDK, which bypasses rules. That is what makes the public Firebase web API key harmless.

### Infrastructure as code

`infra/terraform/` owns GCP resources; `firebase.json` / `firestore.rules` / `firestore.indexes.json` own Firebase config. Deliberately outside Terraform: Cloud Scheduler jobs (created by `onSchedule`, would show as permanent drift), function source, and secret *values* (Terraform creates the secrets, never the versions — a value in a variable lands in state). Bootstrap once from `infra/terraform/bootstrap/`; CI authenticates over Workload Identity Federation, so there is no service account key.

Terraform is never applied from a pull request. PRs get a plan comment; apply happens on merge to `main`.

Staging is opt-in. Every staging job or step in `.github/workflows/` is gated on `vars.STAGING_PROJECT_ID != ''`, so prod runs on its own until that variable is set. Any new staging step needs the same guard.

### Auth / identity boundary

Shared identity is the load-bearing piece of the design — a user signs up once and has access to every app. To make this safe:

- `shared.users` (id, email, display_name, email_verified_at) is readable by every app role.
- `shared.user_credentials` (password_hash) is **owned by `shared_admin`** and never granted to app roles. Apps cannot read password hashes even by accident.
- `shared.sessions` (with `token_hash`) is issued by `apps/auth`, which connects as the dedicated `auth_writer` login role. Other apps **never** touch this table directly — they call `apps/auth` `/sessions/verify` via `@stack/auth-client`.
- `shared.app_config` holds per-app feature flags as JSONB; app roles read, only `shared_admin` writes.

When adding any new shared concept, follow this pattern: data in `shared`, writes restricted to `shared_admin`, reads granted via `10-app-schemas.sh`.

### Provisioning lifecycle

`infra/postgres/init/*` is mounted into the official image's init directory. **It only runs on an empty data volume.** Editing it and restarting does nothing — you must either run the equivalent SQL by hand or `pnpm infra:reset` (destructive).

The Postgres init runs in lexicographic order:

1. `00-extensions.sql` — enables `uuid-ossp`, `pgcrypto`, `citext` cluster-wide.
2. `05-shared-schema.sql` — creates `shared_admin` role and the `shared.*` tables.
3. `10-app-schemas.sh` — iterates over the `APPS=()` bash array, creating each app's schema + role and granting read access to `shared`.

To add a new app to the data layer: append its name to `APPS=()` in `10-app-schemas.sh`, add `APP_<NAME>_PASSWORD` to `.env` (and `.env.example`), and pass it through to the `postgres` service in `docker-compose.yml`. Then reset (destructive) or — for a live database with existing data — run the role/schema/grant SQL by hand against the running container (back up first with `pg_dump`); see README "Adding a new app" for the exact snippet.

### Shared TS clients

`packages/db-clients` (`@stack/db-clients`) is the only sanctioned way for apps to open connections. Each helper returns a handle with a `close()` method:

- `createPostgresClient({ url, schema })` — postgres.js + Drizzle, sets `search_path` from `schema`.
- `createFirestoreClient({ projectId?, databaseId?, collectionPrefix? })` — `@google-cloud/firestore`. Use `handle.collection("items")` so the prefix is applied automatically. Picks up `FIRESTORE_EMULATOR_HOST` on its own, so local and cloud share one code path.
- `createRedisClient({ url, keyPrefix?, db? })` — ioredis.

Apps should depend on `@stack/db-clients` rather than importing `postgres` / `@google-cloud/firestore` / `ioredis` directly, so connection conventions (pool sizes, prefixing, search_path) stay consistent.

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

#### Google sign-in

`AuthContextValue.loginWithGoogle` is optional: each provider sets it only when Google sign-in can work, and `<GoogleButton>` (rendered by `LoginForm`/`SignupForm`) shows nothing without it. So no app code changes for Google, and a backend without it looks exactly as before.

- **Firebase**: `FirebaseAuthProvider` uses `signInWithRedirect`, finished by `getRedirectResult` on the way back, then the usual `POST /auth/session`. **`authDomain` is the page's own host at runtime** (`sameOriginAuthDomain`), not the configured `<project>.firebaseapp.com`: the SDK reads the result back through storage on `authDomain`, which is third-party (and blocked by Safari, Firefox, Chrome's partitioning and home-screen apps) unless it is the app's own origin. Symptom when that breaks: Google succeeds, you land back on the login form, and no Firebase user is created. Every Hosting site serves `/__/auth/handler`, but each `https://<host>/__/auth/handler` must be a redirect URI on the OAuth client (`terraform output oauth_redirect_uris`) — there is no API for that, so it is a manual step. The provider itself is enabled in the Firebase console, not Terraform — its resource takes the client secret. The page's domain must also be in `authorized_domains` (`modules/environment` lists every app site's `.web.app` and `.firebaseapp.com`). `getRedirectResult` only runs after a redirect this tab started (a sessionStorage flag), so normal loads never wait on Google's scripts.
- **Self-hosted**: `apps/auth` runs an authorization-code + PKCE flow (`src/google.ts`): `GET /google/start?returnTo=` → Google → `GET /google/callback` → session cookie → back to `returnTo`. Reached through each app's `/auth/*` proxy, so the redirect URI is `<app origin>/auth/google/callback`. Enabled by `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`; `returnTo` must be an origin in `GOOGLE_ALLOWED_ORIGINS` (it is a redirect target — never loosen that check). `GET /providers` tells the SPA whether to show the button; failures come back as `?auth_error=`, which `AuthProvider` reads into `authError`.
- **Accounts are matched by verified email on both targets.** Taking over an existing account whose email was never verified drops its password and sessions (`src/users.ts`), matching Firebase's behaviour. Keep that: it is what stops pre-registering someone else's address.

## Conventions

- **Package manager**: pnpm (declared in `packageManager`). Node ≥ 20.
- **Module system**: ESM throughout (`"type": "module"`). TS imports use `.js` extensions for relative paths so the same source works after compilation.
- **Env handling**: `.env` at the repo root drives `docker-compose.yml`. Required vars use the `${VAR:?message}` form so compose fails fast if they're missing.
- When scaffolding a new app, follow the shared-everything pattern above, depend on `@stack/db-clients` and `@stack/service-kit`, and structure it like `apps/crate`: route descriptors in `src/domain/`, a repository port in `src/repo/types.ts` with `postgres.ts` and `firestore.ts` implementations, and `src/index.ts` as wiring only. The Fastify backend serves its own Vite/React SPA, proxies `/auth/*` to `apps/auth`, and runs SQL migrations from `migrations/*.sql` on boot via `runMigrations` from `@stack/service-kit`.

### apps/landing

Static page listing every app, with links. Vanilla TS + Vite, no React and no auth: it is on its own origin, so it cannot see any app's session anyway.

- The list is `src/catalog.ts`. **Adding an app to the stack means adding it here too.**
- URLs are fixed at build time by `src/urls.ts`: `VITE_APP_URL_<ID>` if set, else the app's Hosting site for `VITE_FIREBASE_PROJECT_ID` from `.firebaserc` (`https://<site>.web.app`), else `http://localhost:<compose port>`. CI needs no extra variables.
- Cloud: its own `landing` Hosting target/site (`google_firebase_hosting_site.landing` in `modules/environment`), no function. Self-hosted: the `landing` compose service, nginx on `LANDING_PORT` (3000).

### apps/pantry

Kitchen inventory + grocery lists. Runs as the `pantry` Postgres role on port `3102`.

- Data model (`pantry` schema):
  - `items` — name, quantity, size, status (`stocked`/`low`/`out`), notes; unique per `(household_id, name)`.
  - `tags` — typed by `kind` (`store`/`section`/`general`); joined via `item_tags`.
  - `households`, `household_members`, `household_invites`, `user_settings` — pantry data is scoped by household, not by user (`migrations/0002_households.sql`). `resolvePantryScope` (the adapters' `resolveScope` hook) resolves the caller's active household into `ctx.scope`; data routes 409 `NO_HOUSEHOLD` without one.
  - `grocery_lists` + `grocery_list_items` — list items snapshot `name_snapshot` and optionally reference an `items.id` (nullable so ad-hoc untracked entries are supported).
- Key endpoint: `POST /lists/:id/finish` accepts `{ updates: [{ listItemId, quantity }] }`, defaults missing quantities to 1, writes each linked `items.quantity` and flips its status to `stocked`, then marks the list completed. This is the only path that mutates inventory from list activity — checking items off during shopping only toggles `checked_off`.
- Firestore layout differs from the SQL on purpose: item tags are a `tagIds` array on the item, and grocery-list entries are embedded in the list document. Uniqueness is enforced on a lowercased `nameKey` (the columns are `citext`). See the header of `src/repo/firestore.ts`.
- `src/domain/contract.test.ts` runs the whole HTTP contract against both real backends through both adapters. Postgres runs when `PANTRY_TEST_DATABASE_URL` (as the `pantry` role) and `PANTRY_TEST_ADMIN_DATABASE_URL` (a superuser, to seed `shared.users`) are set; Firestore when `FIRESTORE_EMULATOR_HOST` is. CI sets all three.
- UX is mobile-first: flat filterable Pantry screen with inline 3-state status toggle; list builder pre-selects everything that's not `stocked` and groups results Out → Low → Other; Shopping view groups items by their first `section` tag for in-store flow.

### apps/ytdigest

YouTube channel digest emailer. Runs as the `ytdigest` Postgres role on port `3103`.

- Two jobs, both in `src/domain/`: `pollChannels` (new uploads plus a stats snapshot per tracked video) and `runDailyDigest` (per user: due subscriptions → candidates since the last digest → rule evaluation → one email → `recordDigest`). Self-hosted, `src/scheduler.ts` runs them on a timer and `node-cron`; in the cloud, `ytdigestPoll` and `ytdigestDigest` in `functions/src/index.ts` are `onSchedule` functions at 08:00 America/New_York. A `Lease` (Redis or Firestore) stops two polls overlapping.
- Time zone matters: the weekly digest's weekday and `run_date` come from `DigestOptions.timeZone` (`DIGEST_TIME_ZONE` self-hosted; unset means server time).
- Secrets: `YOUTUBE_API_KEY` and `SMTP_PASSWORD`. Self-hosted they are env vars; in the cloud they are Secret Manager secrets bound with `defineSecret`, created by Terraform and filled in by hand. Non-secret SMTP settings reach the functions via `functions/.env`, which the deploy workflow writes from repository variables. Values are read at call time, never at module load, because the CLI loads the module during deploy without them.
- Mail is SMTP on both targets via `@stack/mailer`. `nodemailer` must stay `--external` in the functions bundle: bundled into ESM output, its `require()` calls throw at runtime.
- `video_id` is an internal UUID on Postgres; link to YouTube with `youtube_video_id`.
- `src/domain/contract.test.ts` covers the HTTP contract and both jobs on both backends (fake YouTube, captured mail). Postgres runs when `YTDIGEST_TEST_DATABASE_URL` and `YTDIGEST_TEST_ADMIN_DATABASE_URL` are set; CI sets them.
