# syntax=docker/dockerfile:1
# Contexto de build: la raíz del monorepo (ver docker-compose.yml).
# Esta imagen contiene el proyecto Astro y el servicio que lo construye cada vez que la API avisa.

FROM node:22-slim
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/markdown packages/markdown
COPY packages/tokens packages/tokens
COPY apps/web apps/web
COPY apps/builder apps/builder

# Solo las dependencias del sitio y del builder (sin React/Vite del admin).
# Con un pnpm-lock.yaml commiteado, cambiar a `pnpm install --frozen-lockfile`.
RUN pnpm install --filter "@blog/web..." --filter "@blog/builder"

ENV NODE_ENV=production \
    WEB_DIR=/app/apps/web \
    SITE_DIR=/site

# El volumen /site lo comparte con Caddy (solo lectura allá). El usuario `node` necesita poder escribir ahí:
# docker-compose lo prepara con el servicio init-permisos.
USER node
EXPOSE 4000
WORKDIR /app/apps/builder
CMD ["node", "src/server.ts"]
