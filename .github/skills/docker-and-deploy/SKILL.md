---
name: docker-and-deploy
description: "How this blog runs in Docker and on the VPS, covering the dev compose with live reload, the local production copy on :8080, the Dokploy deploy (compose.dokploy.yml behind Traefik, staging and production, basic auth, noindex), the hardened production compose (pinned digests, no-new-privileges, dropped capabilities, read-only filesystems, capped logs, healthchecks and start order), the Dockerfiles with dev and prod targets, the whitelist .dockerignore, Caddy rules for caching, security headers, the /api/internal block, the language redirect and 404s, the atomic builder, backups and restore, the CI jobs that validate infra and scan images, and how to validate every infra change with real Caddy and Docker. Use when touching infra/, any Dockerfile, the builder, Caddyfile, environment variables, ports, healthchecks, backups, deployment, Dependabot or the local dev environment, including Windows dev issues."
---

# Docker, Caddy and deploy

## Ways to run it

| Goal | Command | Notes |
|---|---|---|
| Dokploy on srv2192513 (production + staging) | Dokploy runs `compose -p <appName> --env-file infra/.env -f infra/docker-compose.yml -f infra/compose.dokploy.yml up -d --build --remove-orphans --wait` from the repo root (`code/`), with `docker` in front | project `<appName>` (one Compose service per environment); Traefik on 80/443 does TLS; Caddy on :80 in `dokploy-network` |
| Dev, only Docker installed (repo root) | `docker compose -f infra/compose.dev.yml --env-file infra/local.env up --build` | project `blog-dev`; API :5090 (`dotnet watch`), admin :5173 (Vite HMR), site :4321 (`astro dev`); code mounted, deps/bin/obj/NuGet/data in volumes |
| Local production copy (from `infra/`) | `docker compose -f docker-compose.yml -f compose.local.yml --env-file local.env up -d --build` | project `blog-local`; same images, caps and volumes as the VPS; HTTP only on `127.0.0.1:${LOCAL_PORT}` (8080) |
| VPS without Dokploy (from `infra/`) | `docker compose --env-file .env up -d --build` | project `blog`; Caddy with automatic TLS on 80/443 |

- `--env-file` goes on **every** command of a project (`up`, `logs`, `ps`, `down`); without it compose names the
  missing variable and stops (accepted trade-off: one env file for dev and the local copy, no silent defaults).
- Ports in use: `API_PORT`, `ADMIN_PORT`, `WEB_PORT` (dev), `LOCAL_PORT` (local copy, also adjusts `SITE_URL`).
- `down -v` deletes the project's volumes, database included. Ask before running it.
- Password hash: `docker compose ... run --rm --no-deps api hash-password` (before the first `.env` exists:
  `docker build --tag blog-api apps/api && docker run --rm -it blog-api hash-password`); ≥ 12 characters, typed without
  echo; paste it in single quotes (it has `$`).
- The operations runbook (first deploy, update, rollback, backups, logs, rotation, firewall, disk, monitoring) lives in
  `docs/README.md` "Operations": keep it in sync with the scripts and compose files.

## Secrets and env files

- `infra/local.env` is versioned on purpose: throwaway local values (password `admin`, test token), bound to
  127.0.0.1, shared by dev and the local copy so they change in one place. Never reuse them on the VPS.
- The VPS `.env` (from `.env.example`) holds `SITE_ADDRESS`, `SITE_URL`, `BUILDER_TOKEN` (`openssl rand -hex 32`), the
  admin password hash and the optional `ACME_EMAIL` (compose turns it into `CADDY_ACME_EMAIL=email …` or nothing: Caddy
  rejects an empty `email`). It is gitignored; never read, print or commit it — nor the template itself: agents leave
  `.env.example` to the user.
- Under Dokploy the values live in the service's Environment tab; Dokploy writes them to `infra/.env` on every deploy
  (next to the compose path) as `KEY="value"` with `$` escaped, after `APP_NAME` and `COMPOSE_PROJECT_NAME=<appName>`.
  A single-quoted hash pasted there arrives intact (dotenv strips the quotes, verified). It also carries
  `COMPOSE_FILE=docker-compose.yml:compose.dokploy.yml`, so any `docker compose --env-file .env` from that `infra/`
  (and `backup.sh` / `restore.sh`) targets that environment's stack; `infra/test/backup.test.ts` ("under Dokploy")
  pins it for unquoted and quoted values, and fails if the scripts ever pass `-p`/`-f` or export a `COMPOSE_*` default.
- `PROXY_SECRET` (Dokploy only, `openssl rand -hex 32`, one per environment): in the Environment tab and in Traefik's
  dynamic file, never in git. `compose.dokploy.yml` requires it (`${PROXY_SECRET:?…}`); CI uses a placeholder.
- CI has no `.env`: the VPS compose is validated and built with placeholder values in the step `env`, never secrets.
- The API validates required options on start (`Admin:PasswordHash`, `Builder:Token` ≥ 32 chars): fail fast.
- `BUILDER_TOKEN` is required once, in the `x-builder-token` anchor (`&builder-token`, `${BUILDER_TOKEN:?…}`), and the
  API and the builder both read that anchor, in production and in dev.

## Images

Every base image is **pinned by digest** (a rebuild never changes version on its own): ffmpeg 9.1 static (SVT-AV1 4.3 +
x264, `mwader/static-ffmpeg`), .NET SDK 11.0.100 / aspnet 11.0.0 (Ubuntu 26.04), `node:22.23.5-slim` (one `ARG NODE_IMAGE`, the same in
`apps/builder/Dockerfile` and `infra/caddy/Dockerfile`: `infra/test/compose.test.ts` compares them), `caddy:2.11.9-alpine`
and `busybox` in the compose. To update: new tag + `docker buildx imagetools inspect <image:tag>`; Dependabot proposes
updates weekly (`.github/dependabot.yml`, one grouped PR for the three Dockerfile folders). `.trivyignore` holds the
accepted findings, each with a reason and an expiry ≤ 60 days (CVE-2025-6020, libpam in the node:22 Debian 12 base:
no node:22 digest had the fix on 2026-11-27, and the trixie variant has another fixable HIGH). CI's node job reads the
Node version from `apps/builder/Dockerfile` and the infra job the Caddy image from `infra/caddy/Dockerfile`: never copy
those references into the workflow.

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
  `init-permissions` 32). Caddy and the API
  are `read_only` with a `tmpfs` `/tmp`; the API's upload bodies and libvips temp files go to `/data/tmp`
  (`ASPNETCORE_TEMP`, `TMPDIR`) on disk, not in the RAM cap.
- **Caddy runs as root with only `NET_BIND_SERVICE`**: without root it would need high ports and the HTTP→HTTPS redirect
  would carry that port. The API (uid 1654) and the builder (`node`, uid 1000) never run as root.
- `init-permissions` (busybox, `CHOWN` + `DAC_OVERRIDE`) creates `/data/tmp` and `/data/backups` and fixes ownership only of
  what has another owner (`find ! -user … -exec chown`), so an `up` never rewrites all the media; then exits.
- **Logs are capped**: `x-logging` uses the `local` driver, at most 5 × 10 MB per container (prod and dev). The API logs
  one JSON line per event (`Logging__Console__FormatterName=json`); `docker compose logs` works as before.
- **Healthchecks** (`x-healthcheck`: every 30 s, `start_interval` 2 s during a 60 s `start_period`): API
  `["CMD", "dotnet", "Blog.Api.dll", "healthcheck"]` (asks `/api/health/ready`: SQLite answers), builder
  `["CMD", "node", "src/healthcheck.ts"]` (its `GET /health`). Start order: the builder waits for the API
  `service_healthy` (a build reads the API); **Caddy waits only for `service_started`** — the static site must never depend
  on the API being healthy (an earlier `service_healthy` + `required: false` coupled them). Caddy's healthcheck asks its
  own admin endpoint (`["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:2019/config/"]`; Caddy's default
  admin address, localhost inside the container, never published nor reachable from `dokploy-network`): healthy once
  the Caddyfile loaded, never asks the API. Without it `up --wait` passed on a Caddy that crash-loops (a SITE_ENV typo:
  compose saw it running for an instant). Its own `health_uri /api/health` takes the API out of rotation.
- API has no published ports (only Caddy and the builder reach it); `mem_limit 1536m`, `cpus 2.0` (measured video
  peak ~1.3 GiB; user decision). Builder `mem_limit 1g`, `cpus 1.0`; `astro build` runs with `nice -n 10` and
  `--max-old-space-size=768`. Caddy `128m`. Caps are limits, not measurements: check with `docker stats`.
- Volumes: `api_data` (SQLite, keys, `Video__WorkDirectory`, `tmp`, `backups`), `media` (mounted `:nocopy`), `site`
  (releases + `current`), `caddy_data`, `caddy_config`.
- If the VPS already has a reverse proxy on 80/443, put it in front of this Caddy on an internal network (what
  `compose.dokploy.yml` does for Traefik).

## Behind Dokploy (`infra/compose.dokploy.yml`)

Dokploy v0.31.4 (Traefik v3.7, Swarm on the host, overlay `dokploy-network`) deploys a Compose service by cloning the
branch (`git clone --branch <b> --depth 1`) into `/etc/dokploy/compose/<appName>/code`, rewriting the compose path
file (yaml parse with merge keys, then Traefik labels and `dokploy-network` on the domain's service) and running its
command from `code/` with `docker` in front. Containers are `<appName>-<service>-1` (use that name in checks: on
`dokploy-network` the `caddy` alias is shared by every app's Caddy). It reads **one** compose file, so the override
goes in through the custom command (Advanced → Command); the base file stays the plain-VPS one and CI keeps validating
it.

- The override only touches Caddy: `ports: !reset []` (Traefik owns 80/443 TCP+UDP), `SITE_ADDRESS: ":80"` (no ACME),
  `CADDY_TRUSTED_PROXIES: trusted_proxies static private_ranges`, `PROXY_SECRET`, networks `default` + external
  `dokploy-network`.
  The API and the builder stay only on the stack's private network. `!reset` lives in the override on purpose: Dokploy
  re-serializes the base file and would drop a custom YAML tag there.
- Type **Docker Compose**, never Stack (no `build`). Isolated Deployments off (it would add every service to a
  Traefik-reachable network). Domain: service `caddy`, port 80, HTTPS + Let's Encrypt; a domain change needs a redeploy.
- Client IP chain: Traefik drops visitor-sent `X-Forwarded-*` and sends one address; Caddy trusts private ranges only
  under Dokploy and forwards `X-Forwarded-For {client_ip}` alone, which the API (KnownNetworks, ForwardLimit 1) uses
  for the login rate limit. `X-Forwarded-Proto: https` passes through the same way.
- Proxy gate (A2b): `dokploy-network` is shared by every Dokploy app on the VPS (Paperclip, ting, wearemaking), so
  "only containers on its networks reach it" is not a boundary: any of them could call `caddy:80`, forge
  `X-Forwarded-For` (a fresh login rate-limit bucket per request) and skip the staging basic auth. Traefik adds
  `X-Proxy-Secret: <PROXY_SECRET>` to every request (a `headers.customRequestHeaders` middleware per environment,
  `alanshalem-<env>-proxy-secret@file` in `/etc/dokploy/traefik/dynamic/`, on the domain's Middlewares field) and
  Caddy answers 403 to anything without it, before any route: the private-range trust only ever applies to requests
  that came through Traefik. Rejected alternatives: trusting Traefik's address (dynamic on the overlay, changes when
  Dokploy recreates Traefik, and still lets a direct caller skip basic auth), basic auth in Caddy (stops the bypass,
  not the forged header), a private network shared only with Traefik (manual `docker network connect`, lost when
  Traefik is recreated) and mTLS (TLS between Traefik and Caddy for one header's worth of proof). Residual risk: a
  container with `NET_RAW` that can ARP-spoof the overlay could read the secret in transit (it could read all traffic
  then).
- Staging: `SITE_ENV=staging` → Caddy adds `X-Robots-Tag: noindex, nofollow` everywhere and serves a disallow-all
  `robots.txt`; basic auth is a Traefik `basicAuth` middleware in `/etc/dokploy/traefik/dynamic/` (bcrypt, VPS only)
  referenced from the domain's Middlewares field as `alanshalem-staging-auth@file`, next to
  `alanshalem-staging-proxy-secret@file` (Dokploy's Security tab is for Applications only). `removeHeader: true`
  keeps `Authorization` away from the API.
- Triggers: staging on push to `master` (skips `[skip ci]` commits); production on tag, which deploys the **branch
  head**, not the tagged commit.
- Volumes are `<appName>_<volume>`: per environment, kept across deploys (`--remove-orphans` never removes volumes);
  deleting the service with "delete volumes" ticked runs `down --volumes`.
- `init-permissions` (one-shot) and the `depends_on` conditions behave as with plain compose. The command ends with
  `--wait` (A2c), so the deploy fails when a container exits or does not get healthy (`container <appName>-caddy-1 is
  unhealthy` for a SITE_ENV typo, ~4 s; measured locally, compose v5.7.1); `--wait` accepts the one-shot exiting 0.
  A failed deploy is not rolled back. `infra/test/compose.test.ts` requires the same command in the header of
  `compose.dokploy.yml`, the README and this skill.
- Availability: Traefik only routes to a healthy container. A deploy that does not change Caddy does not recreate it
  (no failed request); one that does (Caddyfile, admin, image, environment) leaves the domain answering 404 for ~5 s
  (~3 s of it is the old Caddy stopping; measured behind Traefik v3.7.19). The README "Dokploy: release flow" says so.
- Not verifiable without a real Dokploy (README "Verify on the first real deploy"): the Middlewares field of Compose
  domains, the tag trigger, `COMPOSE_PROJECT_NAME` in its env file, `$` in the single-quoted hash, `--wait` there.
- Verified end to end locally with Traefik v3.7.19 + docker provider on a `dokploy-network`, the base file rewritten
  the way Dokploy does, staging and production side by side: 401 without credentials, noindex only on staging, the
  API logging the client Traefik saw (a visitor-sent X-Forwarded-For ignored), 429 after 10 failed logins, and
  `backup.sh` + `restore.sh --apply` finding the stack from its env file alone.
- Ports are written in files that cannot import each other: `infra/test/ports.test.ts` fails when one changes alone.
  API: the Dockerfile's `ASPNETCORE_URLS` (runtime and dev), its own `healthcheck` command, the Caddyfile and the
  compose files; builder: its config default, its `EXPOSE` and the URL the API calls. Change a port everywhere at once.

## Backups and restore (`infra/backup.sh`, `infra/restore.sh`, shared `infra/backup-common.sh`)

`backup-common.sh` holds only what both scripts use (compose wrapper, logging, the API backup and its verification,
sizes); a helper used by one script lives in that script.

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
- The scripts' headers are the reference for variables and folder layout; the README "Operations" section is the
  runbook. Change the three together.
- Deploying the version that introduces the session epoch logs the admin out once (older cookies carry no epoch
  claim); the README "Update" section says so.
- Rollback of a release = restore the backup taken before updating: migrations run at startup and `Down` migrations are
  not supported.
- Under Dokploy: root's cron runs `/etc/dokploy/compose/<appName>/code/infra/backup.sh` with a `BACKUP_DIR` per
  environment (one shared folder would rotate the other environment's snapshots away); the script needs no change.
  Dokploy's Volume Backups are not a substitute (a live SQLite copy can be inconsistent; keys must stay out).
- Tested by `infra/test/backup.test.ts` with a fake `docker` on the PATH (skipped on Windows; runs in CI) and end to end
  with real Docker (plain compose and the Dokploy shape).

## Caddy rules that must not regress (`infra/caddy/Caddyfile`)

- `/api/internal` → `respond @internal 404` with `no-store`, **inside** `handle /api/*` and before `reverse_proxy`
  (a top-level `respond` never ran because `handle` is evaluated first; security fix `48f0158`).
- `/api/admin/*` → `>Cache-Control "no-store"`. Health check `/api/health` every 2 s, 3 fails.
- Global options first: `{$CADDY_ACME_EMAIL}` (the whole `email …` option or nothing), `servers {
  {$CADDY_TRUSTED_PROXIES} }` (empty = trust nobody, the plain VPS; the Dokploy override fills it) and
  `order error before handle`. No `trusted_proxies_strict`: it skips every trusted (private) address, and a visitor
  Traefik sees as Docker's gateway became Traefik's IP in the API.
- Proxy gate, first in the site block: `@unproxied expression {env.PROXY_SECRET} != "" && {header.X-Proxy-Secret} !=
  {env.PROXY_SECRET}` + `error @unproxied 403`. `error` normally runs after `handle` (the `/api/internal` lesson), hence
  the global `order`; it is the only `error` in the file (a test counts them). Without `PROXY_SECRET` it matches
  nothing. The secret goes no further: `header_up -X-Proxy-Secret` and the access log's `format filter { wrap json;
  request>headers>X-Proxy-Secret delete }` (Caddy only redacts Cookie/Authorization on its own).
- `SITE_ENV` allowlist: empty snippets `(site-env-production)` and `(site-env-staging)`, and the site block does
  `import site-env-{$SITE_ENV:production}`; any other value fails at load ("File to import not found: site-env-prod"),
  so `caddy validate` fails and the container does not start. Compose cannot validate an enum.
- `reverse_proxy api:8080` sends `header_up X-Forwarded-For {client_ip}`: one address, the visitor (identical to
  Caddy's default when nothing is trusted).
- Staging: `@staging expression {env.SITE_ENV} == "staging"` is defined **once in the site block** (defining it in
  the `(security)` snippet, imported twice, makes Caddy reject the file); the snippet uses it with a deferred
  `header @staging >X-Robots-Tag "noindex, nofollow"` (so errors get it and it beats the admin's `noindex`), and
  `handle @staging_robots` answers `/robots.txt` with `Disallow: /`. `SITE_ENV` comes from the base compose
  (`${SITE_ENV:-production}`).
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
(production pass: ACME, COOP/CORP, noindex, proxy gate, SITE_ENV), then validate with real Caddy (`caddy validate` in
the image — CI does it for the VPS, local and Dokploy forms — and `sh infra/test/caddy-runtime.sh`, which CI's infra
job also runs: the pinned image against a stub API, production at the edge, staging and production behind a proxy,
checked with curl for noindex, robots.txt, 404, /api, the 403 gate, forged X-Forwarded-For, a stray X-Proxy-Secret at
the edge (not refused, not forwarded), the secret absent from `docker logs` of Caddy, and a SITE_ENV typo) —
text tests alone have passed broken configs.

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
- [ ] `pnpm test:infra` green and `docker compose ... config -q` for the four stacks: VPS, Dokploy
      (`-f docker-compose.yml -f compose.dokploy.yml`, needs a placeholder `PROXY_SECRET`), local copy and dev.
- [ ] Caddyfile change: `sh infra/test/caddy-runtime.sh` green (CI runs it too).
- [ ] Caddy change: test updated + real Caddy validation + headers verified with `curl -I`.
- [ ] New files needed by an image added to the `.dockerignore` whitelist.
- [ ] New or updated image pinned by digest; both `NODE_IMAGE` references equal; Trivy (CI `images` job) finds no
      fixable CRITICAL/HIGH.
- [ ] New service: `<<: *service` (hardening + capped logs), a healthcheck if anything waits on it, only the capabilities it
      needs.
- [ ] No secret or real hash in any committed file; only `infra/local.env` test values.
- [ ] Memory/CPU/pids changes measured (`docker stats`) and recorded in the compose comment.
- [ ] Operations changed (scripts, variables, ports)? Update `docs/README.md` "Operations"; ports also in
      `infra/test/ports.test.ts`.

## Anti-patterns seen here

- `/api/internal` "blocked" for months by a rule that never ran (`48f0158`).
- A missing hashed admin asset answered with `index.html` cached immutable for a year (`e6058be`).
- 404s of `/media` and `/_astro` inheriting `immutable` (fixed with `no-store` in `handle_errors`).
- Comments claiming a "low priority" compose setting that does not exist (priority is `nice` in the process).
- Unbounded `json-file` logs (the default driver) that fill the VPS disk; fixed with the capped `local` driver.
- Caddy gated on the API's health: a sick API would keep the static site down. Caddy waits only for `service_started`.
- Re-owning all media recursively on every `up` (slow); `init-permissions` now fixes only what differs.
- `trusted_proxies_strict` behind Traefik: with a private client address the API saw Traefik's IP (all visitors would
  share one login rate limit). Caught by the Dokploy-shaped end-to-end, not by `caddy validate`.
- Trusting `private_ranges` on the shared `dokploy-network` with no proof of origin: any other Dokploy app could forge
  `X-Forwarded-For` and skip the staging basic auth by calling `caddy:80` directly (A2 review; fixed by the proxy gate).
- `SITE_ENV=prod` (a typo) silently behaving as production: now Caddy refuses the file.
- `up --wait` trusted to catch that typo while Caddy had no healthcheck: it exited 0 on a crash-looping Caddy. Caddy
  now has a healthcheck; prove a `--wait` claim with the failure it should catch.
