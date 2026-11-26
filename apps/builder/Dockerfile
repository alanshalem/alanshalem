# syntax=docker/dockerfile:1
# Contexto de build: la raíz del monorepo (ver docker-compose.yml). Dos destinos con la misma base Node:
#   builder (el último, el que usa docker-compose.yml): el proyecto Astro y el servicio que lo construye cada vez que
#     la API avisa.
#   dev (compose.dev.yml): Node + pnpm para `vite` (admin) y `astro dev` (sitio), con el código montado desde tu disco.

FROM node:22-slim AS node
# pnpm en la versión exacta de "packageManager" (package.json), bajado una vez al construir la imagen y legible por
# cualquier usuario: el builder corre como `node` y si no lo encontrara lo bajaría de internet en el primer build.
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack install && chmod -R a+rX /opt/corepack

# ---------- Desarrollo ----------
# Sin COPY del código: compose.dev.yml monta el repo e instala las dependencias en volúmenes (servicio deps).
FROM node AS dev
WORKDIR /repo

# ---------- Producción ----------
FROM node AS builder

# Primero solo los manifiestos y el lockfile: la capa de `pnpm install` queda cacheada mientras no cambien las
# dependencias, y el store de pnpm (montado, no queda en la imagen) evita volver a bajarlas cuando sí cambian.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/markdown/package.json packages/markdown/
COPY packages/tokens/package.json packages/tokens/
COPY apps/web/package.json apps/web/
COPY apps/builder/package.json apps/builder/
# Solo las dependencias del sitio y del builder (sin React/Vite del admin).
RUN --mount=type=cache,id=blog-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@blog/web..." --filter "@blog/builder"

COPY tsconfig.base.json ./
COPY tooling tooling
COPY packages packages
COPY apps/web apps/web
COPY apps/builder apps/builder
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
