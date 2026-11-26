import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Lo que agregó la pasada de producción al Caddyfile. Las reglas de antes (caché, /api/internal, idioma, 404) están en
// apps/web/test/caddyfile.test.ts. Validación real: `caddy validate` en la imagen y curl -I contra la copia local.
const caddy = readFileSync(new URL('../caddy/Caddyfile', import.meta.url), 'utf8');

/** Texto del bloque `{ … }` que empieza en `start`, con llaves balanceadas. */
function block(start: string): string {
  const begin = caddy.indexOf(start);
  assert.ok(begin >= 0, `falta el bloque ${start}`);
  let depth = 0;
  for (let i = caddy.indexOf('{', begin + start.length - 1); i < caddy.length; i++) {
    if (caddy[i] === '{') depth++;
    if (caddy[i] === '}' && --depth === 0) return caddy.slice(begin, i + 1);
  }
  throw new Error(`llaves desbalanceadas en ${start}`);
}
const directives = (text: string): string[] =>
  text.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));

describe('Caddyfile (producción)', () => {
  it('las opciones globales van primero y solo traen el correo de ACME (opcional)', () => {
    assert.deepEqual(directives(caddy).slice(0, 3), ['{', '{$CADDY_ACME_EMAIL}', '}']);
  });

  it('aislamiento entre orígenes en toda respuesta (también en los errores, que importan el mismo snippet)', () => {
    const security = directives(block('(security) {'));
    assert.ok(security.includes('Cross-Origin-Opener-Policy "same-origin"'));
    // Como `header` aparte y no dentro del bloque con `-Server`: ese bloque se aplica diferido y pisaría el
    // cross-origin de /media (pasaba con la primera versión, visto con curl -I).
    assert.ok(security.includes('header Cross-Origin-Resource-Policy "same-origin"'));
    const snippet = block('(security) {');
    const start = snippet.indexOf('header {');
    assert.doesNotMatch(snippet.slice(start, snippet.indexOf('}', start)), /Cross-Origin-Resource-Policy/);
  });

  it('/media se puede incrustar desde otro origen: el RSS lleva las imágenes y los lectores web las cargan', () => {
    assert.ok(directives(block('handle_path /media/* {')).includes('header Cross-Origin-Resource-Policy "cross-origin"'));
  });

  it('el panel no se indexa', () => {
    assert.ok(directives(block('handle_path /admin/* {')).includes('header X-Robots-Tag "noindex"'));
  });

  it('logs de acceso en JSON por la salida estándar', () => {
    assert.match(block('log {'), /output stdout\n\t\tformat json/);
  });
});
