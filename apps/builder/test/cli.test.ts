import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// Los dos scripts de línea de comando del builder se prueban como los usa Docker: un proceso aparte, mirando el código
// de salida y lo que imprime.
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

describe('precompress.ts (precomprime el admin al construir la imagen de Caddy)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blog-precompress-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('deja .br y .gz junto a cada archivo de texto e informa cuántos', async () => {
    await writeFile(join(dir, 'index.html'), `<!doctype html>${'<p>hola</p>'.repeat(100)}`);

    const result = await run('precompress.ts', [dir]);

    assert.deepEqual(result, { code: 0, stdout: `${dir}: 1 archivos precomprimidos\n`, stderr: '' });
    assert.deepEqual((await readdir(dir)).sort(), ['index.html', 'index.html.br', 'index.html.gz']);
  });

  it('sin carpeta explica el uso y termina con código 2', async () => {
    assert.deepEqual(await run('precompress.ts', []), {
      code: 2,
      stdout: '',
      stderr: 'Uso: node precompress.ts <carpeta>\n',
    });
  });
});

describe('healthcheck.ts (healthcheck de compose, sin curl en la imagen)', () => {
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

  it('sale con 0 si GET /health responde 200', async () => {
    assert.deepEqual(await run('healthcheck.ts', [], { PORT: await listen(200) }), { code: 0, stdout: '', stderr: '' });
  });

  it('sale con 1 y dice por qué si /health no responde 200', async () => {
    const result = await run('healthcheck.ts', [], { PORT: await listen(503) });
    assert.deepEqual(result, { code: 1, stdout: '', stderr: 'builder no saludable: /health respondió 503\n' });
  });

  it('sale con 1 si no hay nadie escuchando', async () => {
    const port = await listen(200);
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;

    const result = await run('healthcheck.ts', [], { PORT: port });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^builder no saludable: /);
  });
});

describe('request-build.ts (pide un build desde dentro del contenedor, por ejemplo tras un restore)', () => {
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

  it('hace POST /build con el token y sale con 0 si el builder lo acepta (202)', async () => {
    const token = 't'.repeat(40);
    const result = await run('request-build.ts', [], { PORT: await listen(202), BUILDER_TOKEN: token });

    assert.deepEqual(result, { code: 0, stdout: 'build pedido\n', stderr: '' });
    assert.deepEqual(seen, { method: 'POST', url: '/build', authorization: `Bearer ${token}` });
  });

  it('sale con 1 y dice por qué si el builder lo rechaza', async () => {
    const result = await run('request-build.ts', [], { PORT: await listen(401), BUILDER_TOKEN: 'x' });
    assert.deepEqual(result, { code: 1, stdout: '', stderr: 'no se pudo pedir el build: POST /build respondió 401\n' });
  });
});
