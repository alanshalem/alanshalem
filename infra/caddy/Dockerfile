# syntax=docker/dockerfile:1
# Build context: the monorepo root (see docker-compose.yml).
# Builds the admin panel and puts it inside the Caddy image together with the Caddyfile.

# Base images pinned by digest (exact bytes): a rebuild never changes version on its own. To update: the new tag and
# its digest with `docker buildx imagetools inspect <image:tag>`. Node is the same as in apps/builder/Dockerfile (a test
# in infra/test compares them).
ARG NODE_IMAGE=node:22.23.5-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

FROM ${NODE_IMAGE} AS admin-build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Only the manifests and the lockfile first: the `pnpm install` layer stays cached while the dependencies do not
# change, and the pnpm store (mounted, not left in the image) avoids downloading them again when they do.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/markdown/package.json packages/markdown/
COPY packages/math/package.json packages/math/
COPY packages/highlight/package.json packages/highlight/
COPY packages/diagrams/package.json packages/diagrams/
COPY packages/tokens/package.json packages/tokens/
COPY apps/admin/package.json apps/admin/
# Only the admin and the packages it uses.
RUN --mount=type=cache,id=blog-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@blog/admin..."

COPY tsconfig.base.json ./
COPY tooling tooling
COPY packages packages
COPY apps/admin apps/admin
RUN pnpm --filter @blog/admin build

# Next to every text file, its .br and .gz (Caddyfile: `precompressed br gzip`): compressed once, at the highest level,
# instead of on every request. The same function the builder uses to precompress the site.
COPY apps/builder/src/compress.ts apps/builder/src/precompress.ts apps/builder/src/
RUN node apps/builder/src/precompress.ts apps/admin/dist

# Caddy 2.11.9 (Alpine).
FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=admin-build /repo/apps/admin/dist /srv/admin
