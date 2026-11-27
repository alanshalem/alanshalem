# VPS guide: deploying alanshalem, wearemaking and ting on Dokploy

Step by step, for **production and staging** of the three systems that live on the VPS `srv2192513`. Follow the phases
in order. Every step is one action; every phase ends with a **Check** — do not start the next phase until it passes.
When something does not match, go to [If it fails](#14-if-it-fails).

This guide is the procedure. The reasons behind each piece (why a proxy secret, why `--wait`, why backups are not
Dokploy's Volume Backups) are in [docs/README.md "Operations (VPS)"](README.md#operations-vps); the compose override
is [`infra/compose.dokploy.yml`](../infra/compose.dokploy.yml) and the proxy gate is in
[`infra/caddy/Caddyfile`](../infra/caddy/Caddyfile).

**Status per system**

- **alanshalem** (`alanshalem.com`): live. Every step applies as written.
- **wearemaking** (`wearemaking.com.ar`) and **ting** (`ting.com.ar`): Phases 1–3 are shared by the whole VPS and
  already cover them. Phases 4–10 are per system and apply **once the app is dockerized** (task W4 for wearemaking,
  tasks T6/T7 for ting); their differences are in [section 15](#15-wearemaking-differences) and
  [section 16](#16-ting-differences).

## Conventions

| Placeholder | Meaning | Example (alanshalem) |
|---|---|---|
| `<app>` | System prefix, used in Traefik file and middleware names | `alanshalem` |
| `<env>` | `production` or `staging` | `staging` |
| `<domain>` | Domain of one environment | `staging.alanshalem.com` |
| `<appName>` | App Name Dokploy gives the service (General tab), one per environment | `alanshalem-blog-xvu8gq` |
| `<...PROXY_SECRET>` and similar | A secret value: take it from Bitwarden, never write it anywhere else | — |

Where each step runs:

- **[PC]** your Windows machine, in the repo root: PowerShell unless the step says **Git Bash**. Every `curl` and
  `ssh-keygen` check runs in Git Bash (PowerShell changes the quotes of native commands, and in Windows PowerShell
  `curl` is not curl).
- **[VPS]** a root shell on the server (`ssh vps`).
- **[Dokploy]** the Dokploy panel, `https://dokploy.alanshalem.com`.
- **[hPanel]** Hostinger's control panel. **[Cloudflare]** the Cloudflare dashboard.

**Secrets rule.** Secrets are generated on your PC, stored in Bitwarden, and pasted only into the Dokploy panel
(Environment tab, Traefik File System). Never in git, never in chat, never in a shell command line on the VPS.

## Contents

0. [Checklist before the first deploy](#0-checklist-before-the-first-deploy)
1. [The server](#1-the-server)
2. [Phase 1 — SSH access](#2-phase-1--ssh-access)
3. [Phase 2 — Hostinger firewall](#3-phase-2--hostinger-firewall)
4. [Phase 3 — Dokploy panel: domain and GitHub](#4-phase-3--dokploy-panel-domain-and-github)
5. [Phase 4 — DNS](#5-phase-4--dns)
6. [Phase 5 — Secrets](#6-phase-5--secrets)
7. [Phase 6 — Traefik middleware files](#7-phase-6--traefik-middleware-files)
8. [Phase 7 — Project and environments](#8-phase-7--project-and-environments)
9. [Phase 8 — Compose service (once per environment)](#9-phase-8--compose-service-once-per-environment)
10. [Phase 9 — First deploy and checks](#10-phase-9--first-deploy-and-checks)
11. [Phase 10 — Backups](#11-phase-10--backups)
12. [Release flow](#12-release-flow)
13. [Rollback](#13-rollback)
14. [If it fails](#14-if-it-fails)
15. [wearemaking differences](#15-wearemaking-differences)
16. [ting differences](#16-ting-differences)
17. [Reference: names per system](#17-reference-names-per-system)

## 0. Checklist before the first deploy

Tick every line for the system and environment you are about to deploy. Each line links to the phase that creates it.

**Once for the VPS**

- [ ] `ssh vps` opens a root shell with your key; password login is refused ([Phase 1](#2-phase-1--ssh-access)).
- [ ] Hostinger firewall allows only TCP 22/80/443, UDP 443 and ICMP ([Phase 2](#3-phase-2--hostinger-firewall)).
- [ ] `https://dokploy.alanshalem.com` opens the panel with a valid certificate
      ([Phase 3](#4-phase-3--dokploy-panel-domain-and-github)).
- [ ] The Dokploy GitHub App is installed with access to `alanshalem`, `ting` and `wearemaking`
      ([Phase 3](#4-phase-3--dokploy-panel-domain-and-github)).

**Once per system**

- [ ] DNS: `@` and `staging` (and `www` where used) resolve to `2.25.186.8`; on Cloudflare the cloud is grey
      ([Phase 4](#5-phase-4--dns)).
- [ ] Bitwarden holds, per environment: `PROXY_SECRET`, `BUILDER_TOKEN` (blog only), the admin password and its
      hash (blog only); for staging also the basic-auth password and its hash ([Phase 5](#6-phase-5--secrets)).
- [ ] `/etc/dokploy/traefik/dynamic/<app>-proxy-secret.yml` defines `<app>-production-proxy-secret` and
      `<app>-staging-proxy-secret` ([Phase 6](#7-phase-6--traefik-middleware-files)).
- [ ] `/etc/dokploy/traefik/dynamic/<app>-staging-auth.yml` defines `<app>-staging-auth`
      ([Phase 6](#7-phase-6--traefik-middleware-files)).
- [ ] `/etc/dokploy/traefik/dynamic/<app>-www.yml` exists if the system has a `www` record
      ([Phase 6](#7-phase-6--traefik-middleware-files)).
- [ ] `docker logs --since 5m dokploy-traefik` shows no `error` about those files
      ([Phase 6](#7-phase-6--traefik-middleware-files)).
- [ ] Dokploy project `<app>` with environments `production` and `staging`
      ([Phase 7](#8-phase-7--project-and-environments)).

**Once per environment**

- [ ] Compose service with Compose Path `./infra/docker-compose.yml` **saved** (reload the page and see it)
      ([Phase 8](#9-phase-8--compose-service-once-per-environment)).
- [ ] Advanced → Command set with this environment's `<appName>`; Isolated Deployments off.
- [ ] Environment tab filled and saved.
- [ ] Domain added with the middlewares shown as **chips**, not as typed text.

## 1. The server

Reference facts; nothing to do here.

| Item | Value |
|---|---|
| Provider / plan | Hostinger KVM 2, hostname `srv2192513` |
| Public IP | `2.25.186.8` |
| OS | Ubuntu 26.04 |
| Docker | Docker 29.10, Compose v5.8, Docker Swarm active |
| Dokploy | v0.31.4, panel on port 3000 (closed from the internet; reached through its domain) |
| Reverse proxy | Traefik v3.7.19 (container `dokploy-traefik`): owns 80/443 TCP+UDP, issues the certificates |
| Shared network | overlay `dokploy-network` (every Dokploy app is on it, including Paperclip) |
| Traefik dynamic files | `/etc/dokploy/traefik/dynamic/` (Dokploy → Traefik File System → `dynamic/`) |
| Code of a service | `/etc/dokploy/compose/<appName>/code` (re-cloned on every deploy; never edit it) |
| Emergency entry | Hostinger web console (hPanel → VPS → `srv2192513` → browser terminal) |

Each app's Caddy listens on `:80` inside `dokploy-network` and publishes no port. Traefik terminates TLS and forwards
plain HTTP to it, adding the header `X-Proxy-Secret`; Caddy answers 403 to any request without the right value.

## 2. Phase 1 — SSH access

The server accepts **keys only**. `/etc/ssh/sshd_config.d/00-hardening.conf` contains:

```text
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
```

fail2ban runs an `sshd` jail: 5 failures in 10 minutes → banned for 1 hour, longer for repeat offenders
(incremental). Two keys exist: yours (alias `vps`) and a separate, revocable key for automation (alias `vps-agent`).

### 2.1 Connect with the alias

1. **[PC]** Open `~/.ssh/config` (`C:\Users\<you>\.ssh\config`).
2. **[PC]** Make sure it has one block per key (file names are examples):

   ```text
   Host vps
     HostName 2.25.186.8
     User root
     IdentityFile ~/.ssh/id_ed25519_vps
     IdentitiesOnly yes

   Host vps-agent
     HostName 2.25.186.8
     User root
     IdentityFile ~/.ssh/id_ed25519_vps_agent
     IdentitiesOnly yes
   ```

3. **[PC]** Run `ssh vps`. You get a root prompt.

### 2.2 Add or rotate a key

Keep one working session open the whole time: if the new key fails, you still have a way in. Steps 2–4 run in
**Git Bash**.

1. **[PC]** Open a session that stays open: `ssh vps`.
2. **[PC]** In a second terminal, create the new key (choose a passphrase; store it in Bitwarden):
   `ssh-keygen -t ed25519 -C "<label, e.g. alan-laptop-2026>" -f ~/.ssh/<new key name>`
3. **[PC]** Append its public half to the server:
   `ssh vps 'cat >> ~/.ssh/authorized_keys' < ~/.ssh/<new key name>.pub`
4. **[PC]** Test it, forcing key-only login:
   `ssh -o PasswordAuthentication=no -o IdentitiesOnly=yes -i ~/.ssh/<new key name> root@2.25.186.8 true`
   It must return with no prompt and no error.
5. **[PC]** Point the `IdentityFile` of the alias in `~/.ssh/config` at the new key and run `ssh vps` again.
6. **Rotation only — [VPS]** Back up the file: `cp ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak`.
7. **Rotation only — [VPS]** Open `~/.ssh/authorized_keys` with `nano` and delete the line of the old key (it ends
   with the old key's `-C` label). Save.
8. **Rotation only — [PC]** Repeat step 4 with the new key, then close the session of step 1.

To **revoke the automation key** (`vps-agent`) at any moment: step 7 with its line.

### 2.3 Emergency entry

1. **[hPanel]** VPS → `srv2192513` → open the browser terminal (web console).
2. Log in as root with the root password stored in Bitwarden (the web console is not SSH: the hardening does not
   apply to it).
3. Fix `~/.ssh/authorized_keys` or unban your IP: `fail2ban-client set sshd unbanip <your public IP>`.

### Check

- **[PC]** `ssh vps true` returns with no prompt.
- **[PC]** `ssh -o PubkeyAuthentication=no root@2.25.186.8` answers `Permission denied (publickey)`.
- **[VPS]** `sshd -T | grep -Ei 'passwordauthentication|kbdinteractiveauthentication|permitrootlogin|maxauthtries'`
  prints `passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin prohibit-password` (some
  OpenSSH versions print its old name, `without-password`: the same setting) and `maxauthtries 3`.
- **[VPS]** `fail2ban-client status sshd` shows the jail running.

## 3. Phase 2 — Hostinger firewall

1. **[hPanel]** VPS → `srv2192513` → Security → Firewall.
2. Make sure the firewall group applied to the VPS has exactly these accept rules, and nothing else:

   | Protocol | Port | Source | Why |
   |---|---|---|---|
   | TCP | 22 | any | SSH |
   | TCP | 80 | any | HTTP (Let's Encrypt challenge, redirect to HTTPS) |
   | TCP | 443 | any | HTTPS |
   | UDP | 443 | any | HTTP/3 |
   | ICMP | — | any | ping |

3. Do **not** open 3000: the Dokploy panel is reached through `https://dokploy.alanshalem.com` (Phase 3).

### Check

- **[PC]** `Test-NetConnection 2.25.186.8 -Port 3000` → `TcpTestSucceeded : False`.
- **[PC]** `Test-NetConnection 2.25.186.8 -Port 443` → `TcpTestSucceeded : True`.

## 4. Phase 3 — Dokploy panel: domain and GitHub

Needs the `dokploy` DNS record of [Phase 4](#5-phase-4--dns) first (step 3 of 5.1). Until then the panel opens at
`https://dokploy.srv2192513.hstgr.cloud`, which keeps working afterwards too.

### 4.1 Panel domain

1. **[Dokploy]** Settings → Web Server.
2. Domain: `dokploy.alanshalem.com`.
3. HTTPS: on. Certificate Provider: Let's Encrypt (with your email for expiry notices).
4. Save.

### 4.2 GitHub App

1. **[Dokploy]** Settings → Git → GitHub → create the GitHub App (Dokploy opens GitHub for you).
2. **[GitHub]** Install the app on the `alanshalem` account.
3. Repository access: **Only select repositories** → `alanshalem`, `ting`, `wearemaking`.
4. Install. You return to Dokploy and the account appears under Settings → Git.

To add a repository later: GitHub → Settings → Applications → the Dokploy app → Configure → Repository access.

### Check

- **[PC]** `https://dokploy.alanshalem.com` opens the login page with a valid certificate (no browser warning).
- **[Dokploy]** Settings → Git lists the GitHub account; a new Compose service lists the three repositories.

## 5. Phase 4 — DNS

Records point at `2.25.186.8`. Do this before Phase 9: Traefik requests the certificate on the first request to the
domain, and it fails while the name points elsewhere.

### 5.1 alanshalem.com (Hostinger hPanel)

1. **[hPanel]** Domains → `alanshalem.com` → DNS / Nameservers → DNS records.
2. Delete the parking record: type `A`, name `@`, value `2.57.91.91`.
3. Add (TTL `300` for each):

   | Type | Name | Points to |
   |---|---|---|
   | A | `@` | `2.25.186.8` |
   | A | `staging` | `2.25.186.8` |
   | A | `dokploy` | `2.25.186.8` |
   | CNAME | `www` | `alanshalem.com` |

4. Leave any other record type (MX, TXT) as it is.

### 5.2 wearemaking.com.ar and ting.com.ar (Cloudflare)

Do this **at the cutover** of each system, not before: until then the current hosting serves these domains.

1. **[Cloudflare]** Select the domain → DNS → Records.
2. Add or edit (TTL Auto):

   | Type | Name | IPv4 address | Proxy status |
   |---|---|---|---|
   | A | `@` | `2.25.186.8` | **DNS only** (grey cloud) |
   | A | `staging` | `2.25.186.8` | **DNS only** (grey cloud) |

3. Click the cloud of each record until it is **grey** ("DNS only"). An orange cloud ("Proxied") must not stay on.
4. ting only, during the transition: also `A` `api` → `2.25.186.8`, DNS only ([section 16](#16-ting-differences)).

Why grey: Traefik obtains the Let's Encrypt certificate with an HTTP challenge, and every Caddy believes the client
IP that Traefik reports. With the orange cloud, Cloudflare answers the challenge path itself, it needs SSL/TLS mode
**Full (strict)**, and the client IP Traefik sees becomes a Cloudflare address (the login rate limit and the logs
would see Cloudflare, not the visitor). Do not turn the proxy on unless this guide and the trusted-proxy settings are
updated first.

### Check

- **[PC]** `Resolve-DnsName <domain> -Type A -Server 1.1.1.1` returns only `2.25.186.8` for each record above.
- **[PC]** `Resolve-DnsName www.alanshalem.com -Server 1.1.1.1` returns the CNAME to `alanshalem.com`.
- Changes can take up to the old TTL to show everywhere; with TTL 300, about 5 minutes.

## 6. Phase 5 — Secrets

Generate everything on your PC and save each value in Bitwarden, in one item per system and environment
(for example `alanshalem production`, `alanshalem staging`). **Production and staging never share a value.**

### 6.1 Random tokens (`PROXY_SECRET`, `BUILDER_TOKEN`)

1. **[PC]** In PowerShell, define the function once per session:

   ```powershell
   function New-Secret {
     $bytes = [byte[]]::new(32)
     [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
     -join ($bytes | ForEach-Object { $_.ToString('x2') })
   }
   ```

2. **[PC]** `New-Secret | Set-Clipboard` → paste into Bitwarden as `PROXY_SECRET` of this environment.
3. **[PC]** Again `New-Secret | Set-Clipboard` → Bitwarden as `BUILDER_TOKEN` of this environment (blog only).
4. Repeat steps 2–3 for the other environment.

The result is 64 hexadecimal characters, the same format as `openssl rand -hex 32` used in
[docs/README.md](README.md#dokploy-proxy-secret) (either works).

### 6.2 Staging basic-auth hash

1. **[PC]** Choose the staging password and save it in Bitwarden (user `staging`).
2. **[PC]** Run (Docker Desktop running; you type the password twice, without echo):
   `docker run --rm -it httpd:2.4-alpine htpasswd -nB staging`
3. Copy the output line `staging:$2y$05$...` into Bitwarden as `staging basic-auth hash`.

### 6.3 Blog admin password hash (alanshalem only)

1. **[PC]** Choose the admin password (12 characters or more) and save it in Bitwarden.
2. **[PC]** From the repo root: `docker build --tag blog-api apps/api`
3. **[PC]** `docker run --rm -it blog-api hash-password` → type the password (no echo).
4. Copy the output `pbkdf2-sha256$...` into Bitwarden as `ADMIN_PASSWORD_HASH` of this environment.
5. Repeat steps 1, 3 and 4 for the other environment, with a different password.

### Check

- Bitwarden has, for each environment: `PROXY_SECRET`, `BUILDER_TOKEN`, the admin password and
  `ADMIN_PASSWORD_HASH`; for staging also the basic-auth password and hash.
- `git status` on your PC shows no new file with any of those values.

## 7. Phase 6 — Traefik middleware files

Dokploy's **Traefik File System** can only **edit** existing files; it cannot create them. So each file is created
over SSH with harmless content, and the real content (with secrets) is pasted in the panel editor. That way secrets
never appear in a shell command or its history.

**YAML pitfall.** Every regex goes in **single quotes**. In double quotes, `\.` is an invalid escape: Traefik then
fails to read **the whole file provider** (`found unknown escape character`), and every `@file` middleware on the
VPS disappears at once (every site answers 403 or 404).

Traefik reloads these files on its own; no restart.

### 7.1 Create the empty files

1. **[PC]** `ssh vps`
2. **[VPS]** Create the three files with a placeholder (replace `<app>`; skip the `www` one if the system has no `www`):

   ```bash
   for f in proxy-secret staging-auth www; do
     cat > /etc/dokploy/traefik/dynamic/<app>-$f.yml <<'EOF'
   # placeholder: the real content is pasted in Dokploy → Traefik File System
   EOF
   done
   ```

3. **[VPS]** `ls -l /etc/dokploy/traefik/dynamic/` lists the new files.

### 7.2 Proxy secret (`<app>-proxy-secret.yml`)

1. **[Dokploy]** Traefik File System → `dynamic/` → `<app>-proxy-secret.yml`.
2. Replace the content with (values from Bitwarden, in double quotes):

   ```yaml
   http:
     middlewares:
       <app>-production-proxy-secret:
         headers:
           customRequestHeaders:
             X-Proxy-Secret: "<production PROXY_SECRET>"
       <app>-staging-proxy-secret:
         headers:
           customRequestHeaders:
             X-Proxy-Secret: "<staging PROXY_SECRET>"
   ```

3. Save.

### 7.3 Staging basic auth (`<app>-staging-auth.yml`)

1. **[Dokploy]** Traefik File System → `dynamic/` → `<app>-staging-auth.yml`.
2. Replace the content with (`$` stays as is in this file):

   ```yaml
   http:
     middlewares:
       <app>-staging-auth:
         basicAuth:
           removeHeader: true   # the app never sees the Authorization header
           users:
             - "staging:$2y$05$..."
   ```

3. Save.

### 7.4 www redirect (`<app>-www.yml`, alanshalem)

Traefik itself answers `www` with a permanent redirect to the apex; the request never reaches Caddy, so no proxy
secret is needed. For alanshalem:

1. **[Dokploy]** Traefik File System → `dynamic/` → `alanshalem-www.yml`.
2. Replace the content with:

   ```yaml
   http:
     routers:
       alanshalem-www-web:
         rule: Host(`www.alanshalem.com`)
         entryPoints:
           - web
         middlewares:
           - alanshalem-www-to-apex
         service: noop@internal
       alanshalem-www-websecure:
         rule: Host(`www.alanshalem.com`)
         entryPoints:
           - websecure
         middlewares:
           - alanshalem-www-to-apex
         service: noop@internal
         tls:
           certResolver: letsencrypt
     middlewares:
       alanshalem-www-to-apex:
         redirectRegex:
           regex: '^https?://www\.alanshalem\.com/(.*)'
           replacement: 'https://alanshalem.com/${1}'
           permanent: true
   ```

3. Save.

For another system, copy it with `<app>` and the domain changed (the dots of the domain escaped as `\.`, inside
single quotes).

### Check

- **[VPS]** `docker logs --since 5m dokploy-traefik 2>&1 | grep -i error` prints nothing about these files.
- **[PC]** `curl -I http://www.alanshalem.com/x` and `curl -I https://www.alanshalem.com/x` answer `301` or `308`
  with `Location: https://alanshalem.com/x` (the HTTPS one may take a minute while the certificate is issued).

## 8. Phase 7 — Project and environments

1. **[Dokploy]** Projects → Create Project. Name: `<app>` (e.g. `alanshalem`). Create.
2. Open the project. The environment selector shows `production`.
3. Environment selector → Create Environment → name `staging` → Create.

### Check

- The environment selector of the project lists `production` and `staging`.

## 9. Phase 8 — Compose service (once per environment)

Do this phase **twice**: once in `production`, once in `staging`. Nothing is shared between the two: each has its own
App Name, volumes, database, media, session keys and tokens. Values below are for alanshalem; see
[section 17](#17-reference-names-per-system) for the other systems.

### 9.1 Create the service

1. **[Dokploy]** Project `<app>` → environment selector → the environment (`production` or `staging`).
2. Create Service → Compose.
3. Name: `blog`. Compose type: **Docker Compose** (not Stack: Stack cannot `build`). Create.
4. Open the service. In General, note the **App Name** (e.g. `alanshalem-blog-xvu8gq`): it is this environment's
   `<appName>` everywhere below. Save it in the Bitwarden item of the environment (it is not a secret).

### 9.2 General

1. Provider: **GitHub**.
2. GitHub Account: the account of Phase 3. Repository: `alanshalem`. Branch: `master`.
3. Compose Path: `./infra/docker-compose.yml` (the default `./docker-compose.yml` is wrong).
4. Trigger Type: production **On Tag**; staging **On Push**.
5. Autodeploy: on.
6. Press **Save**.
7. **Reload the page (F5)** and read Compose Path again: it must show `./infra/docker-compose.yml`. If it shows
   `./docker-compose.yml`, the save did not happen; repeat steps 3, 6 and 7. (An unsaved Compose Path ends the deploy
   with `❌ Error: Compose file not found`.)

### 9.3 Advanced

1. Advanced → Command. Paste, with this environment's App Name in place of `<appName>` (one line; Dokploy puts
   `docker` in front and runs it from `code/`):

   ```text
   compose -p <appName> --env-file infra/.env -f infra/docker-compose.yml -f infra/compose.dokploy.yml up -d --build --remove-orphans --wait
   ```

2. Save.
3. Isolated Deployments: **off**.

### 9.4 Environment

1. Environment tab. Paste this environment's list, with the values from Bitwarden. Production:

   ```bash
   SITE_ADDRESS=:80
   SITE_URL=https://alanshalem.com
   BUILDER_TOKEN=<production BUILDER_TOKEN>
   ADMIN_PASSWORD_HASH='<production ADMIN_PASSWORD_HASH>'
   PROXY_SECRET=<production PROXY_SECRET>
   COMPOSE_FILE=docker-compose.yml:compose.dokploy.yml
   ```

   Staging:

   ```bash
   SITE_ADDRESS=:80
   SITE_URL=https://staging.alanshalem.com
   SITE_ENV=staging
   BUILDER_TOKEN=<staging BUILDER_TOKEN>
   ADMIN_PASSWORD_HASH='<staging ADMIN_PASSWORD_HASH>'
   PROXY_SECRET=<staging PROXY_SECRET>
   COMPOSE_FILE=docker-compose.yml:compose.dokploy.yml
   ```

2. Check each line against these rules before saving:
   - Production has **no** `SITE_ENV` line (the default is `production`).
   - `SITE_ENV` is exactly `staging` (lower case). Any other value stops Caddy and the deploy fails.
   - `ADMIN_PASSWORD_HASH` is inside **single quotes** (it contains `$`).
   - `PROXY_SECRET` is the same value as this environment's middleware in `<app>-proxy-secret.yml`.
   - `SITE_URL` starts with `https://` and has no trailing slash.
   - No `ACME_EMAIL`: Traefik requests the certificates.
3. Save.

### 9.5 Domains

1. Domains → Add Domain.
2. Service Name: `caddy`.
3. Host: `alanshalem.com` (production) or `staging.alanshalem.com` (staging).
4. Path: `/`. Container Port: `80`.
5. HTTPS: on. Certificate Provider: **Let's Encrypt**.
6. Middlewares: this field is a **tag input**. Type a name and press **Enter**: it must turn into a chip. Text that
   is typed but not turned into a chip is not saved (the domain then has no middleware, and Caddy answers 403 to
   everything).
   - Production: `alanshalem-production-proxy-secret@file`
   - Staging: `alanshalem-staging-proxy-secret@file`, then `alanshalem-staging-auth@file`
7. Look at the field: one chip per name, spelled exactly as above.
8. Save. A Compose service applies domain changes **on the next Deploy** (Phase 9).

### Check

- Reload the page: General shows Compose Path `./infra/docker-compose.yml`, the right branch and trigger.
- Advanced → Command shows this environment's `<appName>` (not the other environment's).
- Environment shows the list of 9.4 for this environment.
- Domains shows the host, `caddy`, port 80, HTTPS, and the middleware chips.

## 10. Phase 9 — First deploy and checks

### 10.1 Deploy

1. **[Dokploy]** The service (one environment) → General → **Deploy**.
2. Open Deployments → the running deployment → its log. Expected, in this order:
   - the clone of the branch and the image builds (several minutes the first time),
   - `init-permissions` runs once and **exits with 0**,
   - `api`, `caddy` and `builder` report **Healthy**, and the deploy ends as done.
3. Logs tab → `builder`: after the deploy it builds the site and logs `published: …` with the number of files
   precompressed.

A failed deploy is marked as an error and its log ends with `container <appName>-<service>-1 is unhealthy` (or
`exited`): open that service's Logs tab and go to [If it fails](#14-if-it-fails). Nothing is rolled back.

### 10.2 Check from your PC

Run each and compare with the expected result. For production use `alanshalem.com`; for staging the staging lines.

1. Production: `curl -I https://alanshalem.com/` → `302` to `/es/` or `/en/`.
2. Staging, no credentials: `curl -I https://staging.alanshalem.com/` → `401`.
3. Staging, with credentials: `curl -I -u staging https://staging.alanshalem.com/` → `302`, with
   `X-Robots-Tag: noindex, nofollow`.
4. Real client IP — a wrong login (staging: add `-u staging`):

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'X-Requested-With: blog-admin' -H 'Content-Type: application/json' -d '{"password":"wrong"}' https://alanshalem.com/api/auth/login
   ```

   → prints `401`. Then step 8 of 10.3.
5. Browser: open `https://<domain>/admin/` (`/admin`, without the trailing slash, redirects there with a `308`), sign
   in with this environment's admin password, create a post and publish it. It appears on the site after the build.

A page that does not exist answers `404` with the site's error page. Under `/es/` or `/en/` the URL picks its
language; without a language prefix (for example `/x` or `/admin-typo`) the browser does: English if the first
`Accept-Language` preference is English, otherwise Spanish (the same rule as the `302` of step 1).

### 10.3 Check on the VPS

6. **[VPS]** Nobody skips Traefik:

   ```bash
   docker run --rm --network dokploy-network curlimages/curl -s -o /dev/null -w '%{http_code}\n' http://<appName>-caddy-1/
   ```

   → prints `403`.
7. **[VPS]** The middlewares reached Caddy's router:
   `docker inspect --format '{{json .Config.Labels}}' <appName>-caddy-1` lists the middlewares of 9.5.
8. **[VPS]** The API sees your public IP:
   `docker logs --since 5m <appName>-api-1 2>&1 | grep 'Failed login'` → `Failed login from <your public IP>`.
   A private address (`10.…`, `172.…`) is wrong: see [If it fails](#14-if-it-fails).
9. **[VPS]** The env file names the project (backups need it):
   `grep -c '^COMPOSE_PROJECT_NAME=' /etc/dokploy/compose/<appName>/code/infra/.env` → `1`. If `0`, add
   `COMPOSE_PROJECT_NAME=<appName>` to the Environment tab and Deploy again.
10. **[VPS]** Resources: `docker stats --no-stream` — at rest, about api ~72 MB, builder ~39 MB, caddy ~14 MB.

### Check

All ten results above match, for this environment. Then repeat Phases 8–9 for the other environment.

## 11. Phase 10 — Backups

Details and the reasons are in [docs/README.md "Backups"](README.md#backups); this is the setup. One cron line per
environment, each with **its own `BACKUP_DIR`** (two environments in one folder would rotate each other's snapshots).

1. **[VPS]** Create the off-site remote once: `rclone config` → a remote for your storage (S3, B2, Drive…), then a
   **crypt** remote on top of it, named `secret`. Store the crypt passwords in Bitwarden: without them the off-site
   copy cannot be read. `backup.sh` refuses an unencrypted remote.
2. **[VPS]** Run a first backup by hand, per environment (production shown):

   ```bash
   BACKUP_DIR=/var/backups/alanshalem-production BACKUP_RCLONE_REMOTE=secret:alanshalem-production sh /etc/dokploy/compose/<appName>/code/infra/backup.sh
   ```

3. **[VPS]** `crontab -e` (root) and add one line per environment, at times with no deploys:

   ```cron
   15 3 * * * BACKUP_DIR=/var/backups/alanshalem-production BACKUP_RCLONE_REMOTE=secret:alanshalem-production sh /etc/dokploy/compose/<production appName>/code/infra/backup.sh >> /var/log/alanshalem-production-backup.log 2>&1
   45 3 * * * BACKUP_DIR=/var/backups/alanshalem-staging BACKUP_RCLONE_REMOTE=secret:alanshalem-staging sh /etc/dokploy/compose/<staging appName>/code/infra/backup.sh >> /var/log/alanshalem-staging-backup.log 2>&1
   ```

### Check

- **[VPS]** `ls /var/backups/alanshalem-production/daily` lists a snapshot named with the UTC date.
- **[VPS]** The dry run of the restore (no `--apply`) reports the snapshot sound and changes nothing:

  ```bash
  BACKUP_DIR=/var/backups/alanshalem-production sh /etc/dokploy/compose/<appName>/code/infra/restore.sh /var/backups/alanshalem-production/daily/<UTC>
  ```

- **[VPS]** `rclone lsd secret:alanshalem-production` lists the uploaded snapshot folders.
- The next morning, `/var/log/alanshalem-production-backup.log` ends without errors.

## 12. Release flow

The full step-by-step (everyday flow, release, verification, hotfix, rollback, Dependabot, failures):
[release-guide.md](release-guide.md). In short:

1. **[PC]** Push to `master` → staging deploys on its own (On Push). It does not wait for CI: check the GitHub
   Actions run is green before trusting staging. Commits with `[skip ci]` deploy nothing.
2. Review staging (`https://staging.alanshalem.com`, basic auth).
3. **[VPS]** Back up production (the only way back; see [Rollback](#13-rollback)):

   ```bash
   BACKUP_DIR=/var/backups/alanshalem-production BACKUP_RCLONE_REMOTE=secret:alanshalem-production sh /etc/dokploy/compose/<production appName>/code/infra/backup.sh
   ```

4. **[PC]** Tag the head of `master` that staging validated and push the tag:
   `git tag vYYYY.MM.DD && git push origin vYYYY.MM.DD` → production deploys (On Tag).
5. Do not push anything to `master` between step 4 and the start of the production deploy: **Dokploy deploys the
   head of the branch, not the tagged commit.**
6. Repeat the checks of [10.2](#102-check-from-your-pc) for production.

A tag on a commit whose message has `[skip ci]` (the daily profile commit) deploys nothing: press **Deploy** in the
production service instead.

A deploy that changes Caddy (Caddyfile, admin, its image or environment) leaves the domain without Caddy for about
5 seconds (Traefik answers 404 meanwhile). Other deploys keep the site up. Volumes are never touched by a deploy.

## 13. Rollback

There are no down migrations: going back means the previous code **and** the backup taken before the release.

1. **[PC]** Revert the release on `master` (`git revert <commit>…`), push (staging redeploys), check staging.
2. **[PC]** Tag and push as in [Release flow](#12-release-flow) step 4 → production deploys the previous code.
3. **[VPS]** Dry run of the restore (changes nothing):

   ```bash
   BACKUP_DIR=/var/backups/alanshalem-production sh /etc/dokploy/compose/<appName>/code/infra/restore.sh /var/backups/alanshalem-production/daily/<UTC>
   ```

4. **[VPS]** The same command with `--apply` at the end: it saves the current state in
   `BACKUP_DIR/pre-restore-<UTC>`, restores, waits for the healthchecks and requests a build.
5. Sign in to `/admin/` again: every restore logs the admin out (new session keys).

Whatever was published after that backup is lost (except in `pre-restore-<UTC>`).

## 14. If it fails

| Symptom | Cause | Fix |
|---|---|---|
| Deploy log ends with `❌ Error: Compose file not found` | Compose Path not saved; it is still `./docker-compose.yml` | [9.2](#92-general) steps 3, 6, 7: save, reload, confirm `./infra/docker-compose.yml`; Deploy |
| Every request answers `403` | Domain has no proxy-secret middleware (typed, not a chip), or its value differs from `PROXY_SECRET` | [9.5](#95-domains): add the chip; compare the value in `<app>-proxy-secret.yml` with the Environment tab; Deploy. Check with 10.3 step 7 |
| `404` from Traefik right after a deploy | Caddy is not healthy (e.g. `SITE_ENV` typo), so Traefik has no route | Logs tab → `caddy` (`File to import not found: site-env-...` = typo); fix the Environment tab; Deploy |
| `401` on staging with the right password | Wrong basic-auth hash, or user not `staging` | Regenerate ([6.2](#62-staging-basic-auth-hash)), paste in `<app>-staging-auth.yml` ([7.3](#73-staging-basic-auth-app-staging-authyml)) |
| Certificate not issued (browser warning, Traefik default cert) | DNS does not point at `2.25.186.8` yet, or Cloudflare proxy (orange cloud) is on | [Phase 4](#5-phase-4--dns) check; set grey cloud; wait for the TTL; reload the page |
| Every `@file` middleware gone at once (403/404 on all sites) | A Traefik dynamic file does not parse (e.g. a double-quoted regex) | `docker logs --since 10m dokploy-traefik 2>&1 \| grep -i error`; fix the named file, single quotes for regexes |
| `Failed login from 10.…` or `172.…` | The API sees a proxy address, not the visitor | Check `CADDY_TRUSTED_PROXIES` in `compose.dokploy.yml` and that Cloudflare's proxy is off |
| Admin rejects the right password | `$` of `ADMIN_PASSWORD_HASH` mangled (no single quotes) | Environment tab: single quotes around the hash; Deploy |
| `grep -c '^COMPOSE_PROJECT_NAME='` prints `0` | Dokploy did not write it | Add `COMPOSE_PROJECT_NAME=<appName>` to the Environment tab; Deploy |
| Deploy fails naming `PROXY_SECRET` (or another variable) | The variable is missing from the Environment tab | Add it ([9.4](#94-environment)); Deploy |
| `ssh vps` → `Permission denied (publickey)` | Wrong key, or your IP banned by fail2ban | `ssh -v vps` to see the key offered; [2.3](#23-emergency-entry) to unban |

## 15. wearemaking differences

> **Applies once the app is dockerized (task W4).** Until then wearemaking stays on its current hosting; do not
> change its Cloudflare records.

Same phases as above, with these differences:

- **What runs:** a static site served by **one Caddy service**. No API, no database, no builder, no admin.
- **Secrets (Phase 5):** only `PROXY_SECRET` per environment and the staging basic-auth hash. No `BUILDER_TOKEN`, no
  `ADMIN_PASSWORD_HASH`.
- **DNS (Phase 4):** Cloudflare, grey cloud ([5.2](#52-wearemakingcomar-and-tingcomar-cloudflare)).
- **Traefik files (Phase 6):** `wearemaking-proxy-secret.yml` (`wearemaking-production-proxy-secret`,
  `wearemaking-staging-proxy-secret`) and `wearemaking-staging-auth.yml` (`wearemaking-staging-auth`), exactly as in
  7.2 and 7.3. A `wearemaking-www.yml` only if a `www` record is added.
- **Service (Phase 8):** project `wearemaking`, repository `wearemaking`, branch `main`. Service name, Compose Path
  and Command: **to be filled by task W4**:

  | Field | Value |
  |---|---|
  | Service name | `<TBD W4>` |
  | Compose Path | `<TBD W4>` |
  | Command | `<TBD W4>` (same shape: `-p <appName>`, `--env-file`, both `-f` files, `up -d --build --remove-orphans --wait`) |

- **Environment (9.4):** to be filled by task W4. Expected shape:

  ```bash
  # production
  <TBD W4: variables of the wearemaking stack>
  PROXY_SECRET=<production PROXY_SECRET>
  # staging: the same plus
  SITE_ENV=staging
  ```

- **Staging:** basic auth in Traefik and `noindex` (header `X-Robots-Tag: noindex, nofollow` and a disallow-all
  `robots.txt`) the same way as the blog.
- **Checks (Phase 9):** 10.2 steps 1–3 (with `wearemaking.com.ar`), 10.3 steps 6, 7, 9, 10. No login, no admin.
- **Backups (Phase 10):** none needed while the site has no data on the server (the content is in git).

## 16. ting differences

> **Applies once the app is dockerized (tasks T6/T7).** Until the cutover, ting stays on Fly (API) and Neon
> (database); do not change its Cloudflare records before step 16.2.

### 16.1 Setup differences

- **What runs:** the site and the API on the **same origin**: `ting.com.ar` and `ting.com.ar/api`. Postgres runs
  inside the stack with **its own volume** and its own backup.
- **Domains:** production `ting.com.ar`; staging `staging.ting.com.ar`. During the transition also add
  `api.ting.com.ar` as a second domain of the production service (same middlewares), so old clients keep working.
- **Mercado Pago:** staging uses the **TEST** credentials; production the real ones. Never the other way round.
- **Secrets (Phase 5):** `PROXY_SECRET` per environment, the staging basic-auth hash, the Postgres password per
  environment, the Mercado Pago credentials per environment; the rest to be filled by tasks T6/T7.
- **Traefik files (Phase 6):** `ting-proxy-secret.yml`, `ting-staging-auth.yml` (names `ting-production-proxy-secret`,
  `ting-staging-proxy-secret`, `ting-staging-auth`).
- **Service (Phase 8):** project `ting`, repository `ting`, branch `main`:

  | Field | Value |
  |---|---|
  | Service name | `<TBD T6/T7>` |
  | Compose Path | `<TBD T6/T7>` |
  | Command | `<TBD T6/T7>` (same shape as 9.3) |

- **Environment (9.4):** to be filled by tasks T6/T7. Expected shape:

  ```bash
  # production
  <TBD T6/T7: variables of the ting stack (site URL, Postgres, DataProtection, Mercado Pago live credentials)>
  PROXY_SECRET=<production PROXY_SECRET>
  # staging: the same with the Mercado Pago TEST credentials, plus
  SITE_ENV=staging
  ```

- **Backups (Phase 10):** one cron line per environment for the stack's backup script, plus the Postgres dump (to be
  defined by T6/T7), each with its own `BACKUP_DIR` and crypt remote path.

### 16.2 Cutover (production, once)

Do it in a quiet hour. Keep Fly and Neon running until step 9 passes.

1. Deploy and check **staging** completely (Phase 9) with the TEST credentials.
2. Deploy production on the VPS (Phase 9) with an empty database; do not point DNS yet.
3. **DataProtection keys:** copy the key files from the Fly volume into the production stack's key volume (exact
   commands: T6/T7), so existing sessions and protected data stay readable.
4. Put the current app in maintenance (or stop writes) so the database stops changing.
5. **Database:** `pg_dump` the Neon database (custom format, `-Fc`) on your PC, copy the file to the VPS and
   `pg_restore` it into the stack's Postgres (exact commands: T6/T7). Delete the dump file from your PC and the VPS
   afterwards: it holds customer data.
6. **[Cloudflare]** Point `@`, `staging` and `api` at `2.25.186.8`, grey cloud
   ([5.2](#52-wearemakingcomar-and-tingcomar-cloudflare)).
7. **[Mercado Pago panel]** Update the **webhook URL** and the **OAuth redirect URL** to the `ting.com.ar/api/...`
   addresses (exact paths: T6/T7). For staging, the same in the TEST application with `staging.ting.com.ar`.
8. Run the checks: 10.2 and 10.3 with `ting.com.ar`, a TEST payment on staging, a sign-in on production.
9. Watch production for some days (logs, payments, webhooks).
10. Only after step 9: remove `api.ting.com.ar` when no client uses it, shut down Fly, and **delete the Neon project**
    last.

## 17. Reference: names per system

| | alanshalem | wearemaking | ting |
|---|---|---|---|
| Status | live | after W4 | after T6/T7 |
| GitHub repository | `alanshalem/alanshalem` | `alanshalem/wearemaking` | `alanshalem/ting` |
| Branch | `master` | `main` | `main` |
| Dokploy project / `<app>` | `alanshalem` | `wearemaking` | `ting` |
| Service name | `blog` | `<TBD W4>` | `<TBD T6/T7>` |
| Compose Path | `./infra/docker-compose.yml` | `<TBD W4>` | `<TBD T6/T7>` |
| Production domain | `alanshalem.com` (+ `www` redirect) | `wearemaking.com.ar` | `ting.com.ar` (+ `api.ting.com.ar` alias) |
| Staging domain | `staging.alanshalem.com` | `staging.wearemaking.com.ar` | `staging.ting.com.ar` |
| DNS | Hostinger hPanel | Cloudflare (grey cloud) | Cloudflare (grey cloud) |
| Production middlewares | `alanshalem-production-proxy-secret@file` | `wearemaking-production-proxy-secret@file` | `ting-production-proxy-secret@file` |
| Staging middlewares | `alanshalem-staging-proxy-secret@file`, `alanshalem-staging-auth@file` | `wearemaking-staging-proxy-secret@file`, `wearemaking-staging-auth@file` | `ting-staging-proxy-secret@file`, `ting-staging-auth@file` |
| Data to back up | SQLite + media | none | Postgres + `<TBD T6/T7>` |
| Trigger | production On Tag, staging On Push | same | same |
