import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Regression guards over the compose files and the Dockerfiles. They are textual (no dependencies, no Docker): the real
// validation is `docker compose config -q` and bringing the local copy up (skill docker-and-deploy).
const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const exists = (path: string): boolean => existsSync(new URL(`../../${path}`, import.meta.url));

const prod = read('infra/docker-compose.yml');
const dev = read('infra/compose.dev.yml');
const dokploy = exists('infra/compose.dokploy.yml') ? read('infra/compose.dokploy.yml') : '';
/** The services CI builds, scans and publishes to GHCR (ci.yml, images job). */
const published = ['api', 'builder', 'caddy'];

/** Meaningful lines (no comments or blank lines), with their indentation. */
const lines = (text: string): string[] => text.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
const indent = (line: string): number => line.length - line.trimStart().length;

/** The YAML block that starts at the `key:` line with that indentation (without the key line), as text. */
function block(text: string, key: string, depth = 0): string {
  const all = lines(text);
  const start = all.findIndex((line) => indent(line) === depth && line.trim().startsWith(`${key}:`));
  assert.ok(start >= 0, `missing ${key}`);
  const body: string[] = [];
  for (const line of all.slice(start + 1)) {
    if (indent(line) <= depth) break;
    body.push(line);
  }
  return body.join('\n');
}

/** Service names of a compose file. */
const services = (text: string): string[] =>
  lines(block(text, 'services'))
    .filter((line) => indent(line) === 2)
    .map((line) => line.trim().replace(/:$/, ''));
const service = (text: string, name: string): string => block(block(text, 'services'), name, 2);

describe('docker-compose.yml (VPS)', () => {
  const all = services(prod);

  it('has the four services', () => {
    assert.deepEqual(all, ['init-permissions', 'caddy', 'api', 'builder']);
  });

  it('Docker logs are capped (local driver, 5 × 10 MB) and every service uses it', () => {
    assert.match(block(prod, 'x-logging'), /driver: local\n\s+options:\n\s+max-size: 10m\n\s+max-file: "5"/);
    assert.match(block(prod, 'x-service'), /logging: \*logging/);
    for (const name of all) assert.match(service(prod, name), /<<: \*service/, name);
  });

  it('common hardening: no-new-privileges, no capabilities and a process cap', () => {
    const common = block(prod, 'x-service');
    assert.match(common, /security_opt:\n\s+- no-new-privileges:true/);
    assert.match(common, /cap_drop:\n\s+- ALL/);
    assert.match(common, /pids_limit: \d+/);
  });

  it('API and builder with their own measured process cap (not the common one)', () => {
    for (const name of ['api', 'builder']) assert.match(service(prod, name), /^\s+pids_limit: \d+$/m, name);
  });

  it('each service adds only the capabilities it needs', () => {
    const capAdd = (name: string): string[] => {
      const text = service(prod, name);
      if (!/cap_add:/.test(text)) return [];
      return lines(block(text, 'cap_add', 4)).map((line) => line.trim().replace(/^- /, ''));
    };
    assert.deepEqual(capAdd('caddy'), ['NET_BIND_SERVICE']);
    assert.deepEqual(capAdd('init-permissions'), ['CHOWN', 'DAC_OVERRIDE']);
    assert.deepEqual(capAdd('api'), []);
    assert.deepEqual(capAdd('builder'), []);
  });

  it('API, Caddy and init-permissions with a read-only filesystem; API and Caddy with /tmp in memory', () => {
    for (const name of ['api', 'caddy', 'init-permissions']) assert.match(service(prod, name), /read_only: true/, name);
    for (const name of ['api', 'caddy']) assert.match(block(service(prod, name), 'tmpfs', 4), /- \/tmp\b/, name);
  });

  it('the API temporary files (uploads, libvips) go to the /data volume and not to the container RAM', () => {
    assert.match(prod, /^x-api-tmp: &api-tmp \/data\/tmp$/m);
    const api = service(prod, 'api');
    assert.match(api, /ASPNETCORE_TEMP: \*api-tmp/);
    assert.match(api, /TMPDIR: \*api-tmp/);
    assert.match(api, /- api_data:\/data$/m);
    // init-permissions creates the folder before the API starts (ASP.NET does not create it).
    assert.match(service(prod, 'init-permissions'), /mkdir -p \/data\/tmp/);
  });

  it('init-permissions only changes the owner of what has another one (no recursive chown of all the media on every up)', () => {
    const init = service(prod, 'init-permissions');
    assert.doesNotMatch(init, /chown -R/);
    assert.match(init, /find \/data \/media \\\( ! -user 1654 -o ! -group 1654 \\\) -exec chown -h 1654:1654 \{\} \+/);
    assert.match(init, /find \/site \\\( ! -user 1000 -o ! -group 1000 \\\) -exec chown -h 1000:1000 \{\} \+/);
  });

  it('real healthchecks: the API with its healthcheck command-line mode and the builder with its script, no curl', () => {
    assert.match(service(prod, 'api'), /test: \["CMD", "dotnet", "Blog\.Api\.dll", "healthcheck"\]/);
    assert.match(service(prod, 'builder'), /test: \["CMD", "node", "src\/healthcheck\.ts"\]/);
    assert.ok(exists('apps/builder/src/healthcheck.ts'));
    // The healthchecks' relative paths depend on each image's WORKDIR.
    assert.match(read('apps/api/Dockerfile'), /WORKDIR \/app\n[\s\S]*ENTRYPOINT \["dotnet", "Blog\.Api\.dll"\]/);
    assert.match(read('apps/builder/Dockerfile'), /WORKDIR \/app\/apps\/builder\nCMD \["node", "src\/server\.ts"\]/);
    for (const name of ['api', 'builder']) assert.match(service(prod, name), /<<: \*healthcheck/, name);
    assert.match(block(prod, 'x-healthcheck'), /start_period: \d+s\n\s+start_interval: 2s/);
  });

  it('Caddy has a healthcheck on its own admin endpoint, inside the container: `up --wait` fails when its config does not load', () => {
    // A SITE_ENV typo stops Caddy at once; without a healthcheck `up --wait` saw it running for an instant and passed.
    // The admin endpoint does not depend on the API (the static site never waits for it) and skips the proxy gate.
    const caddy = service(prod, 'caddy');
    assert.match(caddy, /<<: \*healthcheck/);
    assert.match(caddy, /test: \["CMD", "wget", "-q", "-O", "\/dev\/null", "http:\/\/127\.0\.0\.1:2019\/config\/"\]/);
    // Caddy's default admin address (localhost:2019): never moved to an address other containers reach.
    assert.doesNotMatch(read('infra/caddy/Caddyfile'), /^\s*admin\b/m);
    // Never published, never moved: no `:2019` mapping or `2019:` port anywhere, no CADDY_ADMIN override.
    for (const text of [prod, dokploy, read('infra/compose.local.yml')]) {
      assert.doesNotMatch(lines(text).join('\n'), /["'\s-]2019:|:2019["'\s]|CADDY_ADMIN/);
    }
  });

  it('the builder waits for a healthy API; Caddy only for it to start (an unhealthy API does not take the site down)', () => {
    assert.match(block(service(prod, 'builder'), 'depends_on', 4), /api:\n\s+condition: service_healthy$/m);
    assert.match(block(service(prod, 'caddy'), 'depends_on', 4), /^\s+api:\n\s+condition: service_started\n\s+required: false$/);
  });

  it('API logs in JSON', () => {
    assert.match(service(prod, 'api'), /Logging__Console__FormatterName: json/);
  });

  it('the ACME email is optional: Caddy gets the whole option or nothing', () => {
    assert.match(service(prod, 'caddy'), /CADDY_ACME_EMAIL: \$\{ACME_EMAIL:\+email \$\{ACME_EMAIL\}\}/);
    // First in the global options (the rest of the block: infra/test/caddy.test.ts).
    assert.match(read('infra/caddy/Caddyfile'), /^\{\n\t\{\$CADDY_ACME_EMAIL\}\n/m);
  });

  it('no SITE_NAME / SITE_TAGLINE / SITE_AUTHOR: the site reads them from the API', () => {
    for (const text of [prod, dev, read('infra/compose.local.yml')]) assert.doesNotMatch(text, /SITE_(NAME|TAGLINE|AUTHOR)/);
  });

  it('the init-permissions image is pinned by digest', () => {
    assert.match(service(prod, 'init-permissions'), /image: busybox:[\d.]+@sha256:[0-9a-f]{64}/);
  });

  it('the builder token is written once (anchor) and fails fast when missing, for both the API and the builder', () => {
    assert.match(prod, /^x-builder-token: &builder-token \$\{BUILDER_TOKEN:\?[^}]+\}$/m);
    assert.match(service(prod, 'api'), /^\s+Builder__Token: \*builder-token$/m);
    assert.match(service(prod, 'builder'), /^\s+BUILDER_TOKEN: \*builder-token$/m);
  });

  it('a VPS without Dokploy keeps Caddy on 80/443 (TCP and UDP) and its TLS address from .env', () => {
    const ports = lines(block(service(prod, 'caddy'), 'ports', 4)).map((line) => line.trim().replace(/\s+#.*$/, ''));
    assert.deepEqual(ports, ['- "80:80"', '- "443:443"', '- "443:443/udp"']);
    assert.match(service(prod, 'caddy'), /^\s+SITE_ADDRESS: \$\{SITE_ADDRESS:\?[^}]+\}$/m);
  });

  it('the site environment reaches Caddy and is production unless set (staging turns indexing off)', () => {
    assert.match(block(service(prod, 'caddy'), 'environment', 4), /^\s+SITE_ENV: \$\{SITE_ENV:-production\}$/m);
  });

  it('Caddy trusts no forwarding proxy by default: only the Dokploy override sets one', () => {
    assert.doesNotMatch(prod, /CADDY_TRUSTED_PROXIES/);
    assert.doesNotMatch(prod, /dokploy-network/);
  });

  it('still builds api, builder and caddy from source (local dev, the local copy and a plain VPS build them)', () => {
    for (const name of published) {
      assert.match(service(prod, name), /^ {4}build:$/m, name);
      assert.doesNotMatch(service(prod, name), /^\s+(image|pull_policy):/m, name);
    }
    // The local copy builds them too: it never names a published image.
    assert.doesNotMatch(read('infra/compose.local.yml'), /ghcr\.io|IMAGE_TAG|pull_policy|build: !reset/);
  });
});

describe('compose.dokploy.yml (behind Dokploy and its Traefik)', () => {
  it('overrides only the three services CI publishes as images', () => {
    assert.deepEqual([...services(dokploy)].sort(), [...published].sort());
  });

  it('api, builder and caddy run the images CI published for IMAGE_TAG, never a build on the VPS', () => {
    for (const name of published) {
      const text = service(dokploy, name);
      assert.match(text, /^ {4}build: !reset null$/m, name);
      assert.match(text, new RegExp(`^ {4}image: ghcr\\.io/alanshalem/blog-${name}:\\$\\{IMAGE_TAG:\\?[^}]+\\}$`, 'm'), name);
      // Dokploy never pulls by itself: compose pulls a tag it does not have yet; a tag is never repointed.
      assert.match(text, /^ {4}pull_policy: missing$/m, name);
    }
  });

  it('a missing IMAGE_TAG stops the deploy with a message that names the release guide', () => {
    const messages = new Set([...dokploy.matchAll(/\$\{IMAGE_TAG:\?([^}]+)\}/g)].map((m) => m[1]));
    assert.equal(messages.size, 1, 'one message for the three images');
    const [message] = [...messages];
    assert.match(message!, /docs\/release-guide\.md/);
    assert.ok(exists('docs/release-guide.md'));
  });

  it('CI runs the real compose on the override: images with a placeholder IMAGE_TAG, and a refusal without one', () => {
    const ci = read('.github/workflows/ci.yml');
    assert.match(ci, /IMAGE_TAG=sha-ci-placeholder docker compose -f docker-compose\.yml -f compose\.dokploy\.yml config/);
    // The refusal must be the one for IMAGE_TAG, not any other compose error.
    assert.match(ci, /if errors=\$\(docker compose -f docker-compose\.yml -f compose\.dokploy\.yml config -q 2>&1\); then/);
    assert.match(ci, /grep -q 'required variable IMAGE_TAG is missing a value' <<<"\$errors"/);
  });

  it('Caddy publishes no port: Traefik owns 80/443 on the VPS', () => {
    assert.match(service(dokploy, 'caddy'), /^\s+ports: !reset \[\]$/m);
  });

  it('Caddy answers plain HTTP on :80 and never requests certificates (Traefik terminates TLS)', () => {
    assert.match(block(service(dokploy, 'caddy'), 'environment', 4), /^\s+SITE_ADDRESS: ":80"$/m);
  });

  it('Caddy believes the X-Forwarded-* that Traefik sends (private ranges only), so the API sees the visitor', () => {
    assert.match(
      block(service(dokploy, 'caddy'), 'environment', 4),
      /^\s+CADDY_TRUSTED_PROXIES: trusted_proxies static private_ranges$/m,
    );
  });

  it('Caddy requires the proxy secret Traefik adds (from Dokploy\'s Environment, never in git): the deploy fails without it', () => {
    assert.match(block(service(dokploy, 'caddy'), 'environment', 4), /^\s+PROXY_SECRET: \$\{PROXY_SECRET:\?[^}]+\}$/m);
    // Only the Dokploy override: on a plain VPS Caddy is the edge and there is no proxy to hold a secret.
    assert.doesNotMatch(prod, /PROXY_SECRET/);
    // The header the README tells Traefik to add is the one the Caddyfile requires.
    assert.match(read('infra/caddy/Caddyfile'), /\{header\.X-Proxy-Secret\}/);
    assert.match(read('docs/README.md'), /^ +customRequestHeaders:\n +X-Proxy-Secret: "/m);
  });

  it('Caddy joins the external dokploy-network and keeps the private network it shares with the API', () => {
    const networks = lines(block(service(dokploy, 'caddy'), 'networks', 4)).map((line) => line.trim());
    assert.deepEqual(networks, ['- default', '- dokploy-network']);
    assert.match(block(dokploy, 'networks'), /^ {2}dokploy-network:\n {4}external: true$/m);
  });

  it('the Dokploy command in its header is the one the README runbook and the skill give', () => {
    const command = /^# {3}(compose -p <appName> .+)$/m.exec(dokploy)?.[1];
    assert.ok(command, 'missing the Dokploy command in the header');
    // --wait: the deploy fails when a container does not start or a healthcheck does not pass (a SITE_ENV typo stops
    // Caddy), instead of reporting success as soon as the containers are created.
    // No --build: the images come from GHCR, built and scanned once by CI.
    assert.match(command, / --env-file infra\/\.env -f infra\/docker-compose\.yml -f infra\/compose\.dokploy\.yml up -d --remove-orphans --wait$/);
    assert.doesNotMatch(command, /--build/);
    assert.ok(read('docs/README.md').includes(command), 'docs/README.md must give the same command');
    assert.ok(read('docs/vps-guide.md').includes(command), 'docs/vps-guide.md must give the same command');
    assert.ok(read('.agents/skills/docker-and-deploy/SKILL.md').includes(command), 'the docker-and-deploy skill must give the same command');
    // The deploy workflow writes the same command into the service on every deploy, with the App Name it reads.
    assert.ok(
      read('.github/workflows/deploy.yml').includes(command.replace('<appName>', '$app_name')),
      '.github/workflows/deploy.yml must set the same command',
    );
    // Nowhere does the documented Dokploy command still build.
    for (const path of ['docs/README.md', 'docs/vps-guide.md', '.agents/skills/docker-and-deploy/SKILL.md']) {
      assert.doesNotMatch(read(path), /compose -p <appName> .* --build/, path);
    }
  });

  it('the runbook section its header names exists in the README', () => {
    const section = /Runbook: docs\/README\.md, section "([^"]+)"/.exec(dokploy.replace(/\n# /g, ' '))?.[1];
    assert.ok(section, 'missing the runbook section in the header');
    assert.match(read('docs/README.md'), new RegExp(`^#{2,3} ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  });
});

describe('compose.dev.yml', () => {
  it('capped logs on every service (directly or through the x-node anchor)', () => {
    assert.match(block(dev, 'x-node'), /logging: \*logging/);
    assert.match(block(dev, 'x-logging'), /driver: local/);
    for (const name of services(dev)) assert.match(service(dev, name), /logging: \*logging|<<: \*node/, name);
  });

  it('the same log cap as production (compose cannot share an anchor between files)', () => {
    assert.equal(block(dev, 'x-logging'), block(prod, 'x-logging'));
  });
});

describe('Dockerfiles', () => {
  const dockerfiles = ['apps/api/Dockerfile', 'apps/builder/Dockerfile', 'infra/caddy/Dockerfile'];
  /** Image of each FROM, with the ARGs resolved. */
  const bases = (text: string): string[] => {
    const args = Object.fromEntries([...text.matchAll(/^ARG (\w+)=(\S+)$/gm)].map((m) => [m[1], m[2]]));
    const stages = new Set([...text.matchAll(/^FROM .* AS (\S+)$/gm)].map((m) => m[1]));
    return [...text.matchAll(/^FROM (\S+)/gm)]
      .map((m) => m[1]!.replace(/^\$\{(\w+)\}$/, (_, name: string) => args[name] ?? name))
      .filter((image) => !stages.has(image));
  };

  it('every base image is pinned by digest', () => {
    for (const path of dockerfiles) {
      const images = bases(read(path));
      assert.ok(images.length > 0, path);
      for (const image of images) assert.match(image, /^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/, `${path}: ${image}`);
    }
  });

  it('the same Node in the builder and in the Caddy image (which builds the admin)', () => {
    const node = (path: string): string | undefined => /^ARG NODE_IMAGE=(\S+)$/m.exec(read(path))?.[1];
    assert.ok(node('apps/builder/Dockerfile'));
    assert.equal(node('infra/caddy/Dockerfile'), node('apps/builder/Dockerfile'));
  });

  it('the builder image has no package managers and installs only production dependencies', () => {
    const builder = read('apps/builder/Dockerfile');
    const runtime = builder.slice(builder.lastIndexOf('\nFROM '));
    assert.match(runtime, /rm -rf \/usr\/local\/lib\/node_modules/);
    assert.match(runtime, /\/usr\/local\/bin\/npm /);
    assert.doesNotMatch(runtime, /pnpm|corepack enable/);
    assert.match(builder, /pnpm install --frozen-lockfile --prod /);
    // Without pnpm in the image, the build runs the binary from node_modules.
    assert.match(read('apps/builder/src/build.ts'), /'node_modules\/\.bin\/astro', 'build'/);
  });

  it('the admin is precompressed with the builder script, not with inline code', () => {
    const caddy = read('infra/caddy/Dockerfile');
    assert.match(caddy, /^RUN node apps\/builder\/src\/precompress\.ts apps\/admin\/dist$/m);
    assert.doesNotMatch(caddy, /node .*-e /);
  });
});

describe('package.json', () => {
  const pkg = JSON.parse(read('package.json')) as { packageManager: string; engines: { node: string }; scripts: Record<string, string> };

  it('pnpm ≥ 10.34.5 (earlier versions have CVEs) and Node ≥ 22.18 (runs .ts without compiling)', () => {
    const [, major, minor, patch] = /^pnpm@(\d+)\.(\d+)\.(\d+)$/.exec(pkg.packageManager)!.map(Number);
    assert.ok(major! > 10 || (major === 10 && (minor! > 34 || (minor === 34 && patch! >= 5))), pkg.packageManager);
    assert.equal(pkg.engines.node, '>=22.18');
  });

  it('`pnpm test` includes these tests', () => {
    assert.equal(pkg.scripts['test:infra'], 'node --test "infra/test/*.test.ts"');
    assert.match(pkg.scripts.test!, /pnpm test:infra/);
  });
});
