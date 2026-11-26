# syntax=docker/dockerfile:1
# Contexto de build: la raíz del monorepo (ver docker-compose.yml). Dos destinos con la misma base Node:
#   builder (el último, el que usa docker-compose.yml): el proyecto Astro y el servicio que lo construye cada vez que
#     la API avisa.
#   dev (compose.dev.yml): Node + pnpm para `vite` (admin) y `astro dev` (sitio), con el código montado desde tu disco.

# Node 22.23.5 (slim, Debian), fijado por digest: un rebuild no cambia de versión por su cuenta. Para actualizar: tag
# nuevo y su digest con `docker buildx imagetools inspect node:<tag>`, el mismo en infra/caddy/Dockerfile (un test de
# infra/test los compara).
ARG NODE_IMAGE=node:22.23.5-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

FROM ${NODE_IMAGE} AS node
# pnpm en la versión exacta de "packageManager" (package.json), bajado una vez al construir la imagen: los servicios de
# dev no lo bajan de internet en cada arranque. La imagen de producción no lo lleva (ver abajo).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack install

# ---------- Desarrollo ----------
# Sin COPY del código: compose.dev.yml monta el repo e instala las dependencias en volúmenes (servicio deps).
FROM node AS dev
WORKDIR /repo

# ---------- Dependencias y código de producción ----------
FROM node AS build

# Primero solo los manifiestos y el lockfile: la capa de `pnpm install` queda cacheada mientras no cambien las
# dependencias, y el store de pnpm (montado, no queda en la imagen) evita volver a bajarlas cuando sí cambian.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/markdown/package.json packages/markdown/
COPY packages/tokens/package.json packages/tokens/
COPY apps/web/package.json apps/web/
COPY apps/builder/package.json apps/builder/
# Solo las dependencias de producción del sitio y del builder (sin React/Vite del admin, ni TypeScript ni astro check:
# `astro build` no los usa).
RUN --mount=type=cache,id=blog-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --filter "@blog/web..." --filter "@blog/builder"

COPY tsconfig.base.json ./
COPY tooling tooling
COPY packages packages
COPY apps/web apps/web
COPY apps/builder apps/builder

# ---------- Producción ----------
FROM ${NODE_IMAGE} AS builder
# Sin gestores de paquetes: el servicio corre `astro build` desde node_modules y nada más. npm, corepack y yarn
# vienen en la imagen base con sus propias dependencias (y sus CVE); acá no se usan.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build /app ./
# astro build guarda cachés en apps/web/.astro y apps/web/node_modules/.astro: el usuario node tiene que poder crearlas
# (sin esto el build falla con EACCES y el sitio nunca se publica).
RUN chown node:node apps/web apps/web/node_modules

ENV NODE_ENV=production \
    WEB_DIR=/app/apps/web \
    SITE_DIR=/site

# El volumen /site lo comparte con Caddy (solo lectura allá). El usuario `node` necesita poder escribir ahí:
# docker-compose lo prepara con el servicio init-permisos.
USER node
EXPOSE 4000
WORKDIR /app/apps/builder
CMD ["node", "src/server.ts"]
