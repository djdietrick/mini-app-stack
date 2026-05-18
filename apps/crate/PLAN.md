# Crate app — implementation plan

A small self-hosted service for queueing albums you want to listen to, picking a random one, and searching an external catalog to populate entries. First app in the `mini-app-stack` monorepo.

## Decisions (locked in)

- **Database**: Postgres (relational data: albums ↔ artists ↔ per-user queue; needs unique constraints on external IDs; `ORDER BY random()` is trivial).
- **External API**: iTunes Search API (`https://itunes.apple.com/search`). No auth, returns Apple Music URLs (`collectionViewUrl`) directly, generous rate limits.
- **Cache**: Redis, keyed by query string with ~24h TTL, `keyPrefix: "crate:"`.
- **Surface**: HTTP API only (Fastify). No UI in v1.
- **Identity**: single hardcoded user. Seed one row in `shared.users`; hardcode its uuid in app config. Schema is multi-user-ready (FK from `queue.user_id` → `shared.users.id`) for when `apps/auth` lands.

## Data model (Postgres, `crate` schema)

```sql
crate.artists
  id                  uuid pk default uuid_generate_v4()
  name                citext not null
  sort_name           text
  provider            text not null            -- 'itunes' for now
  provider_artist_id  text not null            -- iTunes artistId as text
  created_at          timestamptz default now()
  unique (provider, provider_artist_id)

crate.albums
  id                  uuid pk default uuid_generate_v4()
  title               citext not null
  artist_id           uuid not null references crate.artists(id)
  release_year        int
  artwork_url         text
  apple_music_url     text                     -- iTunes collectionViewUrl
  provider            text not null
  provider_album_id   text not null            -- iTunes collectionId as text
  created_at          timestamptz default now()
  unique (provider, provider_album_id)

crate.queue
  id                  uuid pk default uuid_generate_v4()
  user_id             uuid not null            -- FK target shared.users(id); see note
  album_id            uuid not null references crate.albums(id)
  status              text not null check (status in ('queued','listened','skipped')) default 'queued'
  added_at            timestamptz default now()
  listened_at         timestamptz
  unique (user_id, album_id)
```

Notes:
- `crate.queue.user_id` references `shared.users(id)`. The `crate` role only has SELECT on `shared.*` (per `10-app-schemas.sh`), which is enough for FK validation.
- `artists`/`albums` are a shared catalog across users so duplicate adds reuse rows.
- `citext` is enabled cluster-wide by `00-extensions.sql`.

## HTTP API

All endpoints assume the hardcoded user. No auth header in v1.

| Method | Path                       | Purpose |
| ------ | -------------------------- | ------- |
| GET    | `/search?q=<term>`         | Proxy iTunes search; Redis-cached; returns normalized `{ providerAlbumId, title, artist, year, artworkUrl, appleMusicUrl }[]`. |
| POST   | `/queue`                   | Body `{ providerAlbumId }`. Upserts artist + album from the most-recent cached search hit, inserts queue row (idempotent via unique constraint). |
| GET    | `/queue`                   | List queued albums (joined with album + artist). Filterable by `?status=`. |
| GET    | `/queue/random`            | `WHERE status='queued' ORDER BY random() LIMIT 1`. Returns album + `appleMusicUrl`. |
| POST   | `/queue/:id/listened`      | Sets `status='listened'`, `listened_at=now()`. |
| POST   | `/queue/:id/skip`          | Sets `status='skipped'`. |

## Build order

1. **Infra wiring**
   - Append `crate` to `APPS=()` in `infra/postgres/init/10-app-schemas.sh`.
   - Add `APP_CRATE_PASSWORD` to `.env.example` and `.env`.
   - Pass `APP_CRATE_PASSWORD` through the `postgres` service env in `docker-compose.yml`.
   - `pnpm infra:reset` (destructive, but no data yet).

2. **Seed user**
   - New SQL file `infra/postgres/init/20-seed-users.sql` inserting one row in `shared.users` with a fixed uuid. (Runs only on fresh volume — fine because step 1 just reset.)
   - Record the uuid in `apps/crate` config.

3. **`apps/crate` skeleton**
   - `package.json` (`@stack/crate`), ESM TS, depends on `@stack/db-clients`, `fastify`, `zod`.
   - `tsconfig.json` matching the workspace convention (`.js` extensions on relative imports).
   - Config from env: `DATABASE_URL`, `REDIS_URL`, `USER_ID`, `PORT`.

4. **Schema migration**
   - Plain SQL in `apps/crate/migrations/0001_init.sql`.
   - Tiny boot-time runner (`migrate.ts`) that executes any unrun files tracked in a `crate._migrations` table. Keep it dumb — no Drizzle Kit yet.

5. **iTunes client**
   - `src/itunes.ts`: `searchAlbums(query)` → calls `itunes.apple.com/search?entity=album&term=...&limit=25`, normalizes results.
   - Redis-cached: key `search:<lowercased-trimmed-query>`, TTL 24h.

6. **Endpoints** — implement the table above. Use `zod` for body/query validation. Upserts use `INSERT … ON CONFLICT (provider, provider_*_id) DO UPDATE … RETURNING id`.

7. **Smoke test** — curl through: search → add to queue → list → random → mark listened.

## Conventions to follow (from CLAUDE.md)

- pnpm workspaces, Node ≥ 20, ESM, `.js` extensions on relative TS imports.
- Use `@stack/db-clients` helpers — never import `postgres`/`mongodb`/`ioredis` directly.
- App connects as the `crate` Postgres role (search_path `crate, shared, public`).
- Never write to `shared.*` from this app. Reads only.

## Out of scope for v1

- Auth / multi-user (waiting on `apps/auth`).
- Web UI.
- MusicBrainz enrichment (can be layered later for richer metadata or cross-references).
- Background jobs (refreshing artwork URLs, etc.).
- Deletion endpoints (can re-queue a skipped one instead).
