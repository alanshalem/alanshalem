# syntax=docker/dockerfile:1
# Contexto de build: la raíz del monorepo (ver docker-compose.yml).
# Compila el panel de administración y lo mete dentro de la imagen de Caddy junto con el Caddyfile.

FROM node:22-slim AS admin-build
RUN corepack enable
WORKDIR /repo

# Solo lo necesario para instalar y compilar el admin (y los paquetes que usa).
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/markdown packages/markdown
COPY packages/tokens packages/tokens
COPY apps/admin apps/admin
# Con un pnpm-lock.yaml commiteado, cambiar a `pnpm install --frozen-lockfile`.
RUN pnpm install --filter "@blog/admin..."
RUN pnpm --filter @blog/admin build

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=admin-build /repo/apps/admin/dist /srv/admin
