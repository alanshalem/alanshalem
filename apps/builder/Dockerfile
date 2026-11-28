# syntax=docker/dockerfile:1
# Build context: the monorepo root (see docker-compose.yml). Two targets on the same Node base:
#   builder (the last one, used by docker-compose.yml): the Astro project and the service that builds it every time
#     the API reports changes.
#   dev (compose.dev.yml): Node + pnpm for `vite` (admin) and `astro dev` (site), with the code mounted from your disk.

# Node 22.23.5 (slim, Debian), pinned by digest: a rebuild never changes version on its own. To update: the new tag
# and its digest from `docker buildx imagetools inspect node:<tag>`, the same one in infra/caddy/Dockerfile (a test in
# infra/test compares them).
ARG NODE_IMAGE=node:22.23.5-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

FROM ${NODE_IMAGE} AS node
# pnpm at the exact "packageManager" version (package.json), downloaded once when building the image: the dev services
# do not download it from the internet on every start. The production image does not carry it (see below).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack install

# ---------- Development ----------
# No COPY of the code: compose.dev.yml mounts the repo and installs the dependencies into volumes (deps service).
FROM node AS dev
WORKDIR /repo

# ---------- Production dependencies and code ----------
FROM node AS build

# Only the manifests and the lockfile first: the `pnpm install` layer stays cached while the dependencies do not
# change, and the pnpm store (mounted, it never lands in the image) avoids downloading them again when they do.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/markdown/package.json packages/markdown/
COPY packages/math/package.json packages/math/
COPY packages/highlight/package.json packages/highlight/
COPY packages/diagrams/package.json packages/diagrams/
COPY packages/tokens/package.json packages/tokens/
COPY apps/web/package.json apps/web/
COPY apps/builder/package.json apps/builder/
# Only the production dependencies of the site and the builder (no React/Vite from the admin, no TypeScript or astro
# check: `astro build` does not use them).
RUN --mount=type=cache,id=blog-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --filter "@blog/web..." --filter "@blog/builder"

COPY tsconfig.base.json ./
COPY tooling tooling
COPY packages packages
COPY apps/web apps/web
COPY apps/builder apps/builder

# ---------- Production ----------
FROM ${NODE_IMAGE} AS builder
# No package managers: the service runs `astro build` from node_modules and nothing else. npm, corepack and yarn come
# with the base image along with their own dependencies (and their CVEs); they are not used here.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build /app ./
# astro build keeps caches in apps/web/.astro and apps/web/node_modules/.astro: the node user must be able to create
# them (without this the build fails with EACCES and the site is never published).
RUN chown node:node apps/web apps/web/node_modules

ENV NODE_ENV=production \
    WEB_DIR=/app/apps/web \
    SITE_DIR=/site

# The /site volume is shared with Caddy (read-only there). The `node` user needs to write to it: docker-compose
# prepares it with the init-permissions service.
USER node
EXPOSE 4000
WORKDIR /app/apps/builder
CMD ["node", "src/server.ts"]
