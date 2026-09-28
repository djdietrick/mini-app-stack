# Build context must be the repo root so the workspace and lockfile are visible.
# Build with: docker build -f apps/landing/Dockerfile -t landing .
#
# A static page, so the runtime is nginx rather than Node. App URLs are baked
# in at build time from the VITE_APP_URL_* build args (see src/urls.ts); unset,
# they fall back to http://localhost:<the app's compose port>.

FROM node:20-alpine AS builder
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/landing/package.json apps/landing/

RUN pnpm install --frozen-lockfile --filter @stack/landing

COPY apps/landing apps/landing

ARG VITE_APP_URL_CRATE
ARG VITE_APP_URL_PANTRY
ARG VITE_APP_URL_YTDIGEST
RUN pnpm --filter @stack/landing build:web

FROM nginx:1.27-alpine
COPY --from=builder /repo/apps/landing/dist /usr/share/nginx/html
EXPOSE 80
