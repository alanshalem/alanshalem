# AGENTS.md

Context for any coding agent (Codex, Copilot, Cursor, Gemini CLI, Antigravity, OpenCode, Claude Code via `CLAUDE.md`).
Skills with the detail live in `.agents/skills/` (the source); `.claude/skills/` and `.github/skills/` are generated
copies — never edit them by hand.

## What this is

A personal, bilingual (Spanish/English) blog for a small shared VPS. The repo is also the owner's GitHub profile:
the root `README.md` is the profile page and the project README is `docs/README.md` (GitHub shows
`.github/README.md` before the root one, on the profile too, so nothing may live there). Code is MIT; posts, photos
and videos are not (see `LICENSE`). Visitors only ever get pre-built static files: **they never touch the API or the
database**, so the site stays up even if the API is down.

```
Visitor ─► Caddy ─► static HTML (precompressed br/gzip) from site/current (atomic symlink)
              ├─ /media/*  uploaded images/videos (immutable cache, Range)
              ├─ /admin/*  React SPA
              └─ /api/*    .NET API (/api/internal blocked from outside)
Admin ─► API ─► SQLite ; publish ─► durable rebuild request ─► builder ─► astro build ─► releases/<ts> ─► swap current
```

| Path | What | Stack |
|---|---|---|
| `apps/api` | Clean Architecture: `Blog.Domain` / `Blog.Application` / `Blog.Infrastructure` / `Blog.Api`, xUnit tests in `tests/Blog.Tests` | .NET 11, EF Core + SQLite, NetVips, ffmpeg |
| `apps/web` | Public site, 100% static, reads the API at build time; logic in `src/lib/*.ts` | Astro 7 |
| `apps/admin` | Admin SPA under `/admin/`; native Markdown editor | React 19 + Vite |
| `apps/builder` | Dependency-free Node service: runs `astro build`, precompresses, swaps `current` | Node ≥ 22.18 |
| `packages/markdown` | Own Markdown renderer (no deps, no raw HTML); used by site and admin preview | TypeScript |
| `packages/tokens` | Design tokens (`tokens.css`, the single source) and `.prose` styles | CSS |
| `infra` | `docker-compose.yml` (VPS), `compose.dokploy.yml` (behind Dokploy's Traefik: production + staging), `compose.local.yml` + `local.env` (local prod copy), `compose.dev.yml`, `caddy/Caddyfile`, `backup.sh` / `restore.sh`, guard tests in `test/` | Docker, Caddy 2, Dokploy |
| `.github` | project `README.md`, `workflows/ci.yml` (CI), `workflows/profile.yml` (profile images), `dependabot.yml` | GitHub Actions |
| `tooling` | `dev-watch.ts` (polling watcher), `agents/` (skill sync + check), `profile/` (profile README SVG generator) | Node |
| `docs/design` | `DESIGN-SYSTEM.md` (tokens live only in `packages/tokens`) | — |

## Run, test, build

Requirements without Docker: Node ≥ 22.18 (tests run `.ts` directly), pnpm 10, .NET SDK 11, and for hero videos
`ffmpeg`/`ffprobe` with `libsvtav1` and `libx264` on the PATH (or `Video:FfmpegPath` / `Video:FfprobePath`).

```bash
pnpm install                      # commit pnpm-lock.yaml; Docker builds use --frozen-lockfile
pnpm test                         # every workspace (markdown, web, admin, builder) + test:profile/agents/infra
pnpm typecheck                    # tsc / astro check
pnpm agents:check                 # skill copies in sync
cd apps/api && dotnet build -warnaserror && dotnet test   # --filter "Category!=Ffmpeg" skips the real-ffmpeg tests
cd apps/api && dotnet run --project src/Blog.Api   # API on :5090
pnpm dev:admin                    # http://localhost:5173/admin/ (proxies /api and /media to :5090)
pnpm --filter @blog/web dev       # http://localhost:4321/ (astro dev; needs API_URL + BUILDER_TOKEN)
pnpm build:web && pnpm build:admin
node tooling/agents/sync.ts       # regenerate skill copies after editing .agents/skills (--check verifies)
```

Docker (only Docker installed), from the repo root / from `infra/`:

```bash
docker compose -f infra/compose.dev.yml --env-file infra/local.env up --build            # dev, live reload
docker compose -f docker-compose.yml -f compose.local.yml --env-file local.env up -d --build   # local prod copy, :8080
```

`--env-file` goes on every command of those projects (`up`, `logs`, `down`). Details: skill `docker-and-deploy`.

Deploy: Dokploy on srv2192513 runs `docker-compose.yml` + `compose.dokploy.yml` (Caddy on :80 inside
`dokploy-network`, Traefik does TLS), one Compose service per environment: push to `master` → staging
(`staging.alanshalem.com`, basic auth in Traefik, `SITE_ENV=staging` = noindex), git tag → production
(`alanshalem.com`). Runbook: `docs/README.md` "Operations". Never deploy, tag or push without the user.
VPS operations step by step (every system on the VPS, a check per phase): `docs/vps-guide.md`.

**How to verify = CI.** `.github/workflows/ci.yml` runs on every push and PR to `master` (read-only, actions pinned by
SHA): jobs `node` (install, typecheck, `pnpm test`, admin build, `agents:check`), `dotnet` (`-warnaserror` build + all
tests inside the `dev` target of `apps/api/Dockerfile`, real ffmpeg), `infra` (`docker compose config -q` for the three
stacks, `caddy validate`), `images` (build the three production images, Trivy) and `security` (gitleaks over the full
history, `pnpm audit --prod`, vulnerable NuGet packages). The same commands to run locally are in `docs/README.md`
"How to verify"; the VPS runbook (deploy, update, rollback, backups, monitoring) is its "Operations" section.

## Non-negotiable rules

**Security**
- Never read, print or commit secrets: `.env`, `infra/.env.example` values, user-secrets, tokens, password hashes of
  real deployments. `infra/local.env` holds throwaway local-only values bound to 127.0.0.1; never reuse them on the VPS.
- Markdown never accepts raw HTML: everything is escaped (`escapeHtml`) and URLs pass `sanitizeUrl`
  (`http`, `https`, `mailto`, `tel`, relative). `set:html` / `dangerouslySetInnerHTML` only receive renderer output
  or strings built by escaping helpers.
- Admin routes: session cookie `__Host-admin` + `X-Requested-With: blog-admin` on every mutation. `/api/internal`
  needs the builder Bearer token and Caddy answers 404 for it from outside. Behind Dokploy, Caddy answers 403 to any
  request without Traefik's `X-Proxy-Secret` (`PROXY_SECRET`, never in git): the shared `dokploy-network` is no trust
  boundary.
- Uploads are verified by magic bytes (SVG rejected on purpose); originals of videos never reach `/media`.

**Bilingual (es default, en)**
- Post content: one version per language, translated **by hand only** (no machine translation anywhere).
- Customizable texts have a Spanish field plus an `En` field that falls back to Spanish (`tagline`/`taglineEn`,
  `bio`/`bioEn`, hero `alt`/`altEn`) — **except proper names**: the site/author `name` and the hero photo `credit` are
  one single field for both languages.
- Fixed UI strings live in dictionaries with identical keys per language, enforced by parity tests (site
  `apps/web/src/lib/i18n.ts`, admin `apps/admin/src/i18n/`, API `MessageCatalog`). The API answers in the language of
  the first `Accept-Language` preference (the admin sends its UI language). Skill `bilingual-i18n`.

**Accessibility and robustness**
- Target WCAG 2.2 AA in site and admin: contrast measured (tests guard the tokens), visible focus, keyboard reachable
  everything, DOM order = visual order, accessible name starts with the visible text, pause control for motion,
  `prefers-reduced-motion` and Save-Data respected. Skill `accessibility-wcag`.
- Never show broken media: a missing image/video hides its container and leaves the dark background
  ("prefer a black background over anything broken"). A failed build never touches the published site.
- Body headings are standard: `##` = h2, `###` = h3 (a body `#` also renders as h2; the post title is the only h1).

**Engineering**
- Tests first for behavior changes: write the failing test (RED), make it pass (GREEN), keep previous behavior pinned.
  Skill `testing-tdd`.
- Principles as applied here: **one source of truth** per fact (languages, limits, URLs, tokens, actions, messages)
  with a test when two languages must agree (C# ↔ TS); **KISS/YAGNI** — two fixed languages, no generic i18n library,
  no speculative fields; **Clean Architecture** — domain has no framework, ports in Application, adapters in
  Infrastructure, endpoints only map; pure modules + thin render/hook layers in the front ends (CUPID: composable,
  predictable, domain-named); **GRASP** — the expert owns the rule (the domain validates, Caddy decides caching).
- English is the repository standard: code, identifiers, comments, tests (names and test-only strings), docs, skills,
  logs, exceptions, script and CLI output, and commit messages. Spanish only where readers or the admin see Spanish:
  the `es` dictionaries, the Spanish entries of the message catalog, Spanish routes and slugs (`/es/articulos`,
  `/es/temas`), and Spanish fixtures that assert Spanish output. Spanish UI copy is Rioplatense with voseo
  ("Guardá", "Entrá").
- Windows is a dev platform: dev servers use polling (`tooling/dev-watch.ts`) and `strictPort`; builder symlink tests
  may fail with EPERM there.

## Where new code goes (short version; skill `blog-architecture` has the full table)

- Rule or limit → API domain (`Blog.Domain`), mirrored limits in `apps/admin/src/limits.ts` (test reads the C#).
- Use case → `Blog.Application/<Area>/<Area>Service.cs`; adapter → `Blog.Infrastructure`; route → `Blog.Api/Endpoints`.
- Site logic → pure `apps/web/src/lib/*.ts`; `.astro` files only render.
- Admin: HTTP only in `src/api/client.ts`; rules in pure `.ts` modules; state in `use*.ts` hooks; UI in `.tsx`.
- Markdown syntax → `packages/markdown` (site and preview share `POST_BODY_RENDER_OPTIONS`).
- Colors/fonts/spacing → `packages/tokens/src/tokens.css`. Caching/headers → `infra/caddy/Caddyfile`.

## Before you finish

- [ ] Failing test first, now green; focused suite, then `pnpm test` / `pnpm typecheck` / `dotnet test` as touched; the
      CI jobs you touched reproduced locally (README "How to verify").
- [ ] Both languages covered (dictionary keys, `En` fields, routes); accessible names and keyboard path checked.
- [ ] Infra changes run for real (Caddy validated, compose brought up), not only text-tested.
- [ ] Docs that describe the change updated in the same commit (README, `DESIGN-SYSTEM.md`, skills + `node
      tooling/agents/sync.ts`).
- [ ] `git status` shows only intended files: no scratch dirs, caches, databases or secrets.

## Commits and review

- Conventional Commits in English: `type(scope): summary` — scopes used: `api`, `web`, `admin`, `markdown`, `infra`,
  `dev`, `a11y`, `i18n`, `ux`. Body bullets say what changed and why.
- One task = one commit, small enough for native review (< ~2000 lines); risky work (schema/migrations, background
  jobs, infra/security) goes alone. Any split for review must compile and pass on its own.
- Never commit, push or publish without the user's decision. Skill `commit-and-review`.

## Skills index (`.agents/skills/<name>/SKILL.md`)

| Skill | Load when… |
|---|---|
| `blog-architecture` | you need the map: where code lives, data flow, contracts between apps, single sources of truth |
| `dotnet-api-conventions` | touching `apps/api`: entities, use cases, endpoints, errors/messages, EF Core migrations |
| `astro-site-conventions` | touching `apps/web`: pages, `src/lib` modules, build-time API reads, inline scripts |
| `react-admin-conventions` | touching `apps/admin`: api client, hooks, components, editor action registry, limits |
| `markdown-renderer` | touching `packages/markdown` or how post bodies render in site and preview |
| `bilingual-i18n` | adding any user-visible text, a customizable field, a route, or anything language-dependent |
| `accessibility-wcag` | building or reviewing any UI in site or admin |
| `design-system` | styling: tokens, typography, colors, overlays, components |
| `media-pipeline` | images or videos: upload, processing, storage, serving, rendering |
| `testing-tdd` | writing or running tests in any part of the repo |
| `docker-and-deploy` | Docker, compose, Caddy, the builder, VPS deploy, local dev environment |
| `commit-and-review` | preparing commits, splitting work for review, handling review findings |
