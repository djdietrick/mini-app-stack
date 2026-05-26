# Build context must be the repo root so the workspace and lockfile are visible.
# Build with: docker build -f apps/pantry/Dockerfile -t pantry .

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

FROM base AS builder
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db-clients/package.json packages/db-clients/
COPY packages/auth-client/package.json packages/auth-client/
COPY packages/auth-ui/package.json packages/auth-ui/
COPY apps/pantry/package.json apps/pantry/

RUN pnpm install --frozen-lockfile

COPY packages/db-clients packages/db-clients
COPY packages/auth-client packages/auth-client
COPY packages/auth-ui packages/auth-ui
COPY apps/pantry apps/pantry

RUN pnpm --filter @stack/pantry build:web

RUN pnpm install --frozen-lockfile --prod

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/db-clients ./packages/db-clients
COPY --from=builder /repo/packages/auth-client ./packages/auth-client
COPY --from=builder /repo/apps/pantry/package.json ./apps/pantry/package.json
COPY --from=builder /repo/apps/pantry/src ./apps/pantry/src
COPY --from=builder /repo/apps/pantry/migrations ./apps/pantry/migrations
COPY --from=builder /repo/apps/pantry/web/dist ./apps/pantry/web/dist
COPY --from=builder /repo/apps/pantry/node_modules ./apps/pantry/node_modules

EXPOSE 3102
WORKDIR /app/apps/pantry
CMD ["pnpm", "start"]
