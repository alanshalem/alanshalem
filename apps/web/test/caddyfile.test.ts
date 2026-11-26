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

/** Líneas que son directivas (sin comentarios), para no confundir una explicación con la regla. */
const directives = (text: string): string[] =>
  text.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));

test('admin: los assets con hash se cachean para siempre y el resto (index.html de la SPA) se revalida', () => {
  const admin = directives(block('handle_path /admin/* {'));
  assert.ok(admin.includes('@hashed path /assets/*'));
  assert.ok(admin.includes('header @hashed Cache-Control "public, max-age=31536000, immutable"'));
  // Caddy ordena los `header` iguales poniendo el de ruta específica primero y el que no tiene matcher al final: un
  // `header Cache-Control "no-cache"` suelto pisaba el immutable de /assets/* (auditoría P2-1). Los dos llevan matcher
  // y los matchers no se solapan, así el orden deja de importar.
  assert.ok(admin.includes('@html not path /assets/*'));
  assert.ok(admin.includes('header @html Cache-Control "no-cache"'));
  assert.deepEqual(admin.filter((line) => /^header Cache-Control\b/.test(line)), [], 'ningún Cache-Control sin matcher en el admin');
});

test('admin: se sirve precomprimido (br/gzip hechos al construir la imagen), sin comprimir en cada petición', () => {
  const admin = block('handle_path /admin/* {');
  assert.match(admin, /file_server \{\s*precompressed br gzip\s*\}/);
  assert.ok(!directives(admin).some((line) => line.startsWith('encode')), 'con los .br/.gz ya hechos, encode sobra');
  // Sin los archivos .br/.gz, `precompressed` no comprime nada: la imagen tiene que generarlos con la misma función
  // que usa el builder para el sitio.
  const dockerfile = readFileSync(new URL('../../../infra/caddy/Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /precompressSite\('apps\/admin\/dist'\)/);
});

test('las respuestas de error (404 de /media, /_astro o páginas) nunca se cachean y llevan las cabeceras de seguridad', () => {
  const errors = block('handle_errors {');
  // Al nivel del bloque, no solo dentro de @notfound: también los 502/503 de la API.
  const topLevel = directives(errors.replace(block('handle @notfound {'), ''));
  assert.ok(topLevel.includes('header Cache-Control "no-store"'), 'un 404 heredaba el immutable de /media o /_astro');
  // Las rutas de error no pasan por las directivas del sitio: las cabeceras de seguridad salen de un snippet que
  // importan los dos.
  assert.ok(topLevel.includes('import security'));
  assert.match(caddy, /^\{\$SITE_ADDRESS:localhost\} \{\n\timport security$/m, 'el sitio importa el snippet como primera directiva');
  const security = block('(security) {');
  for (const header of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', '-Server']) {
    assert.ok(security.includes(header), header);
  }
});

test('/api/admin/* nunca se guarda en ninguna caché, aunque la API mande su propio Cache-Control', () => {
  const api = directives(block('handle /api/* {'));
  assert.ok(api.includes('@admin path /api/admin/*'));
  // `>` = diferido: reemplaza lo que venga de la API en vez de sumar un segundo Cache-Control.
  assert.ok(api.includes('header @admin >Cache-Control "no-store"'));
});

test('chequeo de salud de la API: usable a los pocos segundos de arrancar y sin oscilar por un chequeo fallido', () => {
  const proxy = directives(block('reverse_proxy api:8080 {'));
  const value = (name: string): string | undefined => proxy.find((line) => line.startsWith(`${name} `))?.split(/\s+/)[1];
  assert.equal(value('health_uri'), '/api/health');
  // Con 30 s, si el primer chequeo caía mientras la API arrancaba, /api respondía 503 durante ~30 s.
  assert.equal(value('health_interval'), '2s');
  // Hacen falta 3 fallos seguidos (~6 s) para sacarla: una respuesta lenta suelta no la saca de servicio.
  assert.equal(value('health_fails'), '3');
});

test('la raíz redirige según el idioma del navegador: inglés → /en/, si no → /es/', () => {
  const root = block('handle @root {');
  assert.match(caddy, /@root path \/\s*$/m, 'el matcher @root tiene que ser exactamente la raíz');
  assert.match(root, /header Vary Accept-Language/, 'las cachés tienen que separar la respuesta por idioma');
  assert.match(root, /header_regexp Accept-Language/);
  // La expresión exacta: solo la PRIMERA preferencia, y "en" como palabra completa (en, en-US) — sin \b, "eng" o un
  // "english-fake" también mandarían a /en/ (multiidioma L9).
  const english = /@english header_regexp Accept-Language (\S+)\s*$/m.exec(root)?.[1];
  assert.equal(english, String.raw`(?i)^\s*en\b`);
  // La misma expresión en JS (`(?i)` de Go = flag i) para fijar qué entra y qué no.
  const prefersEnglish = new RegExp((english ?? '').replace(/^\(\?i\)/, ''), 'i');
  for (const header of ['en', 'en-US,en;q=0.9', ' EN-gb', 'en;q=0.8,es']) assert.ok(prefersEnglish.test(header), header);
  for (const header of ['english-fake', 'eng', 'es-AR,en;q=0.9', 'fr,en']) assert.ok(!prefersEnglish.test(header), header);
  assert.match(root, /redir @english \/en\/ 302/);
  // `redir /es/ 302` NO sirve: Caddy toma /es/ como filtro de ruta y no como destino. Hace falta el comodín.
  assert.match(root, /redir \* \/es\/ 302/);
});

test('un asset del admin que no existe da 404, no el index.html de la SPA con caché inmutable', () => {
  // Con `try_files {path} /index.html` para todo, una pestaña vieja que pide /assets/hash-viejo.js tras un deploy
  // recibía index.html con `immutable` por un año y ese navegador quedaba con el admin roto.
  const admin = block('handle_path /admin/* {');
  // `try_files` NO acepta matcher (Caddy toma `@x` como un archivo más y cae igual en index.html): hace falta un
  // `rewrite` con matcher que excluya /assets/* y lo que sí existe.
  assert.match(admin, /@spa \{\s*not path \/assets\/\*\s*not file\s*\}/, 'matcher @spa: no es /assets/* y el archivo no existe');
  assert.match(admin, /^\s*rewrite @spa \/index\.html\s*$/m);
  assert.doesNotMatch(admin, /^\s*try_files\b/m, 'sin try_files (no admite matcher)');
});

test('el 404 de /api/internal tampoco se cachea (respond no pasa por handle_errors)', () => {
  const api = block('handle /api/* {');
  assert.match(api, /^\s*header @internal Cache-Control "no-store"\s*$/m);
});
