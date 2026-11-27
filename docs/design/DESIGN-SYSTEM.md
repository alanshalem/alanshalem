# Design system — extracted from federicocarrone.com

Measured on 2026-11-24 on the home page, at 5 viewports (390 · 768 · 1024 · 1440 · 1920). The values come from `main.css` (`:root`) and from the computed styles of the DOM, not from visual estimates.

Files:
- The tokens have a single source, the one the site, the admin and the profile images use:
  `packages/tokens/src/tokens.css` (CSS custom properties + `@font-face` + typographic base). The values below are the
  reference measurement; where the blog changed them (contrast, overlays), `packages/tokens` wins.
- `reference/` — full-page screenshot per viewport (`*-fullpage.png`); not versioned (`.gitignore`).

---

## 1. Character of the design

Editorial, sober, dark. Three ideas hold up everything else:

1. **Three type voices with fixed roles**: Gloock (display) for content titles, Pagella (reading serif) for text and for the hero H1, Hanken Grotesk (UI) for everything "interface" (nav, labels, meta, footer).
2. **Almost no decoration**: radius `0`, no shadows, no gradients except the image overlay. Hierarchy comes from size, typeface, text color and 1px rules.
3. **Three text levels** on a near-black background: primary `#ededea`, secondary `#c8c8c2`, tertiary `#8e8e88`.

## 2. Color

| Semantic token | Value | Use |
|---|---|---|
| `bg-page` | `#0a0a0b` | Page background (matches `theme-color`) |
| `bg-surface` | `#141416` | Tiles, panels, graph map |
| `bg-surface-alt` | `#1b1b1e` | Alternative surface |
| `bg-code` | `#131316` | Code blocks |
| `text-primary` | `#ededea` | Titles and body |
| `text-secondary` | `#c8c8c2` | Deks / standfirsts |
| `text-tertiary` | `#8e8e88` | Labels, meta, credits, footer |
| `border-subtle` | `#2a2a2d` | Section rules, lists, footer |
| `link-accent` | `#9db2ff` | Links inside articles |
| `link-underline-hover` | `#c4d0ff` | Underline on hover/focus |
| dataviz | `#a9c98a` `#8fa7d9` `#e08f6a` | Nodes of the ideas graph |

Image overlay (hero and tiles): vertical gradient from `rgba(10,10,11,.55)` at the top → transparent at 22% → `.1` at 45% → `.94` at the bottom, so text reads over any photo.

**In this blog (updated).** Over light photos that gradient left text at 1–3:1, so it was replaced by bands measured in `rem` from each edge (what they cover has a fixed height) and a veil that follows the text. The values live in `packages/tokens/src/tokens.css` and are checked by `apps/web/test/contrast.test.ts`:

| Token | Value | Where |
|---|---|---|
| `overlay-hero` | top `.72` → `.62` at 4.5rem → 0 at 12rem; bottom `.94` → `.7` at 12rem → 0 at 20rem | Home hero and article cover: header band (brand, menu, ES \| EN) and bottom band (credit, Play/Pause) |
| `overlay-hero-text` | 0 → `.7` over `overlay-hero-text-fade` (8rem) | Veil behind the text block of the hero, the cover and the topic tiles: it follows the text (a 4-line title is covered too) |
| `overlay-tile` | the original gradient above | Topic tiles, under the veil |

With a white photo behind, `text-primary` reaches 4.5:1 from `.62` and `text-secondary` from ~`.70`; that is why credit, date and meta over images use `text-secondary`, never `text-tertiary`. No text shadows: the veil provides the contrast. Measured in Chrome: hero and article ≥ 5.19:1 across 63 elements; topic tiles ≥ 9.1:1 (1.7:1 before, with a 3-line topic name).

**Accent on the white sheet.** Inside `.paper`, `link-accent` and `link-underline-hover` become `periwinkle-700` (`#3b5bdb`, 5.7:1 on white) for focus and the hover underline: the light accents of the dark theme were at 2.1:1 and 1.5:1 (WCAG 1.4.11).

## 3. Typography

| Role | Family | Weight | Size | Line height |
|---|---|---|---|---|
| Hero H1 | Pagella | 400 | `clamp(2.4rem, 5.6vw, 4.6rem)` | 1.02 |
| Hero dek | Pagella | 400 | `clamp(1.05rem, 1.35vw, 1.25rem)` | 1.45–1.55 |
| Featured note title | Gloock | 400 | `clamp(2rem, 3.6vw, 3rem)` | 1.05 |
| Card title | Gloock | 400 | 1.6rem (25.6px) | 1.12 |
| Tile / series title | Gloock | 400 | 1.8rem (28.8px) | 1.08 |
| Numbered list title | Gloock | 400 | 1.4rem (22.4px) | 1.2 |
| Brand (header / footer) | Gloock | 400 | 1.5rem / 1.75rem | — |
| Body | Pagella | 400 | 1.1875rem (19px) | 1.55 |
| Card dek | Pagella | 400 | 1rem | 1.5 |
| Featured note dek | Pagella | 400 | 1.15rem | 1.5 |
| Nav / entry links | Hanken Grotesk | 500 / 400 | 0.95rem | 1.55 |
| Label (eyebrow, section h2) | Hanken Grotesk | 600 | 0.75rem, UPPERCASE, tracking .12em | 1.55 |
| Meta (date · reading time) | Hanken Grotesk | 400 | 0.8125rem | 1.55 |
| Photo credit | Hanken Grotesk | 400 | 0.75rem | 1.5 |
| Footer | Hanken Grotesk | 400 | 0.9rem | 1.55 |

A note on the fonts: the site self-hosts them (`/fonts/*.woff2`, latin subset, `font-display: swap`). Gloock and Hanken Grotesk are OFL (on Google Fonts / Fontsource). "Pagella" is probably TeX Gyre Pagella (a Palatino clone, free GUST license) but **I could not verify it**; confirm it before using it, or use Palatino/TeX Gyre Pagella directly.

## 4. Spacing and layout

A rem scale, with the values that actually appear: `0.25 · 0.5 · 0.7 · 0.9 · 1 · 1.1 · 1.25 · 1.5 · 1.75 · 2 · 2.5 · 2.75 · 3 · 3.5 · 5 · 7`.

- **Side gutter**: `clamp(1rem, 3.75vw, 3rem)` → 16px on mobile, 48px from ~1280px.
- **Sections**: `padding-top: 5rem`, a `1.75rem` gap between the section header (label + link on the right + 1px rule) and the content.
- **Hero**: fills the viewport (`min-height: 100vh`), content at the bottom, `padding: 7rem gutter 3.5rem`, text with `max-width: 58rem`, full-screen `object-fit: cover` image with the overlay.
- **Content width**: fluid, **no max-width** on the home page (at 1920 the content is 1824px wide). Reading pages use a `35em` column (~665px).
- **Corners**: `0`. **Shadows**: none. **Borders**: 1px `#2a2a2d`.

### Behavior per viewport (observed)

| Element | 390 | 768 | 1024 | 1440 | 1920 |
|---|---|---|---|---|---|
| Gutter | 16 | 28.8 | 38.4 | 48 | 48 |
| Hero H1 | 38.4px | 43px | 57.3px | 73.6px | 73.6px |
| Nav | ☰ button | ☰ button | visible links | links | links |
| "Start here" | 1 col | 1 col | 1 col | 2 col | 3 col |
| Featured note | 1 col | 1 col | 2 col (1.5fr / 1fr) | 2 col | 2 col |
| Cards | 1 col | 2 col (the 3rd wraps) | 2 col (the 3rd wraps) | 3 in a row | 3 in a row |
| Explore (graph + 3 panels) | 1 col | 1 col | 2 col (1.5fr / 1fr) | 2 col | 2 col |
| "Try an idea" (panels) | 1 col | 2 col (the 3rd wraps) | 3 col | 3 col | 3 col |
| Series (tiles) | 1 col | 2×2 | 3 + 1 | 4 in a row | 4 in a row |
| Library (posters) | 8 in a row (≈32px each) | 8 in a row | 8 in a row | 8 in a row | 8 in a row |
| Footer | 2 col | 2 col | 4 col (2fr 1fr 1fr 1fr) | 4 col | 4 col |

CSS rules found that explain it: `cards` = `auto-fill minmax(18rem,1fr)` from `75em` and 2 columns below; `tiles` = `auto-fill minmax(16rem,1fr)`, gap 1.25rem; `start-list` = `auto-fill minmax(min(100%,22rem),1fr)` with gap `0 2.5rem`. At 1024 and in the numbered list there are media-query overrides whose exact value I did not fully isolate: the numbers in the table are what was **observed**, not necessarily the rule.

## 5. Components

**Header / nav.** Flex row, `padding: 1.5rem gutter`, transparent over the hero. Hanken links 15.2px weight 500, color `text-primary`, no underline. On the right, an `EN | ES` language selector separated by a vertical line; the active language in white, the other dimmed. Below ~900px the links are replaced by a square ☰ button with a `1px rgba(237,237,234,.4)` border.

*In this blog:* as in the reference, `ES | EN` goes at the end of the row: on desktop brand · links · `ES | EN`; on mobile brand · `ES | EN` · ☰, with the open panel below. The HTML follows that same order at both sizes, without `order` in the CSS, so Tab moves in reading order (WCAG 2.4.3): the menu has two places that come from the same list (the row of links before `ES | EN` and the panel after the ☰) and each size shows only one; the hidden one (`display: none`) is neither focusable nor announced by screen readers. The ☰ panel closes with Esc (focus returns to the button), with a click outside and when focus leaves it. The link of the current section is underlined: `aria-current="page"` on its page and `"true"` inside it (an article marks Articles). The RSS link is announced as "RSS: feed de artículos nuevos" (Spanish) / "RSS: feed of new articles" (English).

**Hero.** Full-screen photo + overlay. H1 in Pagella, a 2-paragraph dek (links with a thin underline), three entry links in Hanken 15.2px ("More about me", "Latest writing", "Simulations") and a photo credit aligned bottom right (12px, `text-tertiary`). On mobile the credit moves to the bottom left.

*In this blog:* the credit uses `text-secondary` (see §2). If the hero is a video there is a Play/Pause button (WCAG 2.2.2), square like the ☰ (1px translucent border, no radius, at least 44 × 44 px), below the credit: with animations on, the video starts on its own and the button says "❚❚ Pausar" / "❚❚ Pause"; with `prefers-reduced-motion: reduce` or Save-Data the poster shows and "▶ Reproducir" / "▶ Play". Both labels share the same cell, so the button does not change width when it toggles.

**Body headings.** Standard, like GitHub or Docs: `##` = h2 and `###` = h3; a `#` in the body also renders as h2 (the h1 is the article title). Applied by `POST_BODY_RENDER_OPTIONS` from `@blog/markdown`, the same in the site and in the admin preview.

**Section header.** Flex `space-between`, label on the left (label style), link or description on the right (Hanken 14px, `text-secondary`), 1px bottom rule `border-subtle`, `padding-bottom: .9rem`.

**Numbered list ("Start here").** Each item: number `01–04` in `text-tertiary`, title in Gloock 22.4px, dek in Pagella `text-tertiary`; `padding: 20px 0` and a 1px bottom rule.

**Featured note.** 16:9 image + body (eyebrow "SERIES · ONE PATH", large Gloock title, dek, meta, credit with a top rule). No hover beyond the link underline.

**Card.** 16:10 image, eyebrow, Gloock title 25.6px, Pagella dek 16px (truncated to ~3 lines with "…"), meta. Inner gap 11.2px. On hover/focus the title is **not** underlined (the site disables it explicitly).

**Panel (Explore / Try an idea).** `bg-surface` background, `padding: 1.25rem`, no border or radius. Gloock title + Pagella dek. The large graph panel uses the three dataviz colors on `bg-surface`; on hover the lines go up to opacity .22.

**Tile (series).** Full-bleed image, 6:5 aspect, gradient overlay, text at the bottom left: Gloock title 28.8px, Hanken subtitle 15.2px, meta 13px ("4 episodes · in progress").

**Poster strip.** 8 equal columns, gap .9rem, 2:3 aspect.

**Footer.** `border-top: 1px`, `padding: 2.5rem gutter 3rem`, page background. Brand column (Gloock 28px + tagline + a "Written with an LLM…" note) and 3 link columns under uppercase labels (Contact me · Companies · Browse).

**Links.** Inherit color; 1px underline with `underline-offset` ~.22em; on hover/focus the underline grows to 3px and turns `#c4d0ff`. Brand links turn white on hover. Links inside articles use the `#9db2ff` accent.

**Motion.** Almost none: short transitions (150ms) and `prefers-reduced-motion` respected.

## 6. What I could not verify

- I only measured the **home page**. Article, search, series, simulations and Explore (interactive graph) pages are not surveyed. The global CSS already has reading rules (progress bar, copy-code button, heading anchors) that are not documented here.
- **Correction:** in the first version I said the site is dark only. That is false for the reading pages (articles, episodes, About, series detail): there the body sits on a white "sheet". It is documented in section 8. The home page and the listings are dark.
- `:hover` states of cards/tiles: the CSS neutralizes them (no underline); I saw no visual change beyond that.
- The 1440 and 1920 screenshots are **rescaled** (the tool delivers them at ~96% and ~82% of native size), so they are slightly less sharp than the 390/768/1024 ones. The grids and sizes in this document come from the DOM, not from those images.
- The screenshots have ~1px seams between segments and the mouse cursor visible in some. On mobile the Earth photo sits behind the hero text exactly as the page renders.
- The 8 posters on mobile are ~32px wide: that is what the CSS computes; I did not verify whether it is intentional or an effect of lazy loading.

## 8. "Paper" theme of the reading pages (added after surveying the rest of the site)

Pages with `body.has-hero` + `.reading` (articles, series episodes, About, Explore/topics, study plan) combine **two surfaces**: a full-screen dark hero at the top, and below it a white sheet (`.paper`) with the text. At the end the dark background returns for "Read next" and the footer.

| Token | Value | Use |
|---|---|---|
| `paper-bg` | `#ffffff` | Background of the reading sheet |
| `paper-text` | `#2c2724` | Text |
| `paper-muted` | `#656565` | Body links, TOC, tags, labels |
| `paper-rule` | `#ece9e4` | Rules, borders of quotes/newsletter/inline code |
| `paper-border-ui` | `#d9d9d6` | Border of tags, chips and share buttons |
| `paper-code-bg` | `#f9f9f9` | Inline code and the BibTeX block |
| `code-block-bg` / `fg` | `#24292e` / `#e1e4e8` | Code blocks (GitHub-like dark theme) |

Measurements (at 1440px):
- Body: Pagella **17px / 27.2px**, **640px** column; sheet padding `72px 0 80px`.
- Article hero H1: **80px** (`clamp(2.5rem, 6vw, 5rem)`, line-height 1.02). The home page uses a smaller size (73.6px).
- Body H2: Pagella 25.6px / 28.2px, weight 400.
- Side TOC: a 224px column left of the text, Pagella 14px, active link in bold and text color. It disappears on mobile and becomes an inline index above the text.
- Block quote: 4px left border, `padding-left: 25.6px`. "Key takeaways" and "The problem / Why existing approaches fail": a box with a very light gray background and a left border.
- Inline code: mono 14px, `#f9f9f9` background, 1px border, 4px radius. Block: mono 12.8px / 19.2px, 2px radius, horizontal scroll.
- Article end (`.end-matter`, top rule + 32px): a "Cite this" block (12px uppercase label + text + BibTeX), a "Written with an LLM…" note (Hanken 14px), tags (1px border, no radius, 14px), "Ideas in this piece" chips (radius 999px, 13.6px), a "Share" bar (X · LinkedIn · Email · Copy link, 36px tall) and a newsletter box (padding 28px, Pagella title 22.4px, input + dark button).
- Series navigation: two "Previous episode / Next episode" boxes side by side on desktop, stacked on mobile.
- "Read next": back to the dark theme, 3 cards on desktop, 1 column on mobile.

## 9. How each screen is organized

The site has ~147 pages in English (plus a full copy under `/es/`) but only ~12 templates. All share header + footer; the hero and the body change.

| Template | Routes | Structure (top to bottom) |
|---|---|---|
| Home | `/` | Fullscreen photo hero → Start here → Latest (1 featured + 3 cards) → Explore (graph + 3 panels) → Try an idea → Series → From the library → footer |
| Article | `/articles/*`, `/about/`, `/talks/*`, `/explore/*`, `/data/*`, `/licenciatura-*` | Hero with photo + title + dek + meta + tags → "On the image" strip (description + credit) → white sheet with side TOC + text → end matter (cite, tags, ideas, share, newsletter) → Read next → footer |
| Series episode | `/series/<series>/<episode>/` | Same as article + series note, previous/next navigation and "From the series" |
| Article listing | `/articles/` | Title + dek → blocks per year (large dimmed year on the left, card grid on the right) → a text "Index" with lists per series |
| Series listing | `/series/` | Title + dek → grid of vertical tiles (4 per row on desktop, 2 on tablet, 1 on mobile) |
| Series detail | `/series/<series>/` | Hero + image strip → sheet with progress (dots, number of episodes, minutes, status) → intro → thesis summary in boxes → Reference → Episodes (number + thumbnail + title + date + dek) |
| Talks | `/talks/` | Title → grid of video thumbnails with title and event |
| Library | `/library/` | Title + dek → one row per category (Anime, Movies, Series, Games, Reading, Music) with title, buttons and a horizontal carousel of covers + a "+N" counter → 3 final cards (Podcasts, Sources, Quotes) |
| Catalog (anime, movies, games, music…) | `/anime/`, `/movies/`, … and `/*/backlog/` | Title + intro → "On this page" chips → sections with cover cards, score (IMDb / Metacritic), tags and a one-line opinion |
| Reading | `/reading/` | Narrow column, filters by topic, stacked books with a large cover |
| Explore | `/explore/` | Small hero → "Learn the foundations" (3 numbered paths) → ideas graph → Simulations (by family, with a list of simulations and an Open button) |
| Topics | `/keywords/`, `/keywords/<tag>/` | Cloud of chips with a counter; the detail lists the articles of that tag |
| Search | `/search/` | Title + input; results appear while typing |
| Quotes | `/quotes/` | Centered list of large quotes in Gloock with the author in uppercase |

Technical check relevant for the stack: the site is generated with **Zola** (visible from the `zola-anchor` class on headings) and is 100% static. Search runs in the browser (`/js/search.js`), the newsletter sends a `POST` to Buttondown, analytics are Umami and there are RSS and Atom feeds. In short: it has no backend of its own.

## 7. About reusing the content

This is the visual system (typography, color, spacing, structure). The texts, illustrations and posters belong to their author or to third parties (the posters are copyrighted material), so for your site use the system with your own content and photos. The Earthrise photo is in the public domain (NASA).
