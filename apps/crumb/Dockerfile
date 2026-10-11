# Build context must be the repo root so the workspace and lockfile are visible.
# Build with: docker build -f apps/crumb/Dockerfile -t crumb .

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
COPY packages/service-kit/package.json packages/service-kit/
COPY apps/crumb/package.json apps/crumb/

RUN pnpm install --frozen-lockfile

COPY packages/db-clients packages/db-clients
COPY packages/auth-client packages/auth-client
COPY packages/auth-ui packages/auth-ui
COPY packages/mailer packages/mailer
COPY packages/service-kit packages/service-kit
COPY apps/crumb apps/crumb

RUN pnpm --filter @stack/crumb build:web

RUN pnpm install --frozen-lockfile --prod

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/db-clients ./packages/db-clients
COPY --from=builder /repo/packages/auth-client ./packages/auth-client
COPY --from=builder /repo/packages/mailer ./packages/mailer
COPY --from=builder /repo/packages/service-kit ./packages/service-kit
COPY --from=builder /repo/apps/crumb/package.json ./apps/crumb/package.json
COPY --from=builder /repo/apps/crumb/src ./apps/crumb/src
COPY --from=builder /repo/apps/crumb/migrations ./apps/crumb/migrations
COPY --from=builder /repo/apps/crumb/web/dist ./apps/crumb/web/dist
COPY --from=builder /repo/apps/crumb/node_modules ./apps/crumb/node_modules

EXPOSE 3105
WORKDIR /app/apps/crumb
CMD ["pnpm", "start"]
