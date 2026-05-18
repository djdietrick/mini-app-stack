# Build context must be the repo root so the workspace and lockfile are visible.
# Build with: docker build -f apps/crate/Dockerfile -t crate .

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# ---- builder: install all workspace deps and build the SPA bundle.
FROM base AS builder
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db-clients/package.json packages/db-clients/
COPY packages/auth-client/package.json packages/auth-client/
COPY packages/auth-ui/package.json packages/auth-ui/
COPY apps/crate/package.json apps/crate/

RUN pnpm install --frozen-lockfile

COPY packages/db-clients packages/db-clients
COPY packages/auth-client packages/auth-client
COPY packages/auth-ui packages/auth-ui
COPY apps/crate apps/crate

RUN pnpm --filter @stack/crate build:web

# Drop dev deps so node_modules is production-only.
RUN pnpm install --frozen-lockfile --prod

# ---- runner: minimal image with prod deps + sources tsx needs at runtime.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Workspace metadata so pnpm resolves @stack/db-clients via the symlink we copy.
COPY --from=builder /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/db-clients ./packages/db-clients
COPY --from=builder /repo/packages/auth-client ./packages/auth-client
COPY --from=builder /repo/apps/crate/package.json ./apps/crate/package.json
COPY --from=builder /repo/apps/crate/src ./apps/crate/src
COPY --from=builder /repo/apps/crate/migrations ./apps/crate/migrations
COPY --from=builder /repo/apps/crate/web/dist ./apps/crate/web/dist
COPY --from=builder /repo/apps/crate/node_modules ./apps/crate/node_modules

EXPOSE 3001
WORKDIR /app/apps/crate
CMD ["pnpm", "start"]
