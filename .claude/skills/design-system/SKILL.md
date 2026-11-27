---
name: design-system
description: "The editorial dark design system shared by the blog site, the admin and the GitHub profile SVGs, with tokens in packages/tokens, three typefaces with fixed roles (Gloock, Pagella, Hanken Grotesk), three text levels on near-black, zero radius, no shadows, 1px rules, the white paper reading sheet and the measured photo overlays. Use when styling anything, choosing colors, type, spacing or overlays, adding a component, or making images and SVGs that must look like the site."
---

# Design system

Full reference: `docs/design/DESIGN-SYSTEM.md` (measured values, components, per-viewport behavior). Tokens:
`packages/tokens/src/tokens.css` (CSS custom properties + `@font-face`), the single source, and `prose.css` (post
bodies). Site styles: `apps/web/src/styles/site.css`; admin: `apps/admin/src/admin.css`. Both import `@blog/tokens`;
the profile SVGs (`tooling/profile/src/theme.ts`) read their colors from the same `tokens.css`.

## Character (keep these three)

1. **Three type voices, fixed roles**: Gloock (display) for content titles and the brand; TeX Gyre Pagella (reading
   serif) for body text, deks and the hero h1; Hanken Grotesk (UI) for nav, labels, meta, buttons, footer. Formulas
   (MathML) use TeX Gyre Pagella Math (`--font-math`), Pagella's math companion: the reading voice, not a fourth one.
2. **Almost no decoration**: radius `0`, **no shadows** (box or text), no gradients except the photo overlays.
   Hierarchy comes from size, typeface, text color and 1px rules (`border-subtle` `#2a2a2d`).
3. **Three text levels** on `bg-page` `#0a0a0b`: primary `#ededea`, secondary `#c8c8c2`, tertiary `#8e8e88`.

## Use tokens, not values

```css
.section-head { border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); }
```

- Never hard-code a color, font stack or spacing that a token already names. New value → add the token to
  `tokens.css`, then use it.
- Labels/eyebrows: Hanken 600, 0.75rem, uppercase, tracking .12em. Meta: Hanken 0.8125rem.
- Links: inherit color, 1px underline with offset ~.22em; hover/focus underline 3px `#c4d0ff`. In articles the
  accent is `#9db2ff`; inside `.paper` the accent becomes `periwinkle-700` `#3b5bdb` (contrast on white).
- Gutter `clamp(1rem, 3.75vw, 3rem)`; sections `padding-top: 5rem`; reading column ~35em.
- Motion: 150 ms transitions at most, always behind `prefers-reduced-motion`.

## Surfaces

- Dark pages (home, listings) use `bg-page`, panels `bg-surface` `#141416`.
- Reading pages: dark full-screen hero, then the white `.paper` sheet (`paper-bg` `#fff`, `paper-text` `#2c2724`),
  then dark again for "Seguir leyendo" ("Keep reading") and the footer. Code blocks use the GitHub-dark pair `#24292e` / `#e1e4e8`.
- Formulas on the sheet take the text color; display math is centered in its own focusable box that scrolls
  horizontally on narrow screens (`.math-display`), and TeX that does not compile shows its source as code in
  `--paper-error` with a wavy underline (6.5:1 on white; `apps/web/test/contrast.test.ts`).
- Text over photos: `overlay-hero` bands (top and bottom, sized in rem) plus the `overlay-hero-text` veil behind the
  text block; topic tiles add `overlay-tile`. Values are guarded by `apps/web/test/contrast.test.ts` (worst case: a
  white photo). Over images use `text-primary`/`text-secondary` only.

## Fonts

- Self-hosted woff2, latin subset, `font-display: swap`, served from `/fonts/`. Gloock and Hanken come from npm
  (`pnpm --filter @blog/web fonts`); Pagella files are versioned in `apps/web/public/fonts/` with `LICENSES.txt`
  (GUST license). Do not add external font CDNs.
- `pagella-math.woff2` (TeX Gyre Pagella Math, GUST, from CTAN) is the whole font, not subset: formulas need its MATH
  table with the stretchy variants and assemblies. Only `.prose math` uses `--font-math`, so only pages with a formula
  download it (`apps/web/test/math-css.test.ts`). The admin gets every font from the same `/fonts/` (Caddy in
  production, the `devFonts` middleware of `vite.config.ts` in development).

## Reuse, do not copy content

The system was measured from a reference site; its screenshots in `docs/design/reference/` are gitignored. Use the
system with the owner's own texts and photos; never copy third-party text, images or posters.

## Checklist

- [ ] Only tokens; any new value added to `tokens.css`.
- [ ] Right typeface for the role; no radius, no shadow, rules are 1px `border-subtle`.
- [ ] Over photos: overlay tokens + primary/secondary text; contrast test still green.
- [ ] Inside `.paper`: paper tokens and the dark-on-white accent.
- [ ] Looks right at 390, 768, 1024, 1440 and 1920 px.

## Anti-patterns seen here

- `text-shadow` to rescue contrast (forbidden; `site-css.test.ts` fails on it) — use the veil.
- Light-theme accents reused on the white sheet (2.1:1 and 1.5:1 focus/underline) before `periwinkle-700`.
- Keeping a second copy of the tokens: `packages/tokens/src/tokens.css` is the only source. A `docs/design/tokens.json`
  copy drifted and was removed, and so did `packages/tokens/src/tokens.json` (a hand-kept DTCG mirror that ended up
  with entries the CSS did not have and a value that differed).
