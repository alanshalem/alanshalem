import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { cspHash, SITE_CSP } from '../src/lib/csp.ts';

/*
 * The CSP Astro actually emits, read from a real `astro build` of the site against an in-process stub of the internal
 * API (random port, temp output folder): one post with a Mermaid diagram and one without.
 */

const WEB = fileURLToPath(new URL('../', import.meta.url));
const ASTRO = join(WEB, 'node_modules', 'astro', 'bin', 'astro.mjs');
const TOKEN = 'csp-built-test-token-0123456789abcdef';

const post = (slug: string, title: string, body: string) => ({
  id: `id-${slug}`,
  slug,
  title,
  summary: `${title}.`,
  body,
  tags: [],
  lang: 'es',
  translationGroupId: `group-${slug}`,
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
  publishedAt: '2026-11-01T10:00:00Z',
  coverUrl: null,
  coverAlt: null,
});

const API: Record<string, unknown> = {
  '/api/internal/settings': {
    name: 'Blog de prueba',
    tagline: null,
    bio: null,
    email: null,
    githubUrl: null,
    linkedinUrl: null,
    xUrl: null,
  },
  '/api/internal/posts': [
    post('con-diagrama', 'Con diagrama', 'Antes.\n\n```mermaid\nflowchart LR\n    A["Uno"] --> B["Dos"]\n```\n\nDespués.'),
    post('sin-diagrama', 'Sin diagrama', 'Solo texto.\n\n```python\nprint("hola")\n```'),
  ],
  '/api/internal/media': [],
  '/api/internal/hero-images': [],
};

/** The `content` of the page's <meta http-equiv="content-security-policy">, as directive → sources. */
const policyOf = (html: string): { text: string; directives: Map<string, string[]> } => {
  const metas = [...html.matchAll(/<meta http-equiv="content-security-policy" content="([^"]*)"/g)];
  assert.equal(metas.length, 1, 'one CSP <meta> per page');
  const text = metas[0]![1]!.replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');
  const directives = new Map(
    text
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0])
      .map(([name, ...sources]) => [name!, sources]),
  );
  return { text, directives };
};

let server: Server;
let out: string;
let build: { code: number | null; log: string };

const page = (path: string): string => readFileSync(join(out, path, 'index.html'), 'utf8');

before(async () => {
  server = createServer((request, response) => {
    const body = request.headers.authorization === `Bearer ${TOKEN}` ? API[request.url ?? ''] : undefined;
    response.writeHead(body === undefined ? 404 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body ?? {}));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  out = mkdtempSync(join(tmpdir(), 'blog-csp-built-'));
  const { port } = server.address() as AddressInfo;
  build = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ASTRO, 'build', '--silent'], {
      cwd: WEB,
      env: { ...process.env, API_URL: `http://127.0.0.1:${port}`, BUILDER_TOKEN: TOKEN, OUT_DIR: out, SITE_URL: 'https://example.test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (chunk: Buffer) => (log += chunk));
    child.stderr.on('data', (chunk: Buffer) => (log += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, log }));
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(out, { recursive: true, force: true });
});

describe('the CSP of the built pages', { timeout: 300_000 }, () => {
  it('the site builds against the stub API', () => {
    assert.equal(build.code, 0, build.log);
  });

  it("a page with a diagram accepts inline style elements: style-src-elem 'self' 'unsafe-inline', no style hashes", () => {
    const html = page('es/articulos/con-diagrama');
    assert.match(html, /<figure class="diagram">/);
    const { directives } = policyOf(html);
    assert.deepEqual(directives.get('style-src-elem'), ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(directives.get('style-src-attr'), ["'unsafe-inline'"]);
    assert.ok(!directives.get('style-src')?.some((source) => source.includes('sha256-')), 'no style hashes left beside it');
  });

  it("a page with a diagram also allows inline styles in style-src: browsers without style-src-elem keep the site's inline CSS", () => {
    const { directives } = policyOf(page('es/articulos/con-diagrama'));
    assert.deepEqual(directives.get('style-src'), ["'self'", "'unsafe-inline'"]);
  });

  it('a page with a diagram keeps every other directive and the script hashes of a plain page', () => {
    const diagram = policyOf(page('es/articulos/con-diagrama')).directives;
    const plain = policyOf(page('es/articulos/sin-diagrama')).directives;
    assert.deepEqual(diagram.get('script-src'), plain.get('script-src'));
    for (const directive of SITE_CSP.directives) {
      const [name, ...sources] = directive.split(' ');
      assert.deepEqual(diagram.get(name!), sources, name);
    }
  });

  it("a plain page keeps the site policy byte for byte: style hashes of its own <style>s, 'unsafe-inline' only for attributes", () => {
    const html = page('es/articulos/sin-diagrama');
    assert.doesNotMatch(html, /figure class="diagram"/);
    const { text, directives } = policyOf(html);
    const styleHashes = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(([, css]) => `'${cspHash(css!)}'`);
    assert.ok(styleHashes.length > 0, 'the page inlines its CSS');
    const scripts = directives.get('script-src') ?? [];
    assert.deepEqual(scripts.slice(0, 3), ["'self'", ...SITE_CSP.scriptDirective.hashes.map((hash) => `'${hash}'`)]);
    assert.ok(scripts.slice(1).every((source) => /^'sha256-[A-Za-z0-9+/]+=*'$/.test(source)), 'script-src: only hashes');
    assert.equal(
      text,
      `${SITE_CSP.directives.join(';')}; script-src ${scripts.join(' ')}; style-src 'self' ${styleHashes.join(' ')}; style-src-attr 'unsafe-inline';`,
    );
  });
});
