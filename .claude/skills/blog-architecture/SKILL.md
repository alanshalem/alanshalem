---
name: blog-architecture
description: "Map of this bilingual static blog monorepo (Astro site, React admin, .NET API, Node builder, Caddy) covering where each kind of code lives, how data flows from the admin to published HTML, the HTTP contracts between apps and the single sources of truth. Use when starting any task in this repo, deciding where new code belongs, tracing a bug across apps, or changing a contract between apps."
---

# Blog architecture

## The one idea

Visitors only get static files that Caddy serves from disk. They never reach the API, Node or SQLite. Everything
dynamic happens in the admin, and publishing regenerates the site. Keep it that way: a new public feature is
build-time data plus (at most) a tiny inline script, never a runtime call from the public site.

```
Admin (React, /admin/) ──HTTP──► API (.NET, /api/admin/*, cookie + CSRF header) ──► SQLite (data/blog.db)
                                     │  content change ─► ISiteBuildTrigger (durable flag in site_build_state)
                                     ▼
Builder (Node) ◄── POST /build (Bearer) ── retried by SiteRebuildWorker until accepted
   └─ astro build (reads /api/internal/* with Bearer) ─► precompress br/gzip ─► releases/<ts>/ ─► rename `current`
Caddy ─► /srv/site/current (HTML) · /srv/media (uploads) · /srv/admin (SPA) · /api/* → api:8080
```

- A failed build leaves `current` untouched (`apps/builder/src/build.ts`, `releases.ts`: symlink swap with `rename`).
- The site build fails loudly if the API fails (`apps/web/src/lib/api.ts` `getInternal`): better the old site than an
  empty one.
- Rebuild requests are durable (`apps/api/src/Blog.Infrastructure/Build/DurableSiteBuildTrigger.cs`): saving never
  fails because the builder is down; the worker retries at startup and every minute.

## Where things live

| You are adding… | Put it in |
|---|---|
| A business rule or validation limit | `apps/api/src/Blog.Domain` (entity or `*Content` record, `Max*` constants) |
| A use case | `apps/api/src/Blog.Application/<Area>/<Area>Service.cs` (+ DTOs in `<Area>Dtos.cs`) |
| A port (DB, disk, ffmpeg, clock) | interface in `Blog.Application/Abstractions/Ports.cs`, adapter in `Blog.Infrastructure`, registered in `DependencyInjection.cs` |
| An HTTP route | `Blog.Api/Endpoints/<Area>Endpoints.cs` (maps only its routes; the group in `Program.cs` adds auth) |
| A user-facing API message | `Blog.Domain/MessageKeys.cs` + `MessageCatalog.cs` (es + en) |
| Site logic (URLs, data shaping, HTML builders) | `apps/web/src/lib/<topic>.ts` (pure, tested) |
| Site markup | `apps/web/src/pages/**`, `components/*.astro`, `layouts/BaseLayout.astro` (render only) |
| Admin HTTP calls | `apps/admin/src/api/client.ts` (only HTTP), types in `api/types.ts` |
| Admin rules | pure `.ts` module next to its feature (`hero/heroSize.ts`, `posts/lint.ts`, `editor/commands.ts`) |
| Admin state/effects | `use*.ts` hook in the feature folder; UI in `*.tsx` components |
| Markdown syntax | `packages/markdown/src` (shared by site and admin preview) |
| Colors, fonts, spacing | `packages/tokens/src/tokens.css` (+ `prose.css` for post bodies) |
| Caching, headers, routing of public URLs | `infra/caddy/Caddyfile` |

## Contracts between apps

- JSON is camelCase; enums are camelCase strings (`JsonStringEnumConverter`).
- `/api/admin/*`: admin only (cookie `__Host-admin`, `X-Requested-With: blog-admin` on mutations). Errors are
  ProblemDetails with `title`, `detail` in the request language and a stable `code` (the message key).
- `/api/internal/*`: builder only (Bearer `Builder:Token`/`BUILDER_TOKEN`, ≥ 32 chars). Returns published posts,
  settings, media index and hero items for the build.
- DTO shapes are defined by the API (`Blog.Application/<Area>/<Area>Dtos.cs`) and mirrored by the admin
  (`api/types.ts`) and the site (`lib/*.ts` interfaces); media and video DTOs are summarized in skill `media-pipeline`.
  Changing a DTO means changing all three in the same task.

## Single sources of truth (do not duplicate)

| Fact | Owner | Mirrors guarded by |
|---|---|---|
| Languages `es` (default) / `en` | `Blog.Domain/Language.cs`, `apps/web/src/lib/i18n.ts`, `apps/admin/src/languages.ts` | one definition per app, nothing generic |
| Validation limits | C# domain constants | `apps/admin/src/limits.ts` + `apps/admin/test/limits.test.ts` (reads the C#) |
| Public URLs | `paths` in `apps/web/src/lib/i18n.ts` | pages never build URLs by hand |
| Site URL | Astro `site` (`apps/web/src/lib/site.ts`) | — |
| Markdown block boundaries | `renderMarkdown(...).blockStarts` (or `blockStartLines()`) from `@blog/markdown` | the admin scroll sync and outline read it from the single preview render (a copied regex drifted in 3 cases) |
| Body render options | `POST_BODY_RENDER_OPTIONS` (`packages/markdown/src/presets.ts`) | site and admin preview both spread it |
| Editor actions | `apps/admin/src/editor/actions.ts` | toolbar, palette, shortcuts and help read the same list |
| Design tokens | `packages/tokens/src/tokens.css` | `apps/web/test/contrast.test.ts`; the profile SVGs read the same file (`tooling/profile/src/theme.ts`) |
| Dev file watching | `tooling/dev-watch.ts` | used by both Vite configs |
| Agent skills | `.agents/skills/` | `node tooling/agents/sync.ts --check` |
| How a change is verified | `.github/workflows/ci.yml` (jobs node, dotnet, infra, images, security) | README "How to verify" lists the same commands |
| Base images and their versions | the Dockerfiles (pinned by digest) | CI reads Node and Caddy from them; `infra/test/compose.test.ts` |

## CI and dependency updates

`.github/workflows/ci.yml` runs on every push and pull request to `master`, read-only (`contents: read`), with every
action pinned by SHA: **node** (typecheck, `pnpm test`, admin build, `agents:check`), **dotnet** (`-warnaserror` build and
all tests in the API dev image, real ffmpeg), **infra** (`docker compose config -q` for the three stacks, `caddy validate`),
**images** (builds the three production images from the VPS compose and scans them with Trivy) and **security**
(gitleaks over the full history, `pnpm audit --prod`, vulnerable NuGet packages). `.github/workflows/profile.yml` only
refreshes the profile images. `.github/dependabot.yml` proposes npm, NuGet, Docker, compose and actions updates weekly.
A red CI is a failed task, not a flaky one: reproduce it locally with the README commands.

## Checklist

- [ ] New public behavior is computed at build time; no runtime fetch from the public site.
- [ ] New data reaches the site through an `/api/internal/*` endpoint read with `getInternal` + `oncePerBuild`.
- [ ] Content changes that affect public pages call `ISiteBuildTrigger.RequestBuildAsync`.
- [ ] Any fact you need already has an owner in the table above; reuse it instead of re-declaring it.
- [ ] DTO changes are applied in API, admin types and web lib types together.
- [ ] A new check, app or image is wired into CI (`ci.yml`) and the README "How to verify" in the same commit.

## Anti-patterns seen here

- Copying a constant or regex into another app "just for the UI" (limits, block regexes, `IMAGE_TYPES`): they drift.
- Endpoint modules registering routes of other areas (`PostEndpoints` once mapped foreign routes; fixed in `c299d78`).
- Caching API responses per process in `astro dev` (froze admin edits until restart; `oncePerBuild` fixed it, `b68768e`).
