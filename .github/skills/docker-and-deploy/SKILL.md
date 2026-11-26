---
name: docker-and-deploy
description: "How this blog runs in Docker and on the VPS, covering the dev compose with live reload, the local production copy on :8080, the production compose with memory caps, the Dockerfiles with dev and prod targets, the whitelist .dockerignore, Caddy rules for caching, security headers, the /api/internal block, the language redirect and 404s, the atomic builder and how to validate every infra change with real Caddy and Docker. Use when touching infra/, any Dockerfile, the builder, Caddyfile, environment variables, ports, deployment or the local dev environment, including Windows dev issues."
---

# Docker, Caddy and deploy

## Three ways to run it

| Goal | Command | Notes |
|---|---|---|
| Dev, only Docker installed (repo root) | `docker compose -f infra/compose.dev.yml --env-file infra/local.env up --build` | project `blog-dev`; API :5090 (`dotnet watch`), admin :5173 (Vite HMR), site :4321 (`astro dev`); code mounted, deps/bin/obj/NuGet/data in volumes |
| Local production copy (from `infra/`) | `docker compose -f docker-compose.yml -f compose.local.yml --env-file local.env up -d --build` | project `blog-local`; same images, caps and volumes as the VPS; HTTP only on `127.0.0.1:${LOCAL_PORT}` (8080) |
| VPS (from `infra/`) | `docker compose --env-file .env up -d --build` | project `blog`; Caddy with automatic TLS on 80/443 |

- `--env-file` goes on **every** command of a project (`up`, `logs`, `ps`, `down`); without it compose names the
  missing variable and stops (accepted trade-off, review R4-compose-dev-requires-envfile).
- Ports in use: `API_PORT`, `ADMIN_PORT`, `WEB_PORT` (dev), `LOCAL_PORT` (local copy, also adjusts `SITE_URL`).
- `down -v` deletes the project's volumes, database included. Ask before running it.
- Password hash: `docker compose ... run --rm --no-deps api hash-password`; paste it in single quotes (it has `$`).

## Secrets and env files

- `infra/local.env` is versioned on purpose: throwaway local values (password `admin`, test token), bound to
  127.0.0.1, shared by dev and the local copy so they change in one place. Never reuse them on the VPS.
- The VPS `.env` (from `.env.example`) holds `SITE_ADDRESS`, `SITE_URL`, `BUILDER_TOKEN` (`openssl rand -hex 32`) and
  the admin password hash. It is gitignored; never read, print or commit it.
- The API validates required options on start (`Admin:PasswordHash`, `Builder:Token` ≥ 32 chars): fail fast.

## Images

- `apps/api/Dockerfile` (context `apps/api`): `dev` (SDK + ffmpeg, `dotnet watch`) and `runtime` (aspnet, non-root
  `$APP_UID`, port 8080). ffmpeg/ffprobe 9.1 static (SVT-AV1 4.3 + x264) **pinned by digest** from
  `mwader/static-ffmpeg`. Restore layer first, NuGet cache mount, publish `-r linux-x64` without `--no-restore`.
- `apps/builder/Dockerfile` (context repo root): `node` base with pnpm from `packageManager` via corepack; `dev`
  target for Vite/Astro; final `builder` target runs the service as `node`.
- `infra/caddy/Dockerfile` (context repo root): builds the admin with pnpm, precompresses it with the builder's
  `precompressSite` (`.br`/`.gz`), then `caddy:2-alpine` with the Caddyfile and `/srv/admin`.
- `.dockerignore` at the root is a **whitelist** (context ~1 MB; no `.env`, data or `node_modules` can leak). A new
  folder an image needs must be added there (`tooling/` was missing once and broke the admin image with TS2307).
- Everything installs with `--frozen-lockfile`: commit `pnpm-lock.yaml` with dependency changes.

## Production compose (`infra/docker-compose.yml`)

- `init-permisos` (busybox) fixes ownership of new volumes (API uid 1654, builder uid 1000), then exits.
- API has no published ports (only Caddy and the builder reach it); `mem_limit 1536m`, `cpus 2.0` (measured video
  peak ~1.3 GiB; user decision). Builder `mem_limit 1g`, `cpus 1.0`; `astro build` runs with `nice -n 10` and
  `--max-old-space-size=768`. Caddy `128m`. Caps are limits, not measurements: check with `docker stats`.
- Volumes: `api_data` (SQLite, keys, `Video__WorkDirectory`), `media` (mounted `:nocopy`), `site` (releases +
  `current`), `caddy_data`, `caddy_config`. Back them up; there are no automatic backups.
- If the VPS already has a reverse proxy on 80/443, put it in front of this Caddy on an internal network.

## Caddy rules that must not regress (`infra/caddy/Caddyfile`)

- `/api/internal` → `respond @internal 404` with `no-store`, **inside** `handle /api/*` and before `reverse_proxy`
  (a top-level `respond` never ran because `handle` is evaluated first; security fix `48f0158`).
- `/api/admin/*` → `>Cache-Control "no-store"`. Health check `/api/health` every 2 s, 3 fails.
- `/admin/*`: CSP, `@hashed path /assets/*` immutable, everything else `no-cache` (both with matchers: Caddy sorts a
  matcher-less `header` last and it overrode immutable); SPA fallback with `rewrite @spa /index.html` where
  `@spa = not path /assets/* + not file` (`try_files` does not accept a matcher); `precompressed br gzip`.
- `/media/*`: immutable, sandbox CSP, no `encode` (Range must see exact bytes).
- `/`: `header Vary Accept-Language`, `redir @english /en/ 302`, then `redir * /es/ 302` (not `redir /es/`).
- Site: `/_astro/*` immutable, fonts 30 days, pages `no-cache`, `precompressed br gzip` from `/srv/site/current`.
- `handle_errors`: `import security`, `no-store`, 404 rewritten per prefix to `/es/404.html`, `/en/404.html`, else
  `/404.html`. The `(security)` snippet is imported in the site block and in errors (HSTS without
  includeSubDomains on purpose: the VPS hosts other apps).

Every Caddy change: update `apps/web/test/caddyfile.test.ts`, then validate with real Caddy (`caddy validate` in the
image and `curl -I` against the local copy) — text tests alone have passed broken configs.

## Builder (`apps/builder`)

Dependency-free Node service: `POST /build` (Bearer), `GET /health`, `GET /status`; debounced queue; builds into
`releases/<UTC timestamp>/`, precompresses, swaps the relative `current` symlink with one `rename`, prunes old
releases. A failed build never touches `current`.

## Windows dev gotchas

- File events get lost on Windows → Vite/Astro use polling (`tooling/dev-watch.ts`, 300 ms).
- `strictPort` on the admin: a previous Vite still closing made the new one move to 5174 silently.
- Without Docker, start the API first; the site and admin need it (`fetch failed` / `ECONNREFUSED` means it is down).
- Symlink tests need Developer Mode (EPERM otherwise).

## Checklist

- [ ] Compose/Dockerfile change brought up for real (dev or local copy) and the affected URLs checked.
- [ ] Caddy change: test updated + real Caddy validation + headers verified with `curl -I`.
- [ ] New files needed by an image added to the `.dockerignore` whitelist.
- [ ] No secret or real hash in any committed file; only `infra/local.env` test values.
- [ ] Memory/CPU changes measured (`docker stats`) and recorded in the compose comment.

## Anti-patterns seen here

- `/api/internal` "blocked" for months by a rule that never ran (`48f0158`).
- A missing hashed admin asset answered with `index.html` cached immutable for a year (`e6058be`).
- 404s of `/media` and `/_astro` inheriting `immutable` (fixed with `no-store` in `handle_errors`).
- Comments claiming a "low priority" compose setting that does not exist (priority is `nice` in the process).
