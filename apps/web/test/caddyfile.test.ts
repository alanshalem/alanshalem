import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Guarda de regresión sobre infra/caddy/Caddyfile. Caddy evalúa `handle` antes que un `respond` de nivel superior,
// así que el bloqueo de /api/internal solo funciona DENTRO de `handle /api/*` y antes del reverse_proxy
// (ver commit 48f0158: durante meses la regla existió pero nunca se aplicaba).
// CADDYFILE permite apuntar el test a otra versión del archivo (para comprobar que detecta el bug).
const caddyfilePath = process.env.CADDYFILE ?? new URL('../../../infra/caddy/Caddyfile', import.meta.url);
const caddy = readFileSync(caddyfilePath, 'utf8');

/** Texto del bloque `{ … }` que empieza en `start`, con llaves balanceadas. */
function block(start: string): string {
  const begin = caddy.indexOf(start);
  assert.ok(begin >= 0, `falta el bloque ${start}`);
  let depth = 0;
  for (let i = caddy.indexOf('{', begin); i < caddy.length; i++) {
    if (caddy[i] === '{') depth++;
    if (caddy[i] === '}' && --depth === 0) return caddy.slice(begin, i + 1);
  }
  throw new Error(`llaves desbalanceadas en ${start}`);
}

test('/api/internal responde 404 dentro de handle /api/*, antes del reverse_proxy', () => {
  const api = block('handle /api/* {');
  assert.match(api, /@internal path \/api\/internal \/api\/internal\/\*/);
  assert.ok(api.includes('respond @internal 404'), 'falta respond @internal 404 dentro de handle /api/*');
  // Se buscan las directivas al principio de línea: los comentarios del bloque también nombran reverse_proxy.
  const directive = (name: string): number => api.search(new RegExp(String.raw`^\s*${name}\b`, 'm'));
  assert.ok(directive('respond @internal 404') >= 0 && directive('respond @internal 404') < directive('reverse_proxy'), 'el 404 tiene que ir antes del proxy');
  assert.doesNotMatch(caddy.slice(0, caddy.indexOf('handle /api/*')), /respond @internal/);
});

test('el admin permite vistas previas blob: y /media se cachea para siempre y permite video', () => {
  assert.match(block('handle_path /admin/* {'), /img-src 'self' data: blob:; media-src 'self' blob:/);
  const media = block('handle_path /media/* {');
  assert.match(media, /max-age=31536000, immutable/);
  assert.match(media, /media-src 'self'/);
  assert.doesNotMatch(media, /\bencode\b/, 'AVIF, WebP y MP4 ya vienen comprimidos y Range necesita bytes exactos');
});

test('la raíz redirige según el idioma del navegador: inglés → /en/, si no → /es/', () => {
  const root = block('handle @root {');
  assert.match(caddy, /@root path \/\s*$/m, 'el matcher @root tiene que ser exactamente la raíz');
  assert.match(root, /header Vary Accept-Language/, 'las cachés tienen que separar la respuesta por idioma');
  assert.match(root, /header_regexp Accept-Language/);
  assert.match(root, /redir @english \/en\/ 302/);
  // `redir /es/ 302` NO sirve: Caddy toma /es/ como filtro de ruta y no como destino. Hace falta el comodín.
  assert.match(root, /redir \* \/es\/ 302/);
});
