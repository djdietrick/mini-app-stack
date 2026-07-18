# Build context must be the repo root so the workspace and lockfile are visible.
# Build with: docker build -f apps/ytdigest/Dockerfile -t ytdigest .

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

FROM base AS builder
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db-clients/package.json packages/db-clients/
COPY packages/auth-client/package.json packages/auth-client/
COPY packages/auth-ui/package.json packages/auth-ui/
COPY packages/mailer/package.json packages/mailer/
COPY apps/ytdigest/package.json apps/ytdigest/

RUN pnpm install --frozen-lockfile

COPY packages/db-clients packages/db-clients
COPY packages/auth-client packages/auth-client
COPY packages/auth-ui packages/auth-ui
COPY packages/mailer packages/mailer
COPY apps/ytdigest apps/ytdigest

RUN pnpm --filter @stack/ytdigest build:web

RUN pnpm install --frozen-lockfile --prod

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/db-clients ./packages/db-clients
COPY --from=builder /repo/packages/auth-client ./packages/auth-client
COPY --from=builder /repo/packages/mailer ./packages/mailer
COPY --from=builder /repo/apps/ytdigest/package.json ./apps/ytdigest/package.json
COPY --from=builder /repo/apps/ytdigest/src ./apps/ytdigest/src
COPY --from=builder /repo/apps/ytdigest/migrations ./apps/ytdigest/migrations
COPY --from=builder /repo/apps/ytdigest/web/dist ./apps/ytdigest/web/dist
COPY --from=builder /repo/apps/ytdigest/node_modules ./apps/ytdigest/node_modules

EXPOSE 3103
WORKDIR /app/apps/ytdigest
CMD ["pnpm", "start"]
