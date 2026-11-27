# Release guide: from staging to production

How a change travels from your machine to `alanshalem.com`, step by step. The same flow applies to every system on the
VPS (alanshalem now; wearemaking and ting once they run on Dokploy): replace the domains and the App Names.

Setup and first deploy: [vps-guide.md](vps-guide.md). Commands on the server and backups:
[README "Operations (VPS)"](README.md#operations-vps).

## Contents

- [1. How it works](#1-how-it-works)
- [2. Everyday flow](#2-everyday-flow)
- [3. Release to production](#3-release-to-production)
- [4. Verify production](#4-verify-production)
- [5. Hotfix](#5-hotfix)
- [6. Rollback](#6-rollback)
- [7. Dependabot pull requests](#7-dependabot-pull-requests)
- [8. If it fails](#8-if-it-fails)
- [9. Branch protection](#9-branch-protection)

## 1. How it works

| | Staging | Production |
| --- | --- | --- |
| URL | `https://staging.alanshalem.com` (asks for the `staging` user) | `https://alanshalem.com` |
| Dokploy service | `alanshalem` → environment `staging` → `blog` | `alanshalem` → environment `production` → `blog` |
| Deploys when | a commit is pushed to `master` (Trigger Type `On Push`) | a tag is pushed (Trigger Type `On Tag`), or you press **Deploy** |
| Data | its own database, media and session keys | the real ones |

Three rules decide everything else (checked in Dokploy v0.31.4's source on the VPS):

1. **A deploy always builds the head of `master`**, also when a tag triggers it. The tag only says *when* to deploy, not
   *what*: production gets whatever `master` is when the deploy starts. Never push to `master` between creating the
   tag and the end of the production deploy.
2. **A push whose head commit message contains `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]` or
   `[actions skip]` deploys nothing**, in either environment. The daily profile-images commit
   (`chore(profile): refresh profile images [skip ci]`) is one: it never redeploys staging. The same check applies to
   a tag push, so **a tag on a `[skip ci]` commit does not deploy production** (see [8](#8-if-it-fails)).
3. **Staging does not wait for GitHub Actions.** It deploys at once; CI runs in parallel. Trust staging only when the
   CI run of that commit is green.

## 2. Everyday flow

1. **[PC]** Work on `master` (or a branch you merge into `master`), with the checks of
   [README "How to verify"](README.md#how-to-verify) green locally.
2. **[PC]** `git push origin master`.
3. **[GitHub]** Actions → the `CI` run of your commit → wait until it is green. If it fails, fix and push again;
   staging already has the broken version, which is what staging is for.
4. **[Dokploy]** `alanshalem` → `staging` → `blog` → **Deployments**: the newest entry shows your commit message and
   ends `Done` (green). `Error` → open it ([8](#8-if-it-fails)).
5. **[Browser]** `https://staging.alanshalem.com` (user `staging`) and check what you changed: the pages, and
   `/admin/` if you touched the admin. Staging has its own data: create what you need to test there.

Repeat until staging is right. Nothing reaches production yet.

## 3. Release to production

Do it when staging shows exactly what you want in production and the CI run of the head of `master` is green.

1. **[PC]** Bring your copy up to date and check what will be released (the bot may have pushed a profile commit):

   ```bash
   git fetch origin
   git log --oneline -5 origin/master
   ```

   The top commit is what production will get. If it is a `[skip ci]` profile commit, the tag will not deploy: use the
   **Deploy** button in step 5 instead of waiting for the tag.
2. **[VPS]** Back up production. It is the only way back for data (posts, settings, media):

   ```bash
   ssh vps
   cd /etc/dokploy/compose/<production appName>/code/infra
   BACKUP_DIR=/var/backups/alanshalem-production BACKUP_RCLONE_REMOTE=secret:alanshalem-production sh backup.sh
   ```

   It ends with `done: daily/<UTC>`. Without an off-site remote, drop `BACKUP_RCLONE_REMOTE=…`.
3. **[PC]** Tag the head of `master` with today's date and push the tag:

   ```bash
   git tag v2026.11.27 origin/master
   git push origin v2026.11.27
   ```

   Second release on the same day: `v2026.11.27.2`, then `.3`… Tags are never moved or reused: a new release is a new
   tag.
4. **[PC]** Do not push to `master` until step 5 shows the deploy finished.
5. **[Dokploy]** `alanshalem` → `production` → `blog` → **Deployments**: a new entry titled `Tag created: v2026.11.27`
   appears within seconds and ends `Done`. No entry after a minute → press **Deploy** (same result).
6. **[Dokploy]** Check the deployed commit: open the entry and compare the `Commit:` hash with
   `git rev-parse --short origin/master`. They must match.

A deploy that changes Caddy (the Caddyfile, the admin, its image or environment) leaves the domain without Caddy for
about 5 seconds (Traefik answers 404). Other deploys keep the site up. Volumes are never touched by a deploy.

## 4. Verify production

From your PC, the same checks as the first deploy ([vps-guide.md 10.2](vps-guide.md#102-check-from-your-pc)):

```bash
curl -sI https://alanshalem.com/ | head -1          # 302 to /es/ or /en/
curl -s -o /dev/null -w '%{http_code}\n' https://alanshalem.com/es/      # 200
curl -s -o /dev/null -w '%{http_code}\n' https://alanshalem.com/api/health/ready   # 200
```

Then open `https://alanshalem.com/` and `/admin/`, sign in, and look at what you released. Something wrong →
[6. Rollback](#6-rollback).

## 5. Hotfix

Production is broken and the fix is small:

1. **[PC]** Fix it on `master`, push, and wait for the green CI run and the staging deploy (section 2). Check the fix
   on staging: a hotfix that was never seen running is a guess.
2. Release it (section 3) with a new tag (`v2026.11.27.2`).

## 6. Rollback

Dokploy cannot deploy an old tag: it always builds the head of `master` (rule 1). Going back is therefore a new commit.

**Code** (the release broke the site, data is fine):

1. **[PC]** Undo the bad commits on `master` with new commits (never rewrite `master`'s history):

   ```bash
   git revert --no-edit <first bad commit>^..<last bad commit>
   git push origin master
   ```

2. Check staging, then release the revert with a new tag (section 3).

Urgent and the revert needs time: in Dokploy, `production` → `blog` → **Deployments** → **Rollback** on the previous
`Done` entry, if your Dokploy version offers it, buys time; the revert is still the real fix.

**Data** (a migration or an action damaged posts, settings or media): restore the backup of step 3.2 with `restore.sh`
([README "Rollback"](README.md#rollback)). Everything written after that backup is lost, and the admin signs in again.

## 7. Dependabot pull requests

Dependabot opens pull requests with updates every week.

1. **[GitHub]** Open the PR and wait for its CI run. Red → close it or fix it on `master`.
2. Green → **Merge**. The merge is a push to `master`: staging deploys it (section 2).
3. Check staging, then release as usual (section 3). Several merged updates can go out in one release.

## 8. If it fails

| Symptom | Cause | What to do |
| --- | --- | --- |
| Pushed a tag, no production deployment appears | The head of `master` is a `[skip ci]` commit (the profile bot), or the GitHub webhook did not arrive | Dokploy → `production` → `blog` → **Deploy** |
| Production shows an older or newer version than expected | Something was pushed to `master` between the tag and the deploy (rule 1) | Compare the deployment's `Commit:` with the commit you wanted; release again from the right head |
| Pushed to `master`, staging did not deploy | The commit message contains `[skip ci]`, or the webhook did not arrive | Dokploy → `staging` → `blog` → **Deploy** |
| Deployment `Error`, log ends `container …-api-1 is unhealthy` | The API did not start: a bad environment value (for example a short `BUILDER_TOKEN`) or a failed migration | `blog` → **Logs** → `api`: the first error line names it; fix the Environment tab, Deploy again |
| Deployment `Error`, `container …-caddy-1 is unhealthy` | Caddy refused its configuration (for example a `SITE_ENV` typo) | **Logs** → `caddy`; fix, Deploy again. The domain answers 404 until then |
| `Compose file not found` | The Compose Path is not `./infra/docker-compose.yml` | General → fix it → Save → reload → Deploy ([vps-guide.md](vps-guide.md)) |
| Every page answers 403 | The domain lost its proxy-secret middleware, or the secret differs from `PROXY_SECRET` | Domains → the middleware chips ([vps-guide.md](vps-guide.md)) |

## 9. Branch protection

`master` accepts changes only through pull requests whose CI checks are all green (ruleset
"master: pull requests with green CI": squash merge only, no force push, no deletion). An admin may merge a pull
request without waiting for the checks in an emergency; nobody pushes straight to `master`.

- **Your changes:** `git switch -c feat/x` → commit → `git push -u origin feat/x` → `gh pr create --fill` →
  `gh pr merge --auto --squash` (merges by itself when CI is green; the merge deploys staging).
- **Dependabot:** patch and minor updates merge by themselves when CI is green
  (`.github/workflows/dependabot-auto-merge.yml`); majors wait for you.
- **The profile bot** pushes its daily commit straight to `master` with a deploy key, the only actor the ruleset
  lets through. One-time setup, from the repo folder:

  ```bash
  ssh-keygen -t ed25519 -N "" -C profile-bot -f profile-bot
  gh repo deploy-key add profile-bot.pub --allow-write --title "profile bot (pushes to master)"
  gh secret set PROFILE_DEPLOY_KEY < profile-bot
  rm profile-bot profile-bot.pub
  ```
