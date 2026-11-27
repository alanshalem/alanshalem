---
name: astro-site-conventions
description: "Conventions of the public Astro 7 site in apps/web, which is fully static, reads the API only at build time, keeps logic in pure src/lib modules and leaves .astro files render-only, with localized routes, responsive images, inline scripts kept as constants and a media guard that never shows broken media. Use when adding or changing pages, components, layouts, src/lib modules, RSS/sitemap, the hero or any inline script of the public site."
---

# Astro site conventions (`apps/web`)

## Shape

- `output: 'static'`, `trailingSlash: 'always'`, `build.format: 'directory'`, `inlineStylesheets: 'always'`
  (`astro.config.mjs`). No server code in production; Caddy serves files.
- Routes are generated per language: `src/pages/[lang]/index.astro`, `[lang]/[posts]/[slug].astro`,
  `[lang]/[topics]/[tag].astro`, `[lang]/rss.xml.ts`, `[lang]/404.html.ts` (rewrites to `404.astro`, so the 404 is
  one page in one language: `notFoundLang`), plus `sitemap.xml.ts`, `404.astro` (Astro also writes it as a Spanish
  `/404.html` that Caddy never serves) and a root `index.astro` that redirects to `/es/` when no Caddy rule exists.
  `getStaticPaths` uses `LANGS` and `segments(lang)` from `src/lib/i18n.ts`.

## Logic in `src/lib`, markup in `.astro`

- Every decision (resolve the hero, pick the cover, localize settings, build `srcset`, shape API posts, feeds) is a
  pure, exported function in `src/lib/<topic>.ts` with a test in `test/<topic>.test.ts` (node --test).
- `.astro` files import those functions and render. If you are writing an `if` chain or string building in a page,
  move it to `src/lib`.
- Examples: `lib/hero.ts` (`resolveHero`, `localizeHeroImage`, `heroShareImage` for `og:image`), `lib/cover.ts`
  (effective cover = `coverUrl` → first Markdown image → generative SVG from `lib/generative.ts`), `lib/settings.ts`
  (`toSiteSettings` with fallbacks), `lib/posts.ts` (`toBlogPost`, `postsIn`, `postsByYear` for the archive,
  `readNextFor` for "Seguir leyendo" / "Keep reading", `homeSections` for what the home shows, `tagsOf`,
  `alternatesByGroup`).
- `toBlogPost` renders each body **once** (`renderMarkdown` with `POST_BODY_RENDER_OPTIONS` and the post's `lang`)
  and takes the HTML, the headings and the reading time from that result (`readingTimeOfText(text)`, the same formula
  as the admin preview). Do not render or strip the same body again for another field.

## Reading the API

```ts
const getApiSettings = oncePerBuild(() =>
  getInternal<ApiSettings>('/api/internal/settings', 'the site settings'),
);
```

- Only `getInternal` (Bearer `BUILDER_TOKEN`, base `API_URL`) from `lib/api.ts`. It throws on failure so the build
  fails and the builder keeps the previous release.
- Wrap each loader in `oncePerBuild`: one request per production build, fresh data on every render in `astro dev`.
- Validate what comes in: URLs through `sanitizeUrl`/http(s) checks, colors with `safeColor`, placeholders with
  `safePlaceholder` (`lib/media.ts`), emails with a minimal shape.

## URLs and languages

- Never write a URL by hand: `paths.home(lang)`, `paths.post(lang, slug)`, `paths.tag(lang, tag)`, `paths.rss(lang)`.
- `alternatesFor`, `switcherLinks` and `hreflangLinks` produce the ES | EN switcher and `<link rel="alternate">`.
- All visible text comes from `ui(lang)` in `lib/i18n.ts` (see skill `bilingual-i18n`).

## HTML safety

- `set:html` only receives output of `@blog/markdown`, `imageHtml` (`lib/responsive-image.ts`), the generative SVG,
  `jsonForScript` (`lib/html.ts`) or a script constant. Attributes are built with `htmlAttributes` (escapes values).
- Body HTML: `renderMarkdown(body, { ...POST_BODY_RENDER_OPTIONS, lang })`. Short texts under another heading (bio)
  use `{ headingOffset: 2 }`.

## Inline scripts

- Each inline script is an exported string constant in `src/lib` (`MEDIA_GUARD_SCRIPT` in `lib/media-guard.ts`,
  `HERO_ROTATION_SCRIPT` in `lib/hero-rotation.ts`), rendered with `<script is:inline set:html={...} />`. Constant
  content keeps its CSP hash stable: register every new inline script in `INLINE_SCRIPTS` (`lib/csp.ts`, hashed by
  `cspHash` into Astro `security.csp`); `test/csp.test.ts` fails if one is missing.
- Budget: the hero rotation script is capped at 800 bytes by a test; grow only when a feature needs it.
- Data for scripts goes in `<script type="application/json">` via `jsonForScript`, never interpolated into JS.

## Never break

- The media guard in `<head>` (`BaseLayout.astro`) hides the container (`[data-media]`, else `<picture>`, else the
  element) of any image or video that fails, leaving the dark page background. Mark new media containers with
  `data-media` (constant `MEDIA_CONTAINER_ATTRIBUTE`).
- Every optional input has a fallback chain ending in something that renders: hero gallery → `public/hero.jpg` →
  typographic hero; settings come only from the API (a blank name fails the build so the published site stays;
  only the tagline has a dictionary default).
- Images only through `ResponsiveImage.astro` / `imageHtml` (AVIF + WebP `<picture>` for uploaded assets, `<img>`
  otherwise). See skill `media-pipeline`.

## CSS

- Page styles in `src/styles/site.css` with flat rules (no nesting): `test/site-css.test.ts` and
  `test/contrast.test.ts` parse them. Use tokens (`var(--...)`) from `@blog/tokens`; see skill `design-system`.

## Dev server

- `astro dev` proxies `/media` to the API (`API_URL`, default `http://localhost:5090`) and uses
  `reliableDevWatch` (polling) from `tooling/dev-watch.ts`. It needs `API_URL` and `BUILDER_TOKEN`.

## Checklist

- [ ] New logic is a pure function in `src/lib` with a node --test test; the page only renders.
- [ ] API data via `getInternal` + `oncePerBuild`, validated before use.
- [ ] URLs from `paths`, texts from `ui(lang)`, both languages generated.
- [ ] Media containers carry `data-media`; there is a fallback that renders.
- [ ] Inline script is a constant, within its byte budget, data via `jsonForScript`.
- [ ] `pnpm --filter @blog/web test` and `pnpm --filter @blog/web typecheck` pass; `pnpm build:web` with the API up.

## Anti-patterns seen here

- Per-process cache of API data in dev (froze edits; `b68768e`).
- `astro dev` not serving `/media` → broken icon and a stretched placeholder (`c5198e6`).
- CSS `order` to move the ES | EN switcher: visual and Tab order diverged (fixed by DOM order, `54854cf`).
- Gray `text-tertiary` text over photos (contrast 1–3:1; fixed in `e598e73`).
