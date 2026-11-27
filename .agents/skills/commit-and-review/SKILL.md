---
name: commit-and-review
description: "How work is sliced, committed and reviewed in this repo, covering Conventional Commits in English with app scopes, one task per commit that compiles and passes alone, risky work (schema, background jobs, infra, security) in its own commit, review budgets, and non-blocking findings turned into follow-up commits or accepted with a reason. Use when preparing a commit or a split for review, or handling review findings."
---

# Commits and review

## Commit messages

Conventional Commits, English, imperative summary, scope = area:

```
feat(admin): revision history and scheduled publishing UI
fix(infra): /api/internal 404 is no-store too
fix(ux,a11y): mobile menu, nav state, 404, topic counts, readable RSS, + EN chip
refactor: single sources for validation limits, block boundaries and site URL
build(infra): Caddy caching, security headers on errors, faster health, robust builds
```

- Types used: `feat`, `fix`, `refactor`, `build`, `test`, `perf`, `chore`, `ci`, `docs`. Scopes: `api`, `web`, `admin`,
  `markdown`, `infra`, `dev`, `a11y`, `i18n`, `ux` (comma-separated when a commit spans two).
- Body: wrapped bullets that say what changed and **why** (the bug, the measurement, the decision), plus how it was
  verified when it is not obvious ("verified with real Caddy and headless Chrome").
- Tests and docs (README, DESIGN-SYSTEM.md, skills) travel in the same commit as the code they describe.
- Code comments and commit bodies state the rule or the reason itself, never an id from private notes.

## Slicing

- One task = one commit when possible; a big task may be 2–3 commits, each a coherent layer.
- Keep a commit reviewable by the native review: under ~2000 changed lines. A 3006-line commit exceeded the reviewers'
  context budget.
- **Every slice must compile and pass on its own.** Splitting by layer once produced a part that did not compile, and
  its two "critical" findings were artifacts of the split. Verify each slice in a clean worktree before review.
- High-risk work goes alone: schema and migrations, background scheduling, infra, native dependencies and CI. Security
  fixes found along the way get their own commit (`48f0158`).
- Do not mix unrelated drive-by refactors into a feature commit.

## Safety

- Never commit secrets or local data (`.env`, `data/`, `*.db`, user-secrets). `infra/local.env` only holds local test
  values.
- Never stage files you did not change; preserve other people's uncommitted work.
- Never push, publish, tag or open PRs without the user's explicit decision. Everything lands on `master` locally
  unless told otherwise.

## Review findings

- Findings carry an id with one prefix per review lens (`R2-misleading-argname`, `R3-004`, `R4-spa-fallback-immutable`;
  lenses: risk, resilience, readability, reliability). Blocking ones are fixed before the task closes; non-blocking
  ones are either fixed in a follow-up commit ("review follow-ups") or explicitly accepted with a reason (YAGNI,
  documented trade-off).
- A finding you can disprove is answered with evidence (file:line, a test), not silently ignored.

## Checklist

- [ ] Message `type(scope): summary` in English; body explains why and how it was verified.
- [ ] The commit builds, its tests pass, and it stands alone.
- [ ] Size fits review; risky parts isolated.
- [ ] No secrets, no unrelated files, nothing pushed.

## Anti-patterns seen here

- Review slices that did not compile alone.
- A commit too big for the reviewers' context.
- Comments citing a spec or task id instead of stating the rule (review of `4eee60d`).
- Leaving unverified partial work from cancelled workers in the tree (it was discarded and redone).
