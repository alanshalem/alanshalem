# Test map

Where each area is tested. Add to the existing file of the area before creating a new one.

## packages/markdown/test

| File | Covers |
|---|---|
| `render.test.ts` | inline/block rendering, escaping (no raw HTML), URL allowlist, headings and ids |
| `blocks.test.ts` | block boundaries (`blockStartLines`), fences, lists, tables |
| `extensions.test.ts` | footnotes, callouts, figures, smart typography per language, preservation of old output |
| `accessibility.test.ts` | focusable `<pre>`, table regions, heading levels |

## apps/web/test

| File | Covers |
|---|---|
| `api.test.ts` | `getInternal`, `oncePerBuild` (once per build, every render in dev) |
| `posts.test.ts`, `fixtures.ts` | API post → `BlogPost`, per-language lists, tags, alternates |
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
| `hero.test.ts`, `heroSize.test.ts`, `heroVideo.test.ts`, `videoEdit.test.ts` | hero gallery, size rule, video states, trim/fade |
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

## tooling/agents/test

`skill-spec.test.ts` (Agent Skills rules), `sync.test.ts` (copies, stale removal, `--check`, this repo in sync).
