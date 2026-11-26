---
name: markdown-renderer
description: "Rules of the dependency-free Markdown renderer in packages/markdown shared by the Astro site and the admin preview, covering no raw HTML ever, the URL allowlist, opt-in options that keep existing output stable, POST_BODY_RENDER_OPTIONS so the preview equals the published page, and the footnote, callout, figure and smart typography extensions. Use when changing Markdown syntax or output, rendering a post body or short text, or adding editor features that depend on Markdown structure."
---

# Markdown renderer (`packages/markdown`)

## Contract

- Zero runtime dependencies. Public API in `src/index.ts`: `renderMarkdown`, `blockStartLines`,
  `POST_BODY_RENDER_OPTIONS`, `excerpt`, `readingTimeMinutes`, `toPlainText`, `createSlugger`, `slugify`,
  `escapeHtml`, `sanitizeUrl`, types `Heading`, `Lang`, `RenderOptions`, `RenderResult`.
- `renderMarkdown(source, options)` returns `{ html, headings }`; `headings` feed the article TOC (ids are the anchors).
- The same function renders the published page (Astro build) and the admin preview: **the preview is the page**.

## Security (non-negotiable)

- No raw HTML: all user text goes through `escapeHtml` (`src/escape.ts`); `<script>` is shown as text.
  Test: `html('<script>alert(1)</script>')` → `<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>`.
- Links and images pass `sanitizeUrl` (`src/url.ts`): only `http`, `https`, `mailto`, `tel` and relative URLs;
  control characters and spaced-out schemes (`java script:`) are rejected. External links get
  `rel="noopener noreferrer"` (`isExternalUrl`).
- Do not add an "allow HTML" option. If a feature seems to need HTML, add Markdown syntax that renders it.

## Options are opt-in

`RenderOptions` (`src/types.ts`): `headingOffset`, `minHeadingLevel`, `lang` (`'es'` default), `smartTypography`,
`figures`. New behavior that changes existing output is an option that defaults to off, so old content renders the
same; preservation tests pin that.

```ts
// Post body, site and admin alike:
renderMarkdown(body, { ...POST_BODY_RENDER_OPTIONS, lang: post.lang });
// Short text under another heading (home bio):
renderMarkdown(bio, { headingOffset: 2 });
```

`POST_BODY_RENDER_OPTIONS` = `minHeadingLevel: 2` (standard headings: `##` → h2, `###` → h3, body `#` → h2; the post
title is the page's only h1), `smartTypography: true`, `figures: true`.

## Extensions (GitHub-compatible syntax)

- Footnotes: `text[^1]` + `[^1]: note` → notes at the end with a link back.
- Callouts: `> [!NOTE]`, `> [!TIP]` (rendered "Puntos clave" / "Key takeaways"), `> [!WARNING]`. Labels per language
  live in one table in `src/labels.ts` (`CALLOUT_KINDS`, `labelsFor`).
- Figures: an image alone in its paragraph with a title, `![alt](url "caption")` → `<figure>` + `<figcaption>`.
- Smart typography by language: quotes, dashes, ellipsis — never inside code, URLs or attributes.

## Accessible output

- `<pre tabindex="0">` (scrollable code is keyboard reachable, WCAG 2.1.1).
- Tables wrapped in `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabla|Table">`.
- Heading ids are unique per document (`createSlugger`).

## Structure helpers

- `blockStartLines(source)` exposes the renderer's own block boundaries (used by the admin scroll sync). Any consumer
  that needs block structure calls it instead of re-parsing.
- Block regexes such as `FENCE_OPEN` live in `src/blocks.ts`; keep them there.

## Tests

`packages/markdown/test/*.test.ts` (node --test): `render.test.ts`, `blocks.test.ts`, `extensions.test.ts`,
`accessibility.test.ts`. For each change: a RED test for the new syntax, plus a test proving Markdown that does not
use it renders exactly as before.

## Checklist

- [ ] No path lets user text into HTML unescaped; new URLs go through `sanitizeUrl`.
- [ ] New output-changing behavior is an option (default off) or part of `POST_BODY_RENDER_OPTIONS` on purpose.
- [ ] Texts the renderer adds are in `labels.ts` for es and en.
- [ ] Admin preview and site both pick the change up (they share the preset).
- [ ] `pnpm --filter @blog/markdown test` and `typecheck` pass.

## Anti-patterns seen here

- A pasted `#II.` (no space) is a paragraph, not a heading; the post linter flags it rather than the renderer guessing.
- Copying renderer regexes into the admin (drifted; replaced by `blockStartLines`, `ad9b10d`).
- Three renders per keystroke in the editor (advisory in editor-pro L9): reuse the main render result when possible.
