# mini-app-stack

Monorepo of small self-hosted microservices and the shared data infrastructure that backs them.

## Layout

```
.
├── docker-compose.yml          # Postgres + Mongo + Redis
├── .env.example                # copy to .env and edit
├── infra/
│   ├── postgres/init/          # extensions + per-app schema/role provisioning
│   ├── mongo/init/             # per-app db/user provisioning
│   └── redis/redis.conf        # lean redis config
├── packages/
│   └── db-clients/             # shared TS clients (Drizzle, mongodb, ioredis)
└── apps/                       # individual services live here
```

## Data infrastructure

Everything lives in a single shared database per engine so apps can join across each other's data and share a single user identity.

- **PostgreSQL 16** — shared database `appstack`. One schema per app (`notes`, `timer`, …) plus a `shared` schema for cross-app tables (users, sessions, app config). Each app role is read-only on `shared`; writes go through the future auth service.
- **MongoDB 7** — shared database `appstack`. Apps namespace via collection prefixes (`notes_items`, `timer_sessions`). One app user (`appstack`) with `readWrite` on the db.
- **Redis 7** — caching, sessions, pub/sub. AOF persistence, `maxmemory 256mb` with `allkeys-lru` eviction. Apps namespace via `keyPrefix`.

### First-time setup

```bash
cp .env.example .env
# edit .env and set strong passwords

docker compose up -d
docker compose ps
```

The Postgres and Mongo init scripts only run when their data volume is empty. To re-run them after editing, either reset (`pnpm infra:reset` — destroys data) or apply the SQL/JS manually.

### Adding a new app to the data layer

1. **Postgres** — add the app name to the `APPS=()` array in [infra/postgres/init/10-app-schemas.sh](infra/postgres/init/10-app-schemas.sh#L17). Add `APP_<NAME>_PASSWORD` to `.env` and pass it through to the `postgres` service env in `docker-compose.yml`. The script grants the app role read access to the `shared` schema automatically.
2. **Mongo** — no provisioning needed. Use the shared `appstack` user and prefix your collection names (e.g. `notes_items`).
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
  createMongoClient,
  createRedisClient,
} from "@stack/db-clients";

const pg = createPostgresClient({
  url: process.env.DATABASE_URL!,        // postgres://notes:pw@postgres:5432/appstack
  schema: "notes",
});

const mongo = await createMongoClient({
  url: process.env.MONGO_URL!,           // mongodb://appstack:pw@mongo:27017/appstack?authSource=appstack
  database: "appstack",
  collectionPrefix: "notes_",            // every collection access auto-prefixes
});

const redis = createRedisClient({
  url: process.env.REDIS_URL!,           // redis://:pw@redis:6379
  keyPrefix: "notes:",
});
```

## Scripts

```bash
pnpm infra:up       # start all data services
pnpm infra:down     # stop, keep data
pnpm infra:logs     # tail logs
pnpm infra:reset    # stop AND delete all data volumes (destructive)
```

## Choosing SQL vs NoSQL per app

- Default to **Postgres**. JSONB columns handle most document-shaped data while keeping you in one system.
- Reach for **Mongo** when the data is genuinely schema-flexible, deeply nested, or you want per-document TTLs / change streams.
- Use **Redis** for ephemeral state (sessions, rate limits, queues, pub/sub) — not as a primary store.
