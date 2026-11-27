# Release guide: from staging to production

How a change travels from your machine to `alanshalem.com`, step by step. The same flow will apply to every system on
the VPS (wearemaking and ting once they run on Dokploy): replace the domains, the App Names and the images.

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
- [10. One-time setup](#10-one-time-setup)

## 1. How it works

**Build once, promote by tag.** CI builds the images once per commit; staging runs them; a tag sends those same
images to production.

| | Staging | Production |
| --- | --- | --- |
| URL | `https://staging.alanshalem.com` (asks for the `staging` user) | `https://alanshalem.com` |
| Dokploy service | `alanshalem` → environment `staging` → `blog` | `alanshalem` → environment `production` → `blog` |
| Deploys when | the CI run of a merge into `master` is green | a `v*` tag is pushed |
| Runs | the images of that commit | the images of the tag's commit: what staging ran |
| Data | its own database, media and session keys | the real ones |

The rules behind it:

1. **CI builds every image once.** On each commit to `master`, CI builds api, builder and caddy, scans them (Trivy)
   and publishes them as `ghcr.io/alanshalem/blog-<service>:sha-<commit>`. A published tag is never overwritten. The
   VPS never builds anything.
2. **Staging waits for CI.** The Deploy workflow (`.github/workflows/deploy.yml`) starts when the CI run of a push to
   `master` ends green and deploys that commit's images. A red run deploys nothing. A green run of a commit that is
   no longer the newest one CI ran on `master` (a re-run of an older CI, or a slow run overtaken by a newer merge) is
   skipped with the notice "superseded by a newer master commit": staging never moves backwards.
3. **The tag chooses what production runs**: the images of the tag's commit, never a rebuild and never "the head of
   `master`". Pushing or merging after tagging changes nothing. The workflow refuses a tag whose commit has no green
   CI run (for example a `[skip ci]` commit such as the daily profile images, which runs no CI and publishes
   nothing).
4. **Only the workflow deploys.** Auto Deploy is off in both Dokploy services (by hand once,
   [10](#10-one-time-setup), and again by the workflow on every deploy), so Dokploy's webhook does nothing. Pressing
   **Deploy** in the panel redeploys the version the workflow last set.
5. **Rollback is a deploy of an older tag**: its images are still in GHCR. No revert, no rebuild.
6. **One deploy at a time per environment, one waiting.** A second deploy for the same environment waits for the
   running one; GitHub keeps only **one** waiting run per environment, so a third one replaces the waiting one
   (GitHub marks it cancelled). Pushing two tags quickly can therefore skip the first: check the Actions tab, and run
   the workflow again for the tag you want ([6](#6-rollback) shows how).

What one deploy does (the job summary of each run lists the environment, version, commit and the three images):

1. **Plan**: picks the environment and the commit, checks that the commit's whole CI run on `master` passed and that
   the three images can be pulled without credentials, the way Dokploy pulls them. Dokploy is not touched yet.
2. **Deploy**, in the GitHub environment `staging` or `production` (one at a time per environment): sets the Dokploy
   environment variable `IMAGE_TAG=sha-<commit>` (the service's Environment tab reads it), writes the service's
   command, branch (the tag for a release, `master` for a commit on staging) and Auto Deploy off, then starts the
   deploy and waits up to 15 minutes for Dokploy to say `done` or `error`.
3. **Smoke test**: production must answer 200 on `/api/health/ready`. Staging must answer 401: its basic auth is in
   Traefik and the workflow has no staging password (only you and the VPS know it). The 401 still proves
   the deploy, because Traefik only routes the domain to a healthy Caddy (404 otherwise); a 200 would mean the basic
   auth is gone, and fails the run.

## 2. Everyday flow

Every change reaches `master` through a pull request ([9](#9-branch-protection)).

1. **[PC]** Work on a branch, with the checks of [README "How to verify"](README.md#how-to-verify) green locally:

   ```bash
   git switch -c feat/x
   git push -u origin feat/x
   gh pr create --fill
   gh pr merge --auto --squash      # merges by itself when every CI check is green
   ```

2. **[GitHub]** CI runs on the pull request. Red → fix, push again to the same branch.
3. **[GitHub]** After the merge, CI runs again on `master` and publishes the images; when it is green the Deploy
   workflow deploys staging. Follow both runs of that commit (each Deploy run is titled
   `Deploy <version> to <environment>`, so the filter finds the one of your commit, not just the newest):

   ```bash
   git fetch origin && sha=$(git rev-parse origin/master)        # the merge commit
   gh run watch "$(gh run list --workflow CI --commit "$sha" --json databaseId -q '.[0].databaseId')"
   sleep 15   # the Deploy run starts a few seconds after CI ends
   gh run watch "$(gh run list --workflow deploy.yml --json databaseId,displayTitle \
     -q "[.[] | select(.displayTitle == \"Deploy sha-$sha to staging\")][0].databaseId")"
   ```

   No Deploy run, or one that ends with "superseded by a newer master commit": a newer merge is on its way to
   staging ([8](#8-if-it-fails)).

4. **[Browser]** `https://staging.alanshalem.com` (user `staging`): check what you changed, and `/admin/` if you
   touched the admin. Staging has its own data: create what you need to test there.

Repeat until staging is right. Nothing reaches production yet.

## 3. Release to production

Do it when staging shows exactly what you want in production.

1. **[PC]** Find the latest commit with a green CI run on `master` and check it is the one staging runs (the summary
   of the last staging deploy shows its commit):

   ```bash
   git fetch origin --tags
   sha=$(gh run list --workflow CI --branch master --status success --limit 1 --json headSha -q '.[0].headSha')
   git log --oneline -1 "$sha"
   gh run list --workflow deploy.yml --limit 3
   ```

2. **[VPS]** Optional, recommended when the release changes data (migrations) or before a big release: back up
   production. It is the only way back for data (posts, settings, media):

   ```bash
   ssh vps
   cd /etc/dokploy/compose/<production appName>/code/infra
   BACKUP_DIR=/var/backups/alanshalem-production BACKUP_RCLONE_REMOTE=secret:alanshalem-production sh backup.sh
   ```

   It ends with `done: daily/<UTC>`. Without an off-site remote, drop `BACKUP_RCLONE_REMOTE=…`.
3. **[PC]** Tag that commit with today's date and push the tag:

   ```bash
   git tag v2026.11.27 "$sha"
   git push origin v2026.11.27
   ```

   Second release on the same day: `v2026.11.27.2`, then `.3`… Tags are never moved or reused: a new release is a new
   tag.
4. **[PC]** Watch the production deploy of that tag until it is green (the run is titled
   `Deploy v2026.11.27 to production`):

   ```bash
   sleep 10   # GitHub takes a few seconds to start it
   gh run watch "$(gh run list --workflow deploy.yml --event push --json databaseId,displayTitle \
     -q "[.[] | select(.displayTitle == \"Deploy v2026.11.27 to production\")][0].databaseId")"
   ```

   An empty result: the run has not started yet (run it again) or it was replaced while waiting
   ([rule 6](#1-how-it-works)); check Actions → Deploy.

5. **[Dokploy]** Optional: `alanshalem` → `production` → `blog` → **Deployments** shows an entry titled
   `v2026.11.27`, `Done`.

A deploy that changes Caddy (the Caddyfile, the admin, its image or environment) leaves the domain without Caddy for
about 5 seconds (Traefik answers 404). Other deploys keep the site up. Volumes are never touched by a deploy.

## 4. Verify production

From your PC, the same checks as the first deploy ([vps-guide.md 10.2](vps-guide.md#102-check-from-your-pc)):

```bash
curl -sI https://alanshalem.com/ | head -1          # 302 to /es/ or /en/
curl -s -o /dev/null -w '%{http_code}\n' https://alanshalem.com/es/      # 200
curl -s -o /dev/null -w '%{http_code}\n' https://alanshalem.com/api/health/ready   # 200
```

On the VPS, the containers run the tag's images:
`docker ps --format '{{.Names}} {{.Image}}' | grep '<production appName>'` lists `ghcr.io/alanshalem/blog-*:sha-<commit>`.

Then open `https://alanshalem.com/` and `/admin/`, sign in, and look at what you released. Something wrong →
[6. Rollback](#6-rollback).

## 5. Hotfix

Production is broken and the fix is small:

1. **[PC]** A pull request with the fix (section 2). After the merge, wait for the green CI and the staging deploy,
   and check the fix on staging: a hotfix that was never seen running is a guess.
2. Release it (section 3) with a new tag (`v2026.11.27.2`).

If the fix needs time, roll back first (section 6) and fix calmly.

## 6. Rollback

**Code** (the release broke the site, data is fine): deploy the previous tag. Its images are still in GHCR and the
compose files come from the same tag:

```bash
git tag --list 'v*' --sort=-creatordate | head -5                      # the previous release
gh workflow run deploy.yml -f environment=production -f ref=v2026.11.20
sleep 10
gh run watch "$(gh run list --workflow deploy.yml --event workflow_dispatch --json databaseId,displayTitle \
  -q "[.[] | select(.displayTitle == \"Deploy v2026.11.20 to production\")][0].databaseId")"
```

Or GitHub → Actions → Deploy → **Run workflow** → environment `production`, ref `v2026.11.20`. Production only takes
a tag; staging also takes a full 40-character commit SHA. Then fix forward on `master` and release a new tag. Tags
from before the images were published cannot be deployed this way (the workflow says so).

An old tag whose CI run GitHub already deleted (runs are kept for a limited time) still deploys this way: the plan
says "the green-run check is waived for this rollback" and deploys it only if its three images pull. A tag push
always needs the green run.

**Data** (a migration or an action damaged posts, settings or media): restore the backup of step 3.2 with `restore.sh`
([README "Rollback"](README.md#rollback)), after the code rollback. Everything written after that backup is lost, and
the admin signs in again.

## 7. Dependabot pull requests

Dependabot opens pull requests with updates every week.

1. **Patch and minor** updates merge by themselves once CI is green (`.github/workflows/dependabot-auto-merge.yml`);
   staging then deploys them (section 2).
2. **Majors** wait for you: read the changelog, check the CI run, merge (or close) by hand.
3. Check staging, then release as usual (section 3). Several merged updates can go out in one release.

## 8. If it fails

| Symptom | Cause | What to do |
| --- | --- | --- |
| A merge into `master`, no staging deploy | CI on `master` was red or cancelled by a newer push, or the commit had `[skip ci]` | Actions → CI: fix and merge again; a newer green run deploys |
| Deploy run green but skipped: "superseded by a newer master commit" | A newer commit of `master` has a CI run (a re-run of an older CI, or two merges close together) | Nothing: the newer commit deploys when its CI is green. To force an older commit: `gh workflow run deploy.yml -f environment=staging -f ref=<full sha>` |
| A tag's Deploy run shows as cancelled, never started | Another tag was pushed while it waited (one waiting run per environment, [rule 6](#1-how-it-works)) | Run it again for the tag you want ([6](#6-rollback)) |
| Deploy run fails in Plan: "has no green CI run on master" | The tag points at a `[skip ci]` commit (the profile bot) or at a commit whose CI failed | Tag the latest green commit instead (section 3, step 1 gives its SHA) |
| Deploy run fails in Plan: "does not exist" | Images missing for that commit (from before publishing, or its publish step failed) | Re-run that commit's CI, or tag the latest green commit |
| Deploy run fails in Plan: "cannot be read anonymously" | The GHCR packages are private (the first publish always is) | [10](#10-one-time-setup), step 1 |
| "… is not set in the staging environment" | A variable or the secret is missing from that GitHub environment | [10](#10-one-time-setup), step 3 |
| "Dokploy … answered 401" (or 403) | `DOKPLOY_API_KEY` is wrong, expired or revoked | New key in Dokploy, then `gh secret set DOKPLOY_API_KEY --env <environment>` ([10](#10-one-time-setup), step 2) |
| "Dokploy: error" | The deploy failed on the VPS | Dokploy → the environment → `blog` → **Deployments** → the entry named after the version: its log names the cause (rows below) |
| Dokploy log: `required variable IMAGE_TAG is missing a value` | The service's Environment tab lacks `IMAGE_TAG=${{environment.IMAGE_TAG}}`, or the environment has no `IMAGE_TAG` | [10](#10-one-time-setup), steps 4 and 5; run the workflow again |
| A deploy appears in Dokploy right after a merge, before CI ends | Auto Deploy is still on in that service: Dokploy's webhook deployed the head of `master` | [10](#10-one-time-setup), step 0: turn it off; run the workflow again |
| Dokploy log: `pull access denied`, `denied` or `unauthorized` from `ghcr.io` | The packages are not public | [10](#10-one-time-setup), step 1; run the workflow again |
| Dokploy log ends `container …-api-1 is unhealthy` | The API did not start: a bad environment value (for example a short `BUILDER_TOKEN`) or a failed migration | `blog` → **Logs** → `api`: the first error line names it; fix the Environment tab, run the workflow again |
| Dokploy log: `container …-caddy-1 is unhealthy` | Caddy refused its configuration (for example a `SITE_ENV` typo) | **Logs** → `caddy`; fix, run again. The domain answers 404 until then |
| "Dokploy did not finish within 15 minutes" | A deploy stuck in Dokploy's queue | Dokploy → Deployments: cancel or wait, then run the workflow again |
| Smoke test: production not 200 | The API is not ready (database) | `blog` → **Logs** → `api` |
| Smoke test: staging answered 200 | The domain lost its basic-auth middleware | Domains → the middleware chips ([vps-guide.md](vps-guide.md#95-domains)) |
| `Compose file not found` | The Compose Path is not `./infra/docker-compose.yml` | General → fix it → Save → reload → run again ([vps-guide.md](vps-guide.md#92-general)) |
| Every page answers 403 | The domain lost its proxy-secret middleware, or the secret differs from `PROXY_SECRET` | Domains → the middleware chips ([vps-guide.md](vps-guide.md#95-domains)) |

## 9. Branch protection

`master` accepts changes only through pull requests whose CI checks are all green (ruleset
"master: pull requests with green CI": squash merge only, no force push, no deletion). An admin may merge a pull
request without waiting for the checks in an emergency; nobody pushes straight to `master`. Such a merge still
reaches staging only once CI on `master` is green, and production only through a tag on a green commit.

- **Your changes:** `git switch -c feat/x` → commit → `git push -u origin feat/x` → `gh pr create --fill` →
  `gh pr merge --auto --squash` (merges by itself when CI is green; CI on `master` then deploys staging).
- **Dependabot:** patch and minor updates merge by themselves when CI is green
  (`.github/workflows/dependabot-auto-merge.yml`); majors wait for you.
- **The profile bot** pushes its daily commit straight to `master` with a deploy key, the only actor the ruleset
  lets through. Its commits carry `[skip ci]`: no CI, no images, no deploy. One-time setup, from the repo folder:

  ```bash
  ssh-keygen -t ed25519 -N "" -C profile-bot -f profile-bot
  gh repo deploy-key add profile-bot.pub --allow-write --title "profile bot (pushes to master)"
  gh secret set PROFILE_DEPLOY_KEY < profile-bot
  rm profile-bot profile-bot.pub
  ```

## 10. One-time setup

Once, after CI on `master` published the first images and **before the pull request that adds `deploy.yml` is
merged** (its merge is the first staging deploy). Until it is done, a run fails in Plan or at the first Dokploy call,
without touching the site.

0. **[Dokploy]** First, in both services (`staging` → `blog` and `production` → `blog`): General → **Auto Deploy**
   off → Save. Otherwise Dokploy's own webhook deploys on the merge too (the head of `master`, with whatever
   `IMAGE_TAG` it has) and races the workflow. The workflow keeps it off on every deploy afterwards.
1. **[GitHub]** Dokploy pulls the three packages (`blog-api`, `blog-builder`, `blog-caddy`) without credentials, so
   they must be public. Here they inherit the public visibility of this repository through the source label the CI
   adds (checked: an anonymous pull works). Check from your PC, logged out of `ghcr.io`:
   `docker manifest inspect ghcr.io/alanshalem/blog-api:sha-<a published commit>` prints a manifest. If it is denied:
   your profile → **Packages** → the package → **Package settings** → **Danger Zone** → **Change visibility** →
   **Public**.
2. **[Dokploy]** Settings → **Profile** → **API/CLI Keys** → **Generate New Key**.
3. **[PC]** The GitHub environments `staging` and `production`, each with four variables and the key (the secret is
   typed at the prompt, never on the command line). The ids below are this blog's services (they are not secrets);
   for another system, read them from its Dokploy service:

   ```bash
   for env in staging production; do gh api --method PUT "repos/alanshalem/alanshalem/environments/$env"; done
   gh variable set DOKPLOY_URL --env staging --body https://dokploy.alanshalem.com
   gh variable set DOKPLOY_COMPOSE_ID --env staging --body rJ1gLZv7yiJVFulGncoDa
   gh variable set DOKPLOY_ENVIRONMENT_ID --env staging --body pTJ3yuIorny1RwwmYTcqK
   gh variable set SITE_URL --env staging --body https://staging.alanshalem.com
   gh secret set DOKPLOY_API_KEY --env staging
   gh variable set DOKPLOY_URL --env production --body https://dokploy.alanshalem.com
   gh variable set DOKPLOY_COMPOSE_ID --env production --body ihqkCGvxQ01t-EBmCI_Qj
   gh variable set DOKPLOY_ENVIRONMENT_ID --env production --body xDSC06RKSxvaXiZJ1Kimc
   gh variable set SITE_URL --env production --body https://alanshalem.com
   gh secret set DOKPLOY_API_KEY --env production
   ```

4. **[Dokploy]** In each environment (`staging` and `production`), the environment's own variables (shared by its
   services, not a service's Environment tab): `IMAGE_TAG=sha-<a published commit>`. The workflow overwrites it on
   every deploy; the first value only keeps the next step's reference resolvable.
5. **[Dokploy]** In both services (`staging` → `blog` and `production` → `blog`), Environment tab: add this line as
   is and Save. Dokploy replaces it with the environment's `IMAGE_TAG` variable, which the workflow sets on every
   deploy (that variable list holds only this line; the workflow replaces it whole):

   ```bash
   IMAGE_TAG=${{environment.IMAGE_TAG}}
   ```

6. **Nothing to do for the branch or the command**: the workflow sets them on every deploy (and Auto Deploy off
   again).
7. **[PC]** First deploys: staging with the latest green commit, then production with a first tag (section 3):

   ```bash
   sha=$(gh run list --workflow CI --branch master --status success --limit 1 --json headSha -q '.[0].headSha')
   gh workflow run deploy.yml -f environment=staging -f ref="$sha"
   ```

   Then check staging and production as in [vps-guide.md 10.2](vps-guide.md#102-check-from-your-pc).
