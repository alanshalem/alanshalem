---
name: docker-and-deploy
description: "How this blog runs in Docker and on the VPS, covering the dev compose with live reload, the local production copy on :8080, the hardened production compose (pinned digests, no-new-privileges, dropped capabilities, read-only filesystems, capped logs, healthchecks and start order), the Dockerfiles with dev and prod targets, the whitelist .dockerignore, Caddy rules for caching, security headers, the /api/internal block, the language redirect and 404s, the atomic builder, backups and restore, the CI jobs that validate infra and scan images, and how to validate every infra change with real Caddy and Docker. Use when touching infra/, any Dockerfile, the builder, Caddyfile, environment variables, ports, healthchecks, backups, deployment, Dependabot or the local dev environment, including Windows dev issues."
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
- Password hash: `docker compose ... run --rm --no-deps api hash-password` (before the first `.env` exists:
  `docker build --tag blog-api apps/api && docker run --rm -it blog-api hash-password`); ≥ 12 characters, typed without
  echo; paste it in single quotes (it has `$`).
- The operations runbook (first deploy, update, rollback, backups, logs, rotation, firewall, disk, monitoring) lives in
  `.github/README.md` "Operación": keep it in sync with the scripts and compose files.

## Secrets and env files

- `infra/local.env` is versioned on purpose: throwaway local values (password `admin`, test token), bound to
  127.0.0.1, shared by dev and the local copy so they change in one place. Never reuse them on the VPS.
- The VPS `.env` (from `.env.example`) holds `SITE_ADDRESS`, `SITE_URL`, `BUILDER_TOKEN` (`openssl rand -hex 32`), the
  admin password hash and the optional `ACME_EMAIL` (compose turns it into `CADDY_ACME_EMAIL=email …` or nothing: Caddy
  rejects an empty `email`). It is gitignored; never read, print or commit it — nor the template itself: agents leave
  `.env.example` to the user.
- CI has no `.env`: the VPS compose is validated and built with placeholder values in the step `env`, never secrets.
- The API validates required options on start (`Admin:PasswordHash`, `Builder:Token` ≥ 32 chars): fail fast.

## Images

Every base image is **pinned by digest** (a rebuild never changes version on its own): ffmpeg 9.1 static (SVT-AV1 4.3 +
x264, `mwader/static-ffmpeg`), .NET SDK 10.0.404 / aspnet 10.0.15, `node:22.23.5-slim` (one `ARG NODE_IMAGE`, the same in
`apps/builder/Dockerfile` and `infra/caddy/Dockerfile`: `infra/test/compose.test.ts` compares them), `caddy:2.11.9-alpine`
and `busybox` in the compose. To update: new tag + `docker buildx imagetools inspect <image:tag>`; Dependabot proposes
updates weekly (`.github/dependabot.yml`, one grouped PR for the three Dockerfile folders). CI's node job reads the Node
version from `apps/builder/Dockerfile` and the infra job the Caddy image from `infra/caddy/Dockerfile`: never copy those
references into the workflow.

- `apps/api/Dockerfile` (context `apps/api`): `sdk`, `dev` (SDK + ffmpeg, `dotnet watch`; CI runs `dotnet build -warnaserror`
  and `dotnet test` in it, so the Ffmpeg tests run too) and `runtime` (aspnet, non-root `$APP_UID`, port 8080). Restore
  layer first, NuGet cache mount, publish `-r linux-x64` without `--no-restore`. No curl in the image: the healthcheck is
  the API's own `healthcheck` mode.
- `apps/builder/Dockerfile` (context repo root): `node` stage with pnpm from `packageManager` via corepack, `dev` for
  Vite/Astro, `build` installs only the site and builder production deps. The final `builder` target has **no package
  manager** (npm, npx, corepack and yarn are deleted from the base: 795 → 562 MB, and their CVEs with them); the service
  runs `node_modules/.bin/astro build` and nothing else, as `node`.
- `infra/caddy/Dockerfile` (context repo root): builds the admin with pnpm, precompresses it with the builder's script
  (`node apps/builder/src/precompress.ts apps/admin/dist`, the same `precompressSite` the builder uses; no inline
  `node -e`), then the pinned Caddy with the Caddyfile and `/srv/admin`.
- `.dockerignore` at the root is a **whitelist** (context ~1 MB; no `.env`, data or `node_modules` can leak). A new
  folder an image needs must be added there (`tooling/` was missing once and broke the admin image with TS2307).
- Everything installs with `--frozen-lockfile`: commit `pnpm-lock.yaml` with dependency changes. pnpm ≥ 10.34.5 and
  Node ≥ 22.18 (guarded in `infra/test/compose.test.ts`).

## Production compose (`infra/docker-compose.yml`)

- **Hardening** (`x-service` anchor on every service): `no-new-privileges`, `cap_drop: ALL` (each service adds back only
  what it needs), `pids_limit` 256 (API 512: ffmpeg + .NET threads measured at 84; builder 128: `astro build` peaked at 29;
  `init-permisos` 32). Caddy and the API
  are `read_only` with a `tmpfs` `/tmp`; the API's upload bodies and libvips temp files go to `/data/tmp`
  (`ASPNETCORE_TEMP`, `TMPDIR`) on disk, not in the RAM cap.
- **Caddy runs as root with only `NET_BIND_SERVICE`**: without root it would need high ports and the HTTP→HTTPS redirect
  would carry that port. The API (uid 1654) and the builder (`node`, uid 1000) never run as root.
- `init-permisos` (busybox, `CHOWN` + `DAC_OVERRIDE`) creates `/data/tmp` and `/data/backups` and fixes ownership only of
  what has another owner (`find ! -user … -exec chown`), so an `up` never rewrites all the media; then exits.
- **Logs are capped**: `x-logging` uses the `local` driver, at most 5 × 10 MB per container (prod and dev). The API logs
  one JSON line per event (`Logging__Console__FormatterName=json`); `docker compose logs` works as before.
- **Healthchecks** (`x-healthcheck`: every 30 s, `start_interval` 2 s during a 60 s `start_period`): API
  `["CMD", "dotnet", "Blog.Api.dll", "healthcheck"]` (asks `/api/health/ready`: SQLite answers), builder
  `["CMD", "node", "src/healthcheck.ts"]` (its `GET /health`). Start order: the builder waits for the API
  `service_healthy` (a build reads the API); **Caddy waits only for `service_started`** — the static site must never depend
  on the API being healthy (an earlier `service_healthy` + `required: false` coupled them). Caddy has no healthcheck; its
  own `health_uri /api/health` takes the API out of rotation.
- API has no published ports (only Caddy and the builder reach it); `mem_limit 1536m`, `cpus 2.0` (measured video
  peak ~1.3 GiB; user decision). Builder `mem_limit 1g`, `cpus 1.0`; `astro build` runs with `nice -n 10` and
  `--max-old-space-size=768`. Caddy `128m`. Caps are limits, not measurements: check with `docker stats`.
- Volumes: `api_data` (SQLite, keys, `Video__WorkDirectory`, `tmp`, `backups`), `media` (mounted `:nocopy`), `site`
  (releases + `current`), `caddy_data`, `caddy_config`.
- If the VPS already has a reverse proxy on 80/443, put it in front of this Caddy on an internal network.

## Backups and restore (`infra/backup.sh`, `infra/restore.sh`, shared `infra/backup-common.sh`)

- `backup.sh` (daily by cron, see its header): the database through the API's `backup` mode (consistent SQLite backup
  while serving) and only the new media (**never the Data Protection keys**), into `BACKUP_DIR` (default `/var/backups/blog`);
  keeps 7 daily / 4 weekly snapshots, built in a hidden `.partial` folder and renamed at the end; the database arrives
  verified (CRC and size of both sides) and media is compared by name and size (truncated files are caught). Optional off-site copy with `BACKUP_RCLONE_REMOTE`: it must be an rclone **`crypt`** remote
  (the backup holds the admin hash and drafts; plaintext only with `BACKUP_ALLOW_PLAINTEXT=1`), uploaded with
  `rclone copy` so an empty local folder can never wipe the remote history.
- `restore.sh <snapshot>` only checks the snapshot and prints the plan; `--apply` first copies and verifies everything
  into `.restoring` folders, saves the current state to `BACKUP_DIR/pre-restore-<UTC>` (restorable with the same script),
  then stops api/builder (Caddy keeps serving), swaps database and media, **deletes the session keys**, `up -d --wait`, and
  requests a build (`node src/request-build.ts`); a failure after the stop puts the previous copy back (also with new
  keys). Why no keys: a snapshot predates a logout, and its keys plus its stored session epoch would make a revoked
  cookie valid again. Every restore logs the admin out; never add the keys back to the backup.
- The scripts' headers are the reference for variables and folder layout; the README "Operación" section is the
  runbook. Change the three together.
- Rollback of a release = restore the backup taken before updating: migrations run at startup and `Down` migrations are
  not supported.
- Tested by `infra/test/backup.test.ts` with a fake `docker` on the PATH (skipped on Windows; runs in CI) and once end to
  end with real Docker.

## Caddy rules that must not regress (`infra/caddy/Caddyfile`)

- `/api/internal` → `respond @internal 404` with `no-store`, **inside** `handle /api/*` and before `reverse_proxy`
  (a top-level `respond` never ran because `handle` is evaluated first; security fix `48f0158`).
- `/api/admin/*` → `>Cache-Control "no-store"`. Health check `/api/health` every 2 s, 3 fails.
- Global options first and only `{$CADDY_ACME_EMAIL}` (the whole `email …` option or nothing).
- `(security)`: HSTS, nosniff, Referrer-Policy, Permissions-Policy, `X-Frame-Options DENY`, COOP `same-origin`, `-Server`,
  plus CORP `same-origin` as a separate `header` (inside the deferred `-Server` block it overrode `/media`'s CORP
  `cross-origin`, which RSS readers need). `/admin/*` adds `X-Robots-Tag "noindex"`.
- `/admin/*`: CSP, `@hashed path /assets/*` immutable, everything else `no-cache` (both with matchers: Caddy sorts a
  matcher-less `header` last and it overrode immutable); SPA fallback with `rewrite @spa /index.html` where
  `@spa = not path /assets/* + not file` (`try_files` does not accept a matcher); `precompressed br gzip`.
- `/media/*`: immutable, sandbox CSP, no `encode` (Range must see exact bytes).
- `/`: `header Vary Accept-Language`, `redir @english /en/ 302`, then `redir * /es/ 302` (not `redir /es/`).
- Site: `/_astro/*` immutable, fonts 30 days, pages `no-cache`, `precompressed br gzip` from `/srv/site/current`.
- `handle_errors`: `import security`, `no-store`, 404 rewritten per prefix to `/es/404.html`, `/en/404.html`, else
  `/404.html`. The `(security)` snippet is imported in the site block and in errors (HSTS without
  includeSubDomains on purpose: the VPS hosts other apps).

Every Caddy change: update `apps/web/test/caddyfile.test.ts` (routing and caching) or `infra/test/caddy.test.ts`
(production pass: ACME, COOP/CORP, noindex), then validate with real Caddy (`caddy validate` in the image — CI does it
for the VPS and local forms — and `curl -I` against the local copy) — text tests alone have passed broken configs.

## Builder (`apps/builder`)

Dependency-free Node service: `POST /build` (Bearer), `GET /health`, `GET /status`; debounced queue; builds into
`releases/<UTC timestamp>/`, precompresses, swaps the relative `current` symlink with one `rename`, prunes old
releases (`KEEP_RELEASES`, 3). A failed build never touches `current`. Small entry points for the container:
`src/healthcheck.ts` (compose healthcheck), `src/request-build.ts` (used by `restore.sh`), `src/precompress.ts` (Caddy image).

## Windows dev gotchas

- File events get lost on Windows → Vite/Astro use polling (`tooling/dev-watch.ts`, 300 ms).
- `strictPort` on the admin: a previous Vite still closing made the new one move to 5174 silently.
- Without Docker, start the API first; the site and admin need it (`fetch failed` / `ECONNREFUSED` means it is down).
- Builder tests that create symlinks skip themselves without Developer Mode (EPERM), and `infra/test/backup.test.ts`
  skips on Windows (the scripts are for Linux): CI runs both.

## Checklist

- [ ] Compose/Dockerfile change brought up for real (dev or local copy) and the affected URLs checked.
- [ ] `pnpm test:infra` green and `docker compose ... config -q` for the three stacks (CI's infra job runs both).
- [ ] Caddy change: test updated + real Caddy validation + headers verified with `curl -I`.
- [ ] New files needed by an image added to the `.dockerignore` whitelist.
- [ ] New or updated image pinned by digest; both `NODE_IMAGE` references equal; Trivy (CI `images` job) finds no
      fixable CRITICAL/HIGH.
- [ ] New service: `<<: *service` (hardening + capped logs), a healthcheck if anything waits on it, only the capabilities it
      needs.
- [ ] No secret or real hash in any committed file; only `infra/local.env` test values.
- [ ] Memory/CPU/pids changes measured (`docker stats`) and recorded in the compose comment.
- [ ] Operations changed (scripts, variables, ports)? Update `.github/README.md` "Operación".

## Anti-patterns seen here

- `/api/internal` "blocked" for months by a rule that never ran (`48f0158`).
- A missing hashed admin asset answered with `index.html` cached immutable for a year (`e6058be`).
- 404s of `/media` and `/_astro` inheriting `immutable` (fixed with `no-store` in `handle_errors`).
- Comments claiming a "low priority" compose setting that does not exist (priority is `nice` in the process).
- Unbounded `json-file` logs (the default driver) that fill the VPS disk; fixed with the capped `local` driver.
- Caddy gated on the API's health: a sick API would keep the static site down. Caddy waits only for `service_started`.
- Re-owning all media recursively on every `up` (slow); `init-permisos` now fixes only what differs.
