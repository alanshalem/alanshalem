# syntax=docker/dockerfile:1
# Contexto de build: la raíz del monorepo (ver docker-compose.yml).
# Compila el panel de administración y lo mete dentro de la imagen de Caddy junto con el Caddyfile.

# Imágenes base fijadas por digest (bytes exactos): un rebuild no cambia de versión por su cuenta. Para actualizar: tag
# nuevo y su digest con `docker buildx imagetools inspect <imagen:tag>`. Node es el mismo que en apps/builder/Dockerfile
# (un test de infra/test los compara).
ARG NODE_IMAGE=node:22.23.5-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

FROM ${NODE_IMAGE} AS admin-build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Primero solo los manifiestos y el lockfile: la capa de `pnpm install` queda cacheada mientras no cambien las
# dependencias, y el store de pnpm (montado, no queda en la imagen) evita volver a bajarlas cuando sí cambian.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/markdown/package.json packages/markdown/
COPY packages/tokens/package.json packages/tokens/
COPY apps/admin/package.json apps/admin/
# Solo el admin y los paquetes que usa.
RUN --mount=type=cache,id=blog-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@blog/admin..."

COPY tsconfig.base.json ./
COPY tooling tooling
COPY packages packages
COPY apps/admin apps/admin
RUN pnpm --filter @blog/admin build

# Junto a cada archivo de texto, su .br y .gz (Caddyfile: `precompressed br gzip`): se comprime una vez, al máximo nivel,
# en vez de en cada petición. La misma función con la que el builder precomprime el sitio.
COPY apps/builder/src/compress.ts apps/builder/src/precompress.ts apps/builder/src/
RUN node apps/builder/src/precompress.ts apps/admin/dist

# Caddy 2.11.9 (Alpine).
FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=admin-build /repo/apps/admin/dist /srv/admin
