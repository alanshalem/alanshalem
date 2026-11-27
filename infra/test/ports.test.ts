import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Each service port is written in files that cannot import each other (Dockerfiles, C#, TypeScript, the Caddyfile and
// the compose files): these guards fail when one of them changes alone. The real check is bringing the stack up.
const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** The port captured by `pattern` (first group) in `text`; fails naming `where` when it is not there. */
function port(text: string, pattern: RegExp, where: string): string {
  const found = pattern.exec(text)?.[1];
  assert.ok(found, `no port found in ${where}`);
  return found;
}

/** The text of the Dockerfile stage `name`, from its FROM line to the next FROM. */
function stage(dockerfile: string, name: string): string {
  const start = dockerfile.search(new RegExp(`^FROM .* AS ${name}$`, 'm'));
  assert.ok(start >= 0, `no stage ${name}`);
  const next = dockerfile.indexOf('\nFROM ', start + 1);
  return dockerfile.slice(start, next < 0 ? undefined : next);
}

const apiDockerfile = read('apps/api/Dockerfile');
const prod = read('infra/docker-compose.yml');
const dev = read('infra/compose.dev.yml');

describe('API port', () => {
  it('production: the runtime image, its own healthcheck, Caddy and the builder use the same port', () => {
    const runtime = stage(apiDockerfile, 'runtime');
    const listens = port(runtime, /ASPNETCORE_URLS=http:\/\/\+:(\d+)\b/, 'apps/api/Dockerfile (runtime ASPNETCORE_URLS)');
    assert.equal(port(runtime, /^EXPOSE (\d+)$/m, 'apps/api/Dockerfile (runtime EXPOSE)'), listens);
    assert.equal(
      port(read('apps/api/src/Blog.Api/Cli/HealthCheckCommand.cs'), /"http:\/\/localhost:(\d+)\/api\/health\/ready"/, 'HealthCheckCommand.cs'),
      listens,
    );
    assert.equal(port(read('infra/caddy/Caddyfile'), /^\s*reverse_proxy api:(\d+) \{$/m, 'infra/caddy/Caddyfile'), listens);
    assert.equal(port(prod, /^\s+API_URL: http:\/\/api:(\d+)$/m, 'infra/docker-compose.yml (builder API_URL)'), listens);
  });

  it('dev: the dev image, the URL the admin and site use, and the published container port agree', () => {
    const listens = port(stage(apiDockerfile, 'dev'), /ASPNETCORE_URLS=http:\/\/\+:(\d+)\b/, 'apps/api/Dockerfile (dev ASPNETCORE_URLS)');
    assert.equal(port(dev, /^\s+API_URL: http:\/\/api:(\d+)$/m, 'infra/compose.dev.yml (API_URL)'), listens);
    assert.equal(port(dev, /^\s+- "127\.0\.0\.1:\$\{API_PORT:-\d+\}:(\d+)"$/m, 'infra/compose.dev.yml (api ports)'), listens);
  });
});

describe('builder port', () => {
  it('the builder default, its image and the URL the API calls agree', () => {
    const listens = port(read('apps/builder/src/config.ts'), /^const DEFAULT_PORT = (\d+);$/m, 'apps/builder/src/config.ts');
    assert.equal(port(read('apps/builder/Dockerfile'), /^EXPOSE (\d+)$/m, 'apps/builder/Dockerfile (EXPOSE)'), listens);
    assert.equal(port(prod, /^\s+Builder__Url: http:\/\/builder:(\d+)$/m, 'infra/docker-compose.yml (Builder__Url)'), listens);
  });
});
