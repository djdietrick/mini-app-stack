# mini-app-stack

Monorepo of small self-hosted microservices and the shared data infrastructure that backs them.

## Layout

```
.
├── docker-compose.yml          # Postgres + Redis (+ optional Firebase emulators)
├── firebase.json               # Hosting rewrites, Firestore rules/indexes, emulators
├── .env.example                # copy to .env and edit
├── .github/workflows/          # CI, Terraform plan/apply, Firebase deploys
├── infra/
│   ├── postgres/init/          # extensions + per-app schema/role provisioning
│   ├── redis/redis.conf        # lean redis config
│   └── terraform/              # GCP/Firebase infrastructure as code
├── functions/                  # Firebase Functions codebase (cloud transport)
├── packages/
│   ├── service-kit/            # transport-agnostic routes + Fastify/Express adapters
│   └── db-clients/             # shared TS clients (Drizzle, Firestore, ioredis)
└── apps/                       # individual services live here
```

## Data infrastructure

Everything lives in a single shared database per engine so apps can join across each other's data and share a single user identity.

- **PostgreSQL 16** — shared database `appstack`. One schema per app (`notes`, `timer`, …) plus a `shared` schema for cross-app tables (users, sessions, app config). Each app role is read-only on `shared`; writes go through the future auth service.
- **Redis 7** — caching, sessions, pub/sub. AOF persistence, `maxmemory 256mb` with `allkeys-lru` eviction. Apps namespace via `keyPrefix`.

### First-time setup

```bash
cp .env.example .env
# edit .env and set strong passwords

docker compose up -d
docker compose ps
```

The Postgres init scripts only run when the data volume is empty. To re-run them after editing, either reset (`pnpm infra:reset` — destroys data) or apply the SQL manually.

To add a new app to a live Postgres without resetting, run the equivalent of `infra/postgres/init/10-app-schemas.sh` by hand (substituting the new app name):

```bash
set -a; . ./.env; set +a
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE ROLE <name> LOGIN PASSWORD '${APP_<NAME>_PASSWORD}';
CREATE SCHEMA IF NOT EXISTS <name> AUTHORIZATION <name>;
GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO <name>;
GRANT USAGE ON SCHEMA shared TO <name>;
GRANT SELECT, REFERENCES ON ALL TABLES IN SCHEMA shared TO <name>;
ALTER DEFAULT PRIVILEGES FOR ROLE shared_admin IN SCHEMA shared GRANT SELECT, REFERENCES ON TABLES TO <name>;
ALTER ROLE <name> SET search_path = <name>, shared, public;
SQL
```

Take a backup first with `docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backups/appstack-$(date +%F).sql`.

### Adding a new app to the data layer

1. **Postgres** — add the app name to the `APPS=()` array in [infra/postgres/init/10-app-schemas.sh](infra/postgres/init/10-app-schemas.sh#L17). Add `APP_<NAME>_PASSWORD` to `.env` and pass it through to the `postgres` service env in `docker-compose.yml`. The script grants the app role read access to the `shared` schema automatically.
2. **Firestore** (cloud only) — no provisioning needed. Prefix your collection names (e.g. `notes_items`) via `createFirestoreClient({ collectionPrefix })`.
3. **Redis** — no provisioning needed. Pick a logical db index (0-15) or use `keyPrefix` to namespace keys.

### Shared identity / config

The `shared` schema in Postgres holds:

- `shared.users` — central user identity (one user account = access to every app in the stack).
- `shared.user_credentials` — password hashes, kept separate so app roles never have access.
- `shared.sessions` — session records keyed by `token_hash`.
- `shared.app_config` — per-app feature flags / config as JSONB.

Apps reference `shared.users.id` for any per-user data. Writes to `shared.users`, `shared.user_credentials`, and `shared.sessions` are reserved for [apps/auth](apps/auth/), which connects as the dedicated `auth_writer` role.

### Auth

A single sign-on flow across every app in the stack:

- [apps/auth](apps/auth/) — Fastify service. Signup/login/logout, issues an HttpOnly session cookie, exposes a service-to-service `/sessions/verify` endpoint.
- [packages/auth-client](packages/auth-client/) — TS helper apps' backends use to verify the cookie (with a Fastify preHandler).
- [packages/auth-ui](packages/auth-ui/) — React `<AuthProvider>`, `<LoginForm>`, `<SignupForm>`, `<AuthGate>`, `useSession()` so every app's login screen is identical.

See [CLAUDE.md](CLAUDE.md) for the integration pattern.

### Using the shared client from an app

```ts
import {
  createPostgresClient,
  createFirestoreClient,
  createRedisClient,
} from "@stack/db-clients";

const pg = createPostgresClient({
  url: process.env.DATABASE_URL!,        // postgres://notes:pw@postgres:5432/appstack
  schema: "notes",
});

// Cloud only. Picks up FIRESTORE_EMULATOR_HOST automatically when set.
const fs = createFirestoreClient({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  collectionPrefix: "notes_",            // every collection access auto-prefixes
});

const redis = createRedisClient({
  url: process.env.REDIS_URL!,           // redis://:pw@redis:6379
  keyPrefix: "notes:",
});
```

## Apps

- [apps/auth](apps/auth/) — shared identity service (port `3100`). Owns writes to `shared.users`, `shared.user_credentials`, `shared.sessions`.
- [apps/crate](apps/crate/) — music queue / rating app backed by the iTunes search API (port `3101`).
- [apps/pantry](apps/pantry/) — kitchen inventory + grocery list builder (port `3102`). Items track quantity, size, and a 3-state status (stocked / low / out); tags are typed (`store` / `section` / `general`); grocery lists are generated on demand from low/out items, checked off at the store, and reconciled back into inventory on finish.
- [apps/ytdigest](apps/ytdigest/) — YouTube channel digest emailer (port `3103`). Subscribe to channels with a daily or weekly cadence; polls uploads + view/like stats on a schedule, evaluates per-channel or global rules (keyword match, performance/engagement vs. a channel's own trailing baseline, duration, or "every upload"), and emails one combined digest per day via `@stack/mailer`.

## Scripts

```bash
pnpm infra:up       # start all data services
pnpm infra:down     # stop, keep data
pnpm infra:logs     # tail logs
pnpm infra:reset    # stop AND delete all data volumes (destructive)

pnpm emulators:up   # Firebase emulator suite (the cloud path, locally)
pnpm emulators:down

pnpm typecheck      # every workspace
pnpm build:web      # every SPA
pnpm test           # every workspace with tests
```

Run the tests with a Firestore emulator so the Firestore contract tests
actually execute instead of self-skipping:

```bash
pnpm exec firebase emulators:exec --only firestore --project demo-ci "pnpm test"
```

## Choosing a store

- Self-hosted, the primary store is **Postgres**. JSONB columns handle most document-shaped data while keeping you in one system.
- In the cloud the same apps run on **Firestore** via a second repository implementation behind the same port. See "Deploying to Firebase".
- Use **Redis** for ephemeral state (caches, locks, rate limits) — not as a primary store. Firestore documents with a TTL policy play that role in the cloud.


## Deploying to Firebase

The stack has two deployment targets and both are permanent. The same domain
code and the same route tables serve both; only the implementations wired
underneath differ.

|                | Self-hosted (Docker)        | Cloud (Firebase)                  |
|----------------|-----------------------------|-----------------------------------|
| Compute        | Fastify on your server      | Cloud Functions (2nd gen)         |
| Data           | Postgres                    | Firestore                         |
| Identity       | `apps/auth` + `shared.*`    | Firebase Auth (session cookies)   |
| Cache / locks  | Redis                       | Firestore docs with a TTL policy  |
| Static SPA     | `@fastify/static`           | Firebase Hosting                  |
| Config         | `docker-compose.yml`        | `infra/terraform/` + `firebase.json` |

### The three seams

Everything that differs between the two targets is behind one of three ports,
and nothing else in the codebase knows which target it is running on.

1. **Transport** — `@stack/service-kit`. Routes are declarative descriptors
   (`method`, `path`, zod `input`, `handler(ctx, input)`); `toFastifyPlugin`
   serves them self-hosted and `toExpressApp` serves them inside a Function.
   Handlers never see a request or reply object.
2. **Data** — a per-app repository port (`apps/<app>/src/repo/types.ts`) with a
   Postgres and a Firestore implementation, selected by `DATA_BACKEND`.
3. **Identity** — `SessionVerifier` in `@stack/auth-client`, either
   `stackVerifier` (calls `apps/auth`) or `firebaseVerifier` (verifies a
   Firebase session cookie), selected by `AUTH_MODE`.

Adding an endpoint means adding one route descriptor and one method on the
repo port, then implementing that method twice. That second implementation is
the standing cost of keeping both targets.

### Environment selection

```
DATA_BACKEND=postgres|firestore
AUTH_MODE=stack|firebase
CACHE_BACKEND=redis|firestore
MAIL_TRANSPORT=smtp|http
```

Frontends pick their auth provider at build time via `VITE_AUTH_MODE`; the
Firebase SDK is tree-shaken out of the self-hosted bundle.

### Infrastructure

**First-time setup: [docs/firebase-setup.md](docs/firebase-setup.md)** — the
two GCP projects, the one-time bootstrap, and the nine GitHub variables.

`infra/terraform/` owns the GCP resources — see
[infra/terraform/README.md](infra/terraform/README.md) for the division of
labour with `firebase.json`. Deploys run from
GitHub Actions authenticating over Workload Identity Federation; there is no
long-lived service account key anywhere.

### Environments

Two GCP projects: `mini-app-stack-staging` and `mini-app-stack-prod`. Every
pull request gets a Firebase Hosting **preview channel** with its own URL.

Be clear about what a preview is: **preview channels fork the frontend only.**
Functions, Firestore data and Auth users are shared across the whole staging
project, so two PRs that change the API incompatibly will break each other,
and PR previews share data. That is fine for frontend-only and additive
changes. For an API-breaking PR, deploy its functions under a suffixed id
(`crateApi-pr123`) and point that PR's rewrite at it.

Terraform is never applied from a pull request — PRs get a plan comment, and
apply happens on merge to `main`.

### Migration status

| App        | Self-hosted | Firebase |
|------------|-------------|----------|
| `crate`    | yes         | yes      |
| `pantry`   | yes         | not yet  |
| `ytdigest` | yes         | not yet  |
| `auth`     | yes         | replaced by Firebase Auth in the cloud |

`pantry` and `ytdigest` still run only on the self-hosted path. Porting them
means the same three steps `crate` went through: extract routes into
`src/domain/`, define the repo port with a Postgres implementation, then add
the Firestore implementation and export the function. `ytdigest` additionally
needs its in-process `setInterval`/`node-cron` schedulers replaced with
`onSchedule` functions, and an HTTP mail transport — Cloud Functions cannot
open SMTP ports.
