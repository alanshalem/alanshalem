---
name: react-admin-conventions
description: "Conventions of the React 19 + Vite admin in apps/admin, where src/api only does HTTP, rules live in pure TypeScript modules tested with node --test, hooks hold state and effects and components only present, alongside typed es/en dictionaries, the single editor action registry, limits mirrored from the API and the native textarea editor. Use when adding or changing pages, components, hooks, API calls, editor commands or shortcuts, validation or any text of the admin."
---

# React admin conventions (`apps/admin`)

## Folder = feature

`src/editor/` (Markdown editor), `src/posts/` (versions, history, schedule, lint, autosave, share), `src/hero/`
(gallery, video trim/fade), `src/settings/`, `src/navigation/` (titles, focus, unsaved guard), `src/i18n/`,
`src/components/` (shared presentational pieces), `src/pages/` (one per route), `src/api/`.

## Three kinds of modules

| Kind | Naming | May import | Tested by |
|---|---|---|---|
| Pure rules | `heroSize.ts`, `lint.ts`, `commands.ts`, `schedule.ts`, `versions.ts`, `postForm.ts` | other pure modules, `i18n.ts` types | `test/*.test.ts` with node --test |
| Hooks | `useHeroImages.ts`, `useAutosave.ts`, `useUnsavedGuard.ts` | React, `api/client.ts`, pure modules | through their pure parts |
| Components | `HeroGallery.tsx`, `Banner.tsx`, `PageHead.tsx` | hooks, pure modules, `useUiLanguage` | — (keep them dumb) |

- Pure modules have no React and no DOM: they take an `I18n` (or `Translate`) parameter when they produce text, so
  tests choose the language with `i18nFor('es' | 'en')`.
- Code imported by node --test uses erasable TypeScript only (no `enum`, `namespace`, parameter properties) and
  imports with explicit `.ts` extensions.

## `src/api/` only does HTTP

- `client.ts` has the single `request()` used by every call: `credentials: 'same-origin'`,
  `X-Requested-With: blog-admin` (CSRF), `Accept-Language` from `setApiLanguage(lang)` (set by the UI language
  provider when the ES | EN selector changes), JSON or `FormData`, `ApiError(status, message)` on failure with the
  ProblemDetails text from `problem.ts`.
- `errorMessage(caught, fallback)` (`api/problem.ts`) is the one way to turn a caught value into text: an `Error`'s own
  message (an `ApiError` already carries the localized API text), else `fallback`. Do not repeat
  `caught instanceof Error ? …` in hooks or pages.
- `types.ts` mirrors the API DTOs. No UI decisions in `src/api/`.

## Texts (i18n)

- Every visible string is a key: `t('nav.settings')`, `plural(count, 'posts.count')`. Keys in `i18n/es.ts` define the
  `Dictionary` type; `i18n/en.ts` must have exactly the same keys (compiler + `test/i18n.test.ts`).
- Key shape `area.name`; `{param}` placeholders; `.one` / `.other` pairs for plurals.
- UI language is independent from each post's language. Dates/times via `formatDate`, `formatDateTime`,
  `formatTime` of the `I18n` object (es-AR 24 h, en-US).
- Error texts from the API already come localized (the admin sends `Accept-Language`); switch on behavior by status
  or `code`, never by text. See skill `bilingual-i18n`.
- Hero size warnings (photos and videos) come from the admin's own `checkHeroSize` (`hero/heroSize.ts`) in the UI
  language; for an uploaded video `videoWarnings` (`hero/heroVideo.ts`) applies it to the size the API measured. The
  API's `video.warnings` text is not shown, so the admin has one source for what it says.

## Single sources inside the admin

- `src/editor/actions.ts` is THE list of editor actions: toolbar, command palette (Ctrl+P), keyboard shortcuts and
  the shortcuts help (Ctrl+/) are generated from it. Adding an action = one entry here.
- `src/limits.ts` mirrors API validation limits for early feedback (`maxLength`, counters, guides); the API stays
  the authority. `test/limits.test.ts` reads the C# constants.
- `src/languages.ts` lists languages; `src/siteUrl.ts` gives the public site URL ("Ver sitio" / "View site"), `/` in production and
  `http://localhost:4321/` injected by `vite.config.ts` only for `vite dev`.
- `useSaveShortcut.ts` is the only Ctrl+S binding; `navigation/useUnsavedGuard.ts` the only leave guard.
- `posts/postForm.ts` (pure) turns a `Post` into the editor's text fields (`toPostForm`, `EMPTY_POST_FORM`) and those
  fields back into the `PostInput` that is saved (`toPostInput`); the editor page keeps only state and rendering.

## Editor

- Native `<textarea>` + pure commands (`editor/commands.ts`, type `Command = (state: EditorState) => TextEdit | null`,
  `null` = leave the native behavior); `editor/applyEdit.ts` applies the `TextEdit` with `execCommand('insertText')`
  so native undo/redo keeps working.
- Preview = `@blog/markdown` with `POST_BODY_RENDER_OPTIONS` and the post language, inside `.paper .prose`:
  identical to the published page.
- Scroll sync anchors come from the preview render's `anchorLines` (top-level blocks plus every list item), with `blockStarts` as the fallback; the outline uses `blockStarts` (same values as `blockStartLines()` of `@blog/markdown`). One render per update, never copy its regexes or re-parse.

## Behavior every page keeps

- Title per view (`navigation/pageTitle.ts`) and focus moved to the page `h1` on navigation (`usePageHeading.ts`).
- Results through `Banner` (`role="alert"` for errors, `role="status"` for success).
- Unsaved changes are guarded on in-app navigation, back, logout and "create version".
- Accessible names start with the visible text (WCAG 2.5.3); see skill `accessibility-wcag`.

## Dev server

- `vite.config.ts`: `base: '/admin/'`, `strictPort: true` on 5173 (a second Vite fails instead of silently moving to
  5174), polling watch from `tooling/dev-watch.ts`, proxy `/api` and `/media` to `API_URL`.

## Checklist

- [ ] Rule in a pure module with a test (both UI languages when it produces text).
- [ ] HTTP only through `api/client.ts`; DTO types updated in `api/types.ts`.
- [ ] New strings added to `es.ts` and `en.ts`; no literal text in components.
- [ ] Editor features registered in `actions.ts`; limits read from `limits.ts`.
- [ ] `pnpm --filter @blog/admin test` and `pnpm --filter @blog/admin typecheck` pass.

## Anti-patterns seen here

- Copied block regexes in `scrollSync` drifted from the renderer in 3 cases (fixed in `ad9b10d`).
- Ctrl+S and `beforeunload` handlers duplicated across pages (unified in `0c6ae73`).
- Limits and image types duplicated between admin and API with different wording (now `limits.ts`, tested against
  the C#).
- The API's Spanish-only video size warnings overwriting the admin's localized one (the admin now shows only its own
  `checkHeroSize` text).
- The same `caught instanceof Error ? caught.message : …` copied into ten hooks and pages (now `errorMessage`).
- Vite serving a stale module on Windows (`client.ts` without `ApiError`): fixed for good with polling (`71261e3`).
- "Ver sitio" ("View site") pointing at the admin's own Vite port in dev (`b636678`).
