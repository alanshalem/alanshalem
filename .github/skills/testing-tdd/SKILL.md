---
name: testing-tdd
description: "Test-first workflow and test tooling of this repo, covering RED then GREEN then preserve, node --test for TypeScript packages (no test libraries), xUnit for the API with the in-memory ApiFactory HTTP harness and the Ffmpeg trait, cross-language parity tests, CSS and Caddyfile guard tests plus mandatory validation with a real Caddy, scratch data in temp folders and Windows caveats. Use when writing, fixing or running any test, reproducing a bug, or deciding how to prove a change works."
---

# Testing and TDD

## The loop

1. **RED**: write a behavior-level test through the public surface (exported function, HTTP endpoint, CLI) and run it
   to see it fail for the right reason (a missing export counts: `L17` "RED (export inexistente) → GREEN").
2. **GREEN**: the smallest change that passes.
3. **PRESERVE**: for each existing behavior that shares the changed code, one test proving it still holds
   (renderer changes: Markdown that does not use the feature renders exactly as before).
4. **REFACTOR** with the suite green. Record the counts in the feature log (`API 476, admin 342, web 147`).

A regression gets a test that fails on the old code first. Example: `apps/web/test/caddyfile.test.ts` accepts
`CADDYFILE=<path>` to prove it catches the pre-`48f0158` file.

## Runners

```bash
pnpm test                                   # all Node workspaces (node --test "test/*.test.ts" each)
pnpm --filter @blog/web test                # one workspace: @blog/markdown, @blog/admin, @blog/web, @blog/builder
node --test "tooling/agents/test/*.test.ts" # skill sync + validator
cd apps/api && dotnet test                  # xUnit, all
cd apps/api && dotnet test --filter "Category!=Ffmpeg"   # skip the slow real-ffmpeg tests
pnpm typecheck                              # tsc / astro check: run it too, tests run with types stripped
```

## node --test conventions (TypeScript, no test dependencies)

- `import assert from 'node:assert/strict'` and `describe`/`it`/`test` from `node:test`. No Jest/Vitest.
- Files run with Node type stripping: erasable TypeScript only, imports with `.ts`.
- Test pure modules directly; read sibling files with `new URL('../src/x', import.meta.url)`.
- Describe/it names follow the surrounding language (Spanish in apps and packages) and cite the spec when useful
  (`describe('idiomas fijos (L3)')`).
- Guard tests on text are fine when the rule lives in text: CSS rules (`site-css.test.ts`, `contrast.test.ts`
  computes WCAG ratios from tokens), the Caddyfile (`caddyfile.test.ts`), C# constants (`apps/admin/test/limits.test.ts`
  parses `Blog.Domain/*.cs`).

## xUnit conventions (`apps/api/tests/Blog.Tests`)

- Names `Subject_does_this_when_that` (`Probe_reads_the_size_and_duration_of_a_real_clip`).
- Domain and services with test doubles (`TestDoubles.cs`), SQLite persistence tests on a real file database,
  generated media (`TestImages.cs`, `TestVideos.cs` generates clips with ffmpeg: no binary fixtures).
- HTTP contract through `Http/ApiFactory.cs`: the real `Program.cs` in memory, temp folders for DB/media/keys, fake
  builder (`CountingBuildTrigger`) and fake transcoder; `AdminClientAsync()` logs in once (rate limit), mutations via
  `ApiFactory.Mutation(...)` (adds the CSRF header), `Development` for dev-only behavior. Every new route gets an
  HTTP test (status, body, headers, language).
- Real adapters behind `[Trait("Category", "Ffmpeg")]` (ffmpeg/ffprobe on the PATH).

## Parity tests (two places must agree)

| Pair | Test |
|---|---|
| API limits ↔ admin `limits.ts` | `apps/admin/test/limits.test.ts` |
| Site dictionary es ↔ en | `apps/web/test/i18n.test.ts` |
| Admin dictionary es ↔ en | `apps/admin/test/i18n.test.ts` |
| API message catalog es ↔ en | `MessageCatalogTests.cs` |
| Skill source ↔ generated copies | `tooling/agents/test/sync.test.ts` (and `node tooling/agents/sync.ts --check`) |

## Infra changes: text test + real run

The Caddyfile test pins intent, but **only a real Caddy proves behavior**: run `caddy validate` (or the Caddy image)
and hit the routes (`curl -I`) for status and headers. Lesson (`plataforma-calidad.md` L10): `try_files @html …`
passed the text test but Caddy does not accept a matcher there. Same for compose files: bring the stack up.

## Scratch and side effects

- Tests create their own temp directories (`mkdtemp`, `Path.GetTempPath()` + GUID) and delete them in teardown.
  Never point a test at `data/`, the dev database or `/media`.
- Never touch real secrets; `ApiFactory` uses its own password and token.

## Windows notes

- Builder tests that create symlinks may fail with EPERM on Windows without Developer Mode (known advisory).
- Dev servers poll (`tooling/dev-watch.ts`); a stale module in Vite was a lost file event, not a code bug.

See [the test map](references/test-map.md) for which file covers which area.

## Checklist

- [ ] RED observed and its output noted; GREEN observed; preservation test for touched behavior.
- [ ] Focused suite first, then the workspace suite and `typecheck`; `dotnet test` for API changes.
- [ ] Infra/Caddy/compose changes validated by running the real thing.
- [ ] Temp data cleaned up; `git status` shows no scratch files.

## Anti-patterns seen here

- Declaring "done" for code never compiled (the v0.1 README listed what had never run).
- Text-only proof of a Caddy rule (`try_files` with a matcher; `redir /es/` read as a path matcher).
- A test that cancels by matching a Spanish log line (fragile, `cb91baf` review R2-002).
- Error-message constants duplicated in tests instead of using the catalog (`6c40950` review).
