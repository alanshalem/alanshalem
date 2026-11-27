---
name: testing-tdd
description: "Test-first workflow and test tooling of this repo, covering RED then GREEN then preserve, node --test for TypeScript packages (no test libraries), xUnit for the API with the in-memory ApiFactory HTTP harness and the Ffmpeg trait, cross-language parity tests, CSS, Caddyfile, compose and backup-script guard tests plus mandatory validation with a real Caddy and Docker, the CI jobs that run all of it, scratch data in temp folders and Windows caveats. Use when writing, fixing or running any test, reproducing a bug or a red CI job, or deciding how to prove a change works."
---

# Testing and TDD

## The loop

1. **RED**: write a behavior-level test through the public surface (exported function, HTTP endpoint, CLI) and run it
   to see it fail for the right reason (a missing export counts: "RED (missing export) → GREEN").
2. **GREEN**: the smallest change that passes.
3. **PRESERVE**: for each existing behavior that shares the changed code, one test proving it still holds
   (renderer changes: Markdown that does not use the feature renders exactly as before).
4. **REFACTOR** with the suite green. Report the counts before and after (`API 476, admin 342, web 147`).

A regression gets a test that fails on the old code first. Example: `apps/web/test/caddyfile.test.ts` accepts
`CADDYFILE=<path>` to prove it catches the pre-`48f0158` file.

## Runners

```bash
pnpm test                                   # every workspace + test:profile + test:agents + test:infra
pnpm --filter @blog/web test                # one workspace: @blog/markdown, @blog/admin, @blog/web, @blog/builder
pnpm test:agents                            # skill sync + validator (tooling/agents/test)
pnpm test:profile                           # profile SVG generator (tooling/profile/test)
pnpm test:infra                             # compose, Dockerfiles, Caddyfile, backup/restore scripts (infra/test)
cd apps/api && dotnet test                  # xUnit, all
cd apps/api && dotnet test --filter "Category!=Ffmpeg"   # skip the slow real-ffmpeg tests
pnpm typecheck                              # tsc / astro check: run it too, tests run with types stripped
```

## CI runs all of it (`.github/workflows/ci.yml`)

| Job | Runs |
|---|---|
| `node` | `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @blog/admin build`, `pnpm agents:check` (Node of the production image) |
| `dotnet` | `dotnet build -warnaserror` + `dotnet test --no-build` inside the `dev` target of `apps/api/Dockerfile` (ffmpeg 9.1: the Ffmpeg tests run) |
| `infra` | `docker compose config -q` (VPS with placeholder env, local copy, dev) and `caddy validate` with the pinned Caddy |
| `images` | `docker compose build <service>` for api, builder, caddy + Trivy (CRITICAL/HIGH with a fix fails) |
| `security` | `pnpm audit --prod --audit-level high`, `dotnet list package --vulnerable --include-transitive`, gitleaks over the full history |

The exact local commands are in `.github/README.md` "How to verify" (the API one copies the code into the container,
so Windows bind mounts and your `bin/`/`obj/` are not involved). A test that only passes on your machine is not done.

## node --test conventions (TypeScript, no test dependencies)

- `import assert from 'node:assert/strict'` and `describe`/`it`/`test` from `node:test`. No Jest/Vitest.
- Files run with Node type stripping: erasable TypeScript only, imports with `.ts`.
- Test pure modules directly; read sibling files with `new URL('../src/x', import.meta.url)`.
- Describe/it names are English and state the rule they prove (`describe('fixed languages')`), never an id from
  private notes. Strings that assert Spanish output stay Spanish (they are what readers see).
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
| Node of the builder image ↔ Node of the Caddy image | `infra/test/compose.test.ts` |
| API and builder ports across Dockerfiles, C#, TypeScript, Caddyfile and compose | `infra/test/ports.test.ts` |
| Profile SVG colors ↔ `tokens.css` | `tooling/profile/test/theme.test.ts` |
| Markdown public exports ↔ the documented list | `packages/markdown/test/escape.test.ts` |

## Infra changes: text test + real run

The Caddyfile and compose tests pin intent, but **only a real Caddy and Docker prove behavior**: run `caddy validate`
(or the Caddy image) and hit the routes (`curl -I`) for status and headers; `docker compose config -q` and bring the
stack up. Lesson: `try_files @html …` passed the text test but Caddy does not accept a matcher there. Shell scripts (`infra/backup.sh`, `restore.sh`) are tested through a fake `docker` on the PATH
(`infra/test/backup.test.ts`) and once for real against the local production copy.

## Scratch and side effects

- Tests create their own temp directories (`mkdtemp`, `Path.GetTempPath()` + GUID) and delete them in teardown.
  Never point a test at `data/`, the dev database or `/media`.
- Never touch real secrets; `ApiFactory` uses its own password and token.

## Windows notes

- Builder tests that create symlinks skip themselves on Windows without Developer Mode (EPERM); the backup-script tests
  skip on Windows. CI (Linux) runs them: check its result before calling infra work done.
- Dev servers poll (`tooling/dev-watch.ts`); a stale module in Vite was a lost file event, not a code bug.

See [the test map](references/test-map.md) for which file covers which area.

## Checklist

- [ ] RED observed and its output noted; GREEN observed; preservation test for touched behavior.
- [ ] Focused suite first, then the workspace suite and `typecheck`; `dotnet test` for API changes.
- [ ] Infra/Caddy/compose changes validated by running the real thing.
- [ ] CI green, or every CI job reproduced locally with the README commands.
- [ ] Temp data cleaned up; `git status` shows no scratch files.

## Anti-patterns seen here

- Declaring "done" for code never compiled (the v0.1 README listed what had never run).
- Text-only proof of a Caddy rule (`try_files` with a matcher; `redir /es/` read as a path matcher).
- A test that cancels by matching a Spanish log line (fragile, `cb91baf` review R2-002).
- Error-message constants duplicated in tests instead of using the catalog (`6c40950` review).
