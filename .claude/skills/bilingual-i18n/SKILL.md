---
name: bilingual-i18n
description: "How Spanish (default) and English work across this repo, covering hand-translated post versions linked by translationGroupId, customizable fields with an En variant that falls back to Spanish except proper names, fixed strings in dictionaries with key-parity tests in site, admin and API, the /es/ and /en/ routes with translated slugs, Accept-Language rules, hreflang and dates. Use when adding any visible text, a customizable setting, a route or slug, an API message, or anything that depends on the reader's language."
---

# Bilingual (es / en)

Two fixed languages: `es` (principal, default) and `en`. Defined once per app — `Blog.Domain/Language.cs`,
`apps/web/src/lib/i18n.ts` (`LANGS`, `DEFAULT_LANG`), `apps/admin/src/languages.ts`. Do not generalize to N
languages or add an i18n library (KISS/YAGNI: the two languages are fixed).

## Decide where a text belongs

| The text is… | Rule | Example |
|---|---|---|
| Post content | One `Post` row per language, joined by `translationGroupId`; each has its own slug, status, tags | `/es/articulos/mi-post/` ↔ `/en/articles/my-post/` |
| Customizable outside posts | Spanish field + `En` field; `null`/empty `En` → Spanish | `tagline`/`taglineEn`, `bio`/`bioEn`, hero `alt`/`altEn` |
| A proper name | ONE field for both languages, no `En` | site/author `name` (the owner's name is one and the same in both languages), hero photo `credit` (one credit per photo) |
| Fixed UI text | Dictionary entry in both languages with the same key | site `ui(lang).readNext`, admin `t('nav.settings')`, API `MessageKeys.PostTitleRequired` |
| Language-neutral | No translation | email, social links, files |

Fallback is resolved where the text is used: `toSiteSettings` in `apps/web/src/lib/settings.ts`
(`(lang === 'en' ? text(english) : null) ?? text(es)`), `localizeHeroImage` in `lib/hero.ts`.

## Translations are manual

- No machine translation anywhere: every translation is written by hand (the owner's decision).
- "Crear versión en inglés/español" (en: "Create English/Spanish version") creates a **draft** in the other language
  copying the original text as a starting point (same initial slug; if taken there, `{slug}-{lang}`; 409 only if that
  is taken too).
- The admin warns "Sin traducir" ("Not translated") while title or body equal the original, and "Desactualizada"
  ("Out of date") when the original's `contentUpdatedAt` (content changes only, not publish/unpublish) is newer than
  the translation's.
- Slugs are unique per language: unique index `(Lang, Slug)`. A post's language cannot change after creation.

## Dictionaries and parity

- Site: `es` object in `src/lib/i18n.ts` defines `UiKey`; `en: Record<UiKey, string>`. `test/i18n.test.ts` checks
  same keys, no empty values, same `{placeholders}`. Use `interpolate`, `articleCount`, `formatDate`.
- Admin: `src/i18n/es.ts` defines `Dictionary`; `en.ts` is typed `Dictionary`. `.one`/`.other` plural pairs.
  `test/i18n.test.ts` repeats the parity check.
- API: `MessageKeys` + `MessageCatalog` (`LocalizedText(Spanish, English)`); `MessageCatalogTests` checks every key
  has both texts with the same placeholders. Clients switch on `code`, never on text.
- Renderer-added texts (callout titles, "Notas al pie"): `packages/markdown/src/labels.ts`.
- Visible defaults count as fixed text (`defaultName`, `defaultTagline`, RSS titles, 404).

## Language of the request

- Root `/`: Caddy redirects 302 with `Vary: Accept-Language` — `/en/` if the first preference matches
  `(?i)^\s*en\b`, otherwise `/es/`. The build also writes a root `index.html` redirecting to `/es/` for servers
  without that rule.
- 404 without a language prefix (`/noexiste`, `/admin-typo`): Caddy serves `/en/404.html` or `/es/404.html` with the
  same rule (the one `@english` matcher of the site block) and `Vary: Accept-Language`. One language, never both.
- API errors: `RequestLanguage.Of` applies the same regex; responses carry `Vary: Accept-Language`.
- The admin sends its UI language as `Accept-Language` (`setApiLanguage` in `src/api/client.ts`). The admin UI
  language (localStorage, default from the browser) is independent from each post's language.

## Site details

- Routes: `/es/`, `/es/articulos/<slug>/`, `/es/temas/<tag>/`, `/es/rss.xml`; `/en/`, `/en/articles/<slug>/`,
  `/en/topics/<tag>/`, `/en/rss.xml`; `sitemap.xml` with alternates. Always via `paths`.
- `<html lang>`, `og:locale` (`ogLocale`), dates with `Intl` (`es-AR`, `en-US`) in `SITE_TIME_ZONE`.
- ES | EN switcher: the equivalent published page if it exists, else the other language's home (or topics index).
- `hreflang` only when the page exists in every language; `x-default` → Spanish.
- 404 per URL prefix: `/es/404.html`, `/en/404.html`; without a prefix, the browser's language (above).
- Body render gets the post's `lang` (smart quotes, callout labels).

## Copy style

- Spanish is Rioplatense with voseo, like the existing texts ("Entrá", "Guardá"). English is US.
- Only reader/admin-facing text is Spanish (the `es` dictionaries, the Spanish catalog entries, Spanish routes and
  slugs, fixtures that assert Spanish output). Code, comments, tests, logs and docs are in English.
- Accessible names start with the visible text in both languages (WCAG 2.5.3).

## Checklist

- [ ] Classified the text with the table above (post / customizable / proper name / fixed / neutral).
- [ ] New customizable field: `xxx` + `xxxEn` in domain, DTOs, migration, admin form, site fallback, tests.
- [ ] New fixed text: key in both dictionaries (or both catalog languages), parity test green.
- [ ] URLs from `paths`; both languages generated; `hreflang` correct.
- [ ] No machine translation, no copied English text pretending to be a translation.

## Anti-patterns seen here

- Comparing `updatedAt` for "Desactualizada": publishing changed it and flagged translations wrongly (fixed with
  `contentUpdatedAt`, `bcb49bc`).
- Adding an English variant of a proper name (`nameEn` and the hero `creditEn`, both reverted by the owner).
- `redir /es/ 302` in Caddy (the path is read as a matcher); it must be `redir * /es/ 302` (`2326627`).
- Hard-coded Spanish strings in the admin after it became bilingual.
- A bilingual root `/404.html` (the Spanish notice, then the English one) for URLs without a prefix: the owner wants
  one language, the browser's, like the root redirect.
