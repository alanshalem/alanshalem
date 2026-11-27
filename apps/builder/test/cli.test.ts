import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// The builder's command-line scripts are tested the way Docker uses them: a separate process, checking the exit code
// and what it prints.
const script = (name: string): string => fileURLToPath(new URL(`../src/${name}`, import.meta.url));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(name: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((resolve) => {
    execFile(process.execPath, [script(name), ...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
}

describe('precompress.ts (precompresses the admin when building the Caddy image)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blog-precompress-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('leaves .br and .gz next to each text file and reports how many', async () => {
    await writeFile(join(dir, 'index.html'), `<!doctype html>${'<p>hola</p>'.repeat(100)}`);

    const result = await run('precompress.ts', [dir]);

    assert.deepEqual(result, { code: 0, stdout: `${dir}: 1 files precompressed\n`, stderr: '' });
    assert.deepEqual((await readdir(dir)).sort(), ['index.html', 'index.html.br', 'index.html.gz']);
  });

  it('without a folder it explains the usage and exits with code 2', async () => {
    assert.deepEqual(await run('precompress.ts', []), {
      code: 2,
      stdout: '',
      stderr: 'Usage: node precompress.ts <dir>\n',
    });
  });
});

describe('healthcheck.ts (compose healthcheck, no curl in the image)', () => {
  let server: Server | undefined;

  const listen = async (status: number): Promise<string> => {
    server = createServer((request, response) => {
      response.writeHead(request.url === '/health' ? status : 404).end();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return String((server.address() as AddressInfo).port);
  };

  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  it('exits with 0 when GET /health answers 200', async () => {
    assert.deepEqual(await run('healthcheck.ts', [], { PORT: await listen(200) }), { code: 0, stdout: '', stderr: '' });
  });

  it('exits with 1 and says why when /health does not answer 200', async () => {
    const result = await run('healthcheck.ts', [], { PORT: await listen(503) });
    assert.deepEqual(result, { code: 1, stdout: '', stderr: 'builder unhealthy: /health answered 503\n' });
  });

  it('exits with 1 when nobody is listening', async () => {
    const port = await listen(200);
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;

    const result = await run('healthcheck.ts', [], { PORT: port });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^builder unhealthy: /);
  });
});

describe('request-build.ts (requests a build from inside the container, for example after a restore)', () => {
  let server: Server | undefined;
  let seen: { method?: string; url?: string; authorization?: string } = {};

  const listen = async (status: number): Promise<string> => {
    server = createServer((request, response) => {
      seen = { method: request.method, url: request.url, authorization: request.headers.authorization };
      response.writeHead(status).end();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return String((server.address() as AddressInfo).port);
  };

  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  it('sends POST /build with the token and exits with 0 when the builder accepts it (202)', async () => {
    const token = 't'.repeat(40);
    const result = await run('request-build.ts', [], { PORT: await listen(202), BUILDER_TOKEN: token });

    assert.deepEqual(result, { code: 0, stdout: 'build requested\n', stderr: '' });
    assert.deepEqual(seen, { method: 'POST', url: '/build', authorization: `Bearer ${token}` });
  });

  it('exits with 1 and says why when the builder rejects it', async () => {
    const result = await run('request-build.ts', [], { PORT: await listen(401), BUILDER_TOKEN: 'x' });
    assert.deepEqual(result, { code: 1, stdout: '', stderr: 'could not request a build: POST /build answered 401\n' });
  });
});
