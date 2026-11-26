---
name: accessibility-wcag
description: "WCAG 2.2 AA rules as already applied in this blog's Astro site and React admin, covering measured contrast over photos, visible focus, keyboard access to scrollable regions, DOM order equal to visual order, accessible names that start with the visible text, pause controls and reduced motion, page titles and focus on navigation, status messages and how to verify with axe, keyboard and tests. Use when building, changing or reviewing any UI, interaction, color, overlay, media control or text alternative in apps/web, apps/admin or the Markdown output."
---

# Accessibility (WCAG 2.2 AA)

Accessibility is built into pure, tested rules where possible (`apps/admin/test/a11y.test.ts`,
`apps/web/test/contrast.test.ts`, `site-css.test.ts`, `header.test.ts`, `packages/markdown/test/accessibility.test.ts`)
and then verified in a real browser.

## Rules with this repo's solutions

| Criterion | Rule here | Where |
|---|---|---|
| 1.4.3 Contrast | Text over photos sits on measured overlays (`overlay-hero` bands in rem, `overlay-hero-text` veil); credit, date and meta over images use `text-secondary`, never `text-tertiary`; no text shadows | `packages/tokens/src/tokens.css`, `apps/web/test/contrast.test.ts` |
| 1.4.11 Non-text contrast | Focus and hover underline inside `.paper` switch to `periwinkle-700` (5.7:1 on white); admin input borders ≥ 3:1 | `tokens.css`, `admin.css` |
| 2.1.1 Keyboard | Scrollable regions are focusable: `<pre tabindex="0">`, `.table-wrap` with `tabindex="0" role="region" aria-label` | `packages/markdown/src/blocks.ts` |
| 2.1.2 No trap | Tab leaves the editor textarea (Tab indents only inside lists; see `tabLeavesEditor`); toolbar uses roving focus with arrows | `apps/admin/src/editor/shortcuts.ts`, `roving.ts` |
| 2.2.2 Pause | Autoplaying hero video has a ❚❚ Pausar / ▶ Reproducir button (min 2.75rem square; the visible label is the name, icons `aria-hidden`; both labels share one grid cell so the width does not jump) | `apps/web/src/pages/[lang]/index.astro`, `lib/hero-rotation.ts`, `i18n.ts` `heroPlay`/`heroPause` |
| 2.3.3 / motion | `prefers-reduced-motion: reduce` or Save-Data → poster + Play (the inserted video starts only on click); transitions ≤ 150 ms | `lib/hero-rotation.ts`, admin `usePrefersReducedMotion.ts` |
| 2.4.1 Bypass | Skip link first; landmarks (`header`, `nav` with names, `main`, `footer`) | `BaseLayout.astro`, admin `App.tsx` |
| 2.4.2 Page titled | Admin title per view (`pageTitle.ts`) and focus moves to the page `h1` (`usePageHeading.ts`) | `apps/admin/src/navigation/` |
| 2.4.3 Focus order | DOM order = visual order; never CSS `order`. The site menu renders the same link list in two places and shows one per width | `apps/web/src/components/Header.astro` |
| 2.4.4 / 2.4.6 | Current section: `aria-current="page"` on its page, `"true"` inside it; RSS link named "RSS: feed de artículos nuevos" | `lib/i18n.ts` `navCurrent` |
| 2.4.11 Focus not obscured | The admin sticky header never covers a focused control (`scroll-padding-top` = header height) | `apps/admin/src/admin.css` |
| 2.5.3 Label in name | The accessible name starts with the visible text ("ES – Español", H2 button) | `apps/admin/test/a11y.test.ts` |
| 2.5.8 Target size | Menu (☰) and media buttons at least 2.75rem (44 px) square | `apps/web/src/styles/site.css` |
| 3.1.1 / 3.1.2 Language | `<html lang>` per page; post bodies rendered with their `lang` | layouts, renderer |
| 3.3.1 Errors | Invalid required field gets `aria-invalid` and focus; API errors shown in a `Banner` with `role="alert"` | `components/Banner.tsx` |
| 4.1.3 Status | Success messages use `role="status"` (announced without interrupting) | `Banner.tsx` |
| 1.1.1 Text alternatives | Hero items require `alt` (≤ 300, es + optional en); the generative SVG cover and decorative numbers are `aria-hidden` | API `HeroImageContent`, `lib/generative.ts` |

Also kept: one `h1` per page (post title; body `##` = h2), reflow at 320 px, text spacing, menu panel closes with
Esc (focus back to ☰), outside click and focus leaving.

## How to verify

1. Unit: put the rule in a pure function or a CSS guard test and test it (RED first).
2. Browser: axe with 0 violations at 390 px and 1440 px on site and admin pages you touched.
3. Keyboard only: reach and operate everything, visible focus, no traps, Tab order equals reading order.
4. Contrast over the worst case: a white photo behind hero/cover text (Chrome measured ≥ 4.5:1).
5. With "reduce motion" on (Windows: animations off) and off; with a broken media URL (must leave a black area).

## Checklist

- [ ] Visible text and accessible name agree (name starts with visible text); icons are `aria-hidden`.
- [ ] Every interactive element is keyboard reachable with visible focus; scrollable regions focusable.
- [ ] No CSS reordering; DOM order matches visual order at every width.
- [ ] Text on images uses the overlay tokens and `text-primary`/`text-secondary`.
- [ ] Motion respects `prefers-reduced-motion` and Save-Data, and has a pause control if it lasts.
- [ ] New strings for labels exist in both languages.

## Anti-patterns seen here

- Nav at 2.58:1 and h1 at 2.83:1 over a light photo with the original gradient (`odd/tasks/plataforma-calidad.md` L4 P1-1).
- `<pre>` and tables with scroll but unreachable by keyboard (P1-3).
- Accessible names that did not contain the visible text (ES/EN selector, H2/H3/1. buttons, P1-4).
- 40 Tab presses to reach the textarea; toolbar without arrow keys (P2-6, fixed to 8 in `0c6ae73`).
- A single "Admin" title for every view and focus left behind on navigation (P2-5).
- Autoplay video without a pause control (hero-galeria L15 → `a2a5727`).
