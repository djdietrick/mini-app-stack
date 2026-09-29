# Crate

Crate is an album queue for saving music you intend to hear, choosing what to
play next, and recording what you listened to. Search and artist discographies
come from the iTunes Search API.

Crate runs on both deployment targets:

- Self-hosted: Fastify, Postgres, Redis, and the shared `apps/auth` service.
- Firebase: an Express-backed Cloud Function, Firestore, and Firebase Auth.

The React SPA is served by the app backend when self-hosted and by Firebase
Hosting in the cloud. All queue data is scoped to the authenticated user.

## Domain API

The transport-independent route table is in `src/domain/routes.ts`. It supports
album and artist search, queue listing and filtering, random picks by genre,
ratings, listened/skipped states, requeueing, and deletion. The same table is
mounted under `/api` by both transports.

The repository port in `src/repo/types.ts` has two implementations:

- `src/repo/postgres.ts` stores normalized artists, albums, and queue entries.
- `src/repo/firestore.ts` stores denormalized queue documents while preserving
  the same wire format.

Search results are cached in Redis when self-hosted and in Firestore documents
with TTL metadata in the cloud.

## Development

From the repository root:

```bash
pnpm --filter @stack/crate typecheck
pnpm --filter @stack/crate test
pnpm --filter @stack/crate build:web
```

The Firestore repository tests run when `FIRESTORE_EMULATOR_HOST` is set. See
the root README for full-stack setup and deployment instructions.
