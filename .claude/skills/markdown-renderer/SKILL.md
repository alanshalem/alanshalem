---
name: markdown-renderer
description: "Rules of the dependency-free Markdown renderer in packages/markdown shared by the Astro site and the admin preview, covering no raw HTML ever, the URL allowlist, opt-in options that keep existing output stable, POST_BODY_RENDER_OPTIONS so the preview equals the published page, and the footnote, callout, figure and smart typography extensions. Use when changing Markdown syntax or output, rendering a post body or short text, or adding editor features that depend on Markdown structure."
---

# Markdown renderer (`packages/markdown`)

## Contract

- Zero runtime dependencies. Public API in `src/index.ts`: `renderMarkdown`, `blockStartLines`,
  `POST_BODY_RENDER_OPTIONS`, `excerpt`, `readingTimeMinutes`, `readingTimeOfText`, `wordCount`, `toPlainText`,
  `slugify`, `escapeHtml`, `unescapeHtml`, `sanitizeUrl`, types `Heading`, `Lang`, `MathRenderer`, `RenderOptions`,
  `RenderResult`.
  `test/escape.test.ts` pins that exact list: adding or removing an export is a deliberate change to that test.
- `unescapeHtml` is the exact inverse of `escapeHtml` (one table in `src/escape.ts`, decoded in one pass): plain text
  uses it, and any site or admin code that needs the text back imports it instead of keeping its own copy.
- `createSlugger` stays internal (`src/slug.ts`): only the renderer needs per-document unique ids.
- `renderMarkdown(source, options)` returns `{ html, headings, blockStarts, anchorLines, text }` from **one pass**:
  `headings` feed the article TOC (ids are the anchors); `blockStarts` is the line (from 0) where each top-level block
  starts (one per top-level HTML element; the footnotes section is not a block); `anchorLines` is the split view's
  finer scroll anchors, in document order: each top-level block's line and each list item's at any depth (also inside
  quotes and callouts), so one per top-level element plus one per `<li>` outside the footnotes section (nondecreasing:
  a list and its first item share a line; containers pass `lineBase` so nested lines are document lines); `text` is
  the plain text of that `html` (what is read, whitespace normalized). New result fields are additive: existing ones never change shape.
- The same function renders the published page (Astro build) and the admin preview: **the preview is the page**.

## Security (non-negotiable)

- No raw HTML: all user text goes through `escapeHtml` (`src/escape.ts`); `<script>` is shown as text.
  Test: `html('<script>alert(1)</script>')` → `<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>`.
- Links and images pass `sanitizeUrl` (`src/url.ts`): only `http`, `https`, `mailto`, `tel` and relative URLs;
  control characters and spaced-out schemes (`java script:`) are rejected. External links get
  `rel="noopener noreferrer"` (`isExternalUrl`).
- Do not add an "allow HTML" option. If a feature seems to need HTML, add Markdown syntax that renders it.
- The one injected HTML is the `math` option's output (a `MathRenderer`): the renderer passes it the raw TeX and puts
  its result in the page as is, so that function owns its safety. The only one wired in is `renderTex` of
  `@blog/math` (Temml with `trust: false`; see that package for its security tests).

## Options are opt-in

`RenderOptions` (`src/types.ts`): `headingOffset`, `minHeadingLevel`, `lang` (`'es'` default), `smartTypography`,
`figures`, `math`. New behavior that changes existing output is an option that defaults to off, so old content renders the
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
- Math (only with the `math` option, a `(tex, display) => html` function; undefined = `$` is plain text): inline
  `$...$` with pandoc's rule — the opening `$` is not followed by whitespace, the first `$` after it closes only if it
  is not preceded by whitespace nor followed by a digit, so `cuesta $5 y $10` stays text; `\$` is a literal dollar
  (inside math too); a `$$` run inside a paragraph is text. Never inside code spans, code blocks, link destinations,
  autolinks or bare URLs. Display math: a `$$` line, the TeX and a closing `$$` line (no blank line in between; it
  interrupts a paragraph), a one-line `$$ tex $$`, or a ```` ```math ```` fence; it is a top-level block (counts in
  `blockStarts`) wrapped in `<div class="math-display" tabindex="0">`. Formulas leave `<$n>` slots while rendering
  (`src/math.ts`; user text cannot forge one, every `<` is escaped) filled at the end: the injected HTML for `html`,
  the TeX source for `text`. Plain paths never see a slot: heading ids, `headings[].text` (the TOC) and image `alt`
  come from `plainInline(source, math)`, which finds formulas with the same rule (`findMath`) and carries each one's
  TeX verbatim, without `$` and without mark stripping inside it (without the option, `$` stays text as always).
  Smart typography and emphasis never look inside a formula. A line may break around an
  inline `<math>` (an atomic inline), even right after `(`: the text written against a formula (up to a space or a
  tag) goes with it in `<span class="math-nowrap">`, so `($x$),` never wraps apart. That pass runs only when there
  are formulas and looks only around each slot (linear: a 50 KB token without spaces renders in ms; a global regex
  with unbounded runs on both sides took 1.5 s).
- Smart typography by language: quotes, dashes, ellipsis — never inside code, URLs or attributes. What counts as a
  word character is one predicate, `isWordChar` (`src/typography.ts`), shared by smart quotes and the `_` emphasis
  rule in `src/inline.ts`.

## Accessible output

- `<pre tabindex="0">` (scrollable code is keyboard reachable, WCAG 2.1.1); display math likewise in
  `<div class="math-display" tabindex="0">`.
- Tables wrapped in `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabla|Table">`.
- Heading ids are unique per document (the internal `createSlugger`).

## Structure helpers

- A consumer that already rendered reads the result instead of re-parsing: the admin's single preview render feeds
  the preview, the counter (`text`), the outline (`headings` + `blockStarts`) and the scroll sync (`anchorLines`,
  falling back to `blockStarts` and then proportional when the measured element counts differ).
- `blockStartLines(source)` = `renderMarkdown(source).blockStarts` (only `math` moves block boundaries: it adds
  display math blocks; the admin reads its preview render's `blockStarts`, which has them) and
  `toPlainText(source)` = `renderMarkdown(source).text`; use them only when there is no render result at hand.
- `wordCount(plainText)` and `readingTimeOfText(plainText, wpm = 200)` (minimum 1) apply the site's formula to a text
  already computed; `readingTimeMinutes(markdown)` = `readingTimeOfText(toPlainText(markdown))`.
- `text` follows the render options (smart typography, figure captions, callout labels in `lang`), so it is what the
  page shows; `toPlainText`/`excerpt`/`readingTimeMinutes` render without options.
- Block regexes such as `FENCE_OPEN` live in `src/blocks.ts`; keep them there.

## Tests

`packages/markdown/test/*.test.ts` (node --test): `render.test.ts`, `blocks.test.ts`, `extensions.test.ts`,
`accessibility.test.ts`, `math.test.ts`, `escape.test.ts` (the public API list, `escapeHtml`/`unescapeHtml` round trip). For each change: a RED test for the new syntax, plus a test proving Markdown that does not
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
- Five Markdown passes per editor update (preview, two plain-text, two `blockStartLines`; ~58 ms on a 100 KB post):
  replaced by the one render's `blockStarts` and `text` (~17 ms).
