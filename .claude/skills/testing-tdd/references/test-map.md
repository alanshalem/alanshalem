# Test map

Where each area is tested. Add to the existing file of the area before creating a new one.

## packages/markdown/test

| File | Covers |
|---|---|
| `render.test.ts` | inline/block rendering, escaping (no raw HTML), URL allowlist, headings and ids |
| `blocks.test.ts` | block boundaries (`blockStartLines`), scroll anchors (`anchorLines`: blocks + every list item), fences, lists, tables |
| `math.test.ts` | the `math` option with a fake renderer: pandoc's `$` rule, display blocks, slots, plain paths (heading text, alt) carrying the TeX, the linear no-wrap pass, output without the option unchanged |
| `extensions.test.ts` | footnotes, callouts, figures, smart typography per language, preservation of old output |
| `accessibility.test.ts` | focusable `<pre>`, table regions, heading levels |
| `escape.test.ts` | the exact public API list (`createSlugger` internal), `unescapeHtml` as the inverse of `escapeHtml`, plain text decoding |

## packages/math/test

| File | Covers |
|---|---|
| `math.test.ts` | the public API, `renderTex` (Temml → MathML), security (`trust: false`, no `\href`/`\url`/`\html*`, invalid TeX → escaped `code.math-error`), `postBodyOptions` wiring shared by site and preview |

## apps/web/test

| File | Covers |
|---|---|
| `api.test.ts` | `getInternal`, `oncePerBuild` (once per build, every render in dev) |
| `posts.test.ts`, `fixtures.ts` | API post → `BlogPost` (one render, reading time from its text), per-language lists, archive by year, read next, home sections, tags, alternates |
| `i18n.test.ts` | languages, `paths`, switcher, hreflang, dictionary parity, dates |
| `settings.test.ts` | `toSiteSettings` fallbacks (En → es → env → dictionary) and URL/email validation |
| `hero.test.ts` | hero resolution, rotation script (≤ 800 bytes), video and play/pause behavior |
| `media.test.ts`, `responsive-image.test.ts` | media index, `srcset`, `<picture>` output |
| `media-guard.test.ts` | the broken-media guard script |
| `cover.test.ts`, `generative.test.ts` | effective cover chain, deterministic SVG |
| `feeds.test.ts` | RSS per language and its stylesheet |
| `header.test.ts`, `not-found.test.ts`, `site.test.ts` | header order/aria-current, 404 per language, site URL |
| `contrast.test.ts`, `site-css.test.ts` | WCAG contrast from tokens, CSS guards (no text-shadow, overlay colors) |
| `caddyfile.test.ts` | Caddy rules (`/api/internal` 404 inside `handle /api/*`, cache headers, root redirect, 404 pages) |

## apps/admin/test

| File | Covers |
|---|---|
| `client.test.ts` | multipart uploads (images, videos with trim/fade fields), `ApiError` from ProblemDetails |
| `i18n.test.ts` | dictionary parity, plurals, formatting |
| `a11y.test.ts` | accessible names, roving toolbar, Tab leaving the editor, page titles |
| `commands.test.ts`, `editor-*.test.ts` | editor commands, actions registry, HTML→Markdown paste, search, scroll sync |
| `lint.test.ts`, `seo.test.ts`, `autosave.test.ts`, `history.test.ts`, `schedule.test.ts`, `versions.test.ts` | post tools |
| `postForm.test.ts` | post ↔ editor form fields (`toPostForm`, `toPostInput`, `EMPTY_POST_FORM`) |
| `hero.test.ts`, `heroGrid.test.ts`, `heroSize.test.ts`, `heroVideo.test.ts`, `videoEdit.test.ts` | hero gallery, size rule, video states and warnings, trim/fade |
| `limits.test.ts` | admin limits equal the C# domain constants |
| `settings.test.ts`, `siteUrl.test.ts`, `unsaved.test.ts` | settings validation, "Ver sitio" URL, unsaved-changes guard |

## apps/builder/test

`builder.test.ts`: auth, queue/debounce, end-to-end build with a fake `pnpm`, atomic swap under concurrent reads.

## apps/api/tests/Blog.Tests

| File | Covers |
|---|---|
| `DomainTests.cs`, `*DomainTests.cs` | entities and content records per area |
| `PostServiceTests.cs`, `SiteSettingsServiceTests.cs`, `HeroImageServiceTests.cs`, `VideoServiceTests.cs`, `VideoProcessorTests.cs` | use cases with doubles |
| `PersistenceTests.cs`, `HistoryAndSchedulePersistenceTests.cs` | EF Core + SQLite, constraints, `Upgrading_from_<migration>_keeps_...` data-preservation tests |
| `MediaPipelineTests.cs`, `MediaAndSecurityTests.cs` | NetVips pipeline, magic-byte sniffing (SVG rejected), PBKDF2 password hashing |
| `FfmpegFilterGraphTests.cs`, `FfmpegVideoTranscoderTests.cs` (`Category=Ffmpeg`), `VideoProcessingTests.cs` | video |
| `SiteRebuildTests.cs` | durable rebuild flag and retries |
| `MessageCatalogTests.cs` | message keys and es/en catalog |
| `Http/*HttpTests.cs` (`ApiFactory`) | HTTP contract: wiring, auth, CSRF, `/media` traversal (`%2e%2e`), localized errors, history/schedule |

## infra/test

| File | Covers |
|---|---|
| `compose.test.ts` | compose services, hardening, healthchecks, capped logs, start order; Dockerfiles (digests, same Node, builder without package managers) |
| `caddy.test.ts` | production Caddyfile additions (ACME email option, COOP/CORP, admin noindex) |
| `ports.test.ts` | the API port across its Dockerfile, healthcheck command, Caddyfile and compose (production and dev); the builder port across its config, Dockerfile and the URL the API calls |
| `backup.test.ts` | `backup.sh` / `restore.sh` with a fake `docker` (skipped on Windows) |

## tooling/profile/test

`github.test.ts` (public API reads), `metrics.test.ts` (streaks, languages, rank), `rss.test.ts`, `readme.test.ts` (marked
section rewrite, latest posts), `profile.test.ts` (rendered SVGs), `theme.test.ts` (card colors equal `tokens.css`,
text contrast), `type.test.ts` (text to paths).

## tooling/agents/test

`skill-spec.test.ts` (Agent Skills rules), `sync.test.ts` (copies, stale removal, `--check`, this repo in sync).
