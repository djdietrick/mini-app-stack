# Build context must be the repo root so the workspace and lockfile are visible.
# Build with: docker build -f apps/auth/Dockerfile -t auth .

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

FROM base AS builder
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db-clients/package.json packages/db-clients/
COPY apps/auth/package.json apps/auth/

RUN pnpm install --frozen-lockfile

COPY packages/db-clients packages/db-clients
COPY apps/auth apps/auth

RUN pnpm install --frozen-lockfile --prod

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/db-clients ./packages/db-clients
COPY --from=builder /repo/apps/auth/package.json ./apps/auth/package.json
COPY --from=builder /repo/apps/auth/src ./apps/auth/src
COPY --from=builder /repo/apps/auth/node_modules ./apps/auth/node_modules

EXPOSE 3000
WORKDIR /app/apps/auth
CMD ["pnpm", "start"]
