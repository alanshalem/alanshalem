import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DEFAULT_LANG, LANGS, NOT_FOUND_PATH, notFoundPage, paths, ui } from '../src/lib/i18n.ts';

/*
 * 404 según el idioma de la URL (L13): el build genera /es/404.html y /en/404.html, cada una entera en su idioma, y
 * mantiene /404.html bilingüe para las URLs sin prefijo. Caddy elige cuál servir (caddyfile.test.ts).
 */

const PAGES = new URL('../src/pages/', import.meta.url);

describe('404 por idioma (L13)', () => {
  it('cada idioma tiene su archivo /<lang>/404.html y la raíz el suyo', () => {
    assert.equal(paths.notFound('es'), '/es/404.html');
    assert.equal(paths.notFound('en'), '/en/404.html');
    assert.equal(NOT_FOUND_PATH, '/404.html');
  });

  it('/en/404.html: todo en inglés (cabecera, pie y un solo aviso)', () => {
    // Astro entrega la ruta original con barra final en el build ("/en/404.html/") y sin ella en `astro dev`.
    for (const origin of ['/en/404.html/', '/en/404.html', '/en/articles/nope/']) {
      assert.deepEqual(notFoundPage(origin), { lang: 'en', notices: ['en'] }, origin);
    }
    assert.equal(ui('en').notFoundTitle, 'Page not found');
    assert.equal(ui('en').notFoundHeading, 'This page does not exist.');
    assert.equal(ui('en').backHome, 'Back to home');
  });

  it('/es/404.html: todo en español', () => {
    for (const origin of ['/es/404.html/', '/es/404.html', '/es/temas/nada/']) {
      assert.deepEqual(notFoundPage(origin), { lang: 'es', notices: ['es'] }, origin);
    }
    assert.equal(ui('es').notFoundTitle, 'Página no encontrada');
    assert.equal(ui('es').notFoundHeading, 'Esta página no existe.');
    assert.equal(ui('es').backHome, 'Volver al inicio');
  });

  it('/404.html (sin prefijo de idioma): aviso en los dos idiomas, cabecera y pie en el principal', () => {
    for (const origin of ['/404/', '/404.html', '/nope', '/', '/fr/x/', '/english/', '/eses/']) {
      assert.deepEqual(notFoundPage(origin), { lang: DEFAULT_LANG, notices: [...LANGS] }, origin);
    }
  });

  it('una sola página: la ruta /<lang>/404.html reescribe a la de /404 (sin otra copia del 404)', () => {
    const route = readFileSync(new URL('[lang]/404.html.ts', PAGES), 'utf8');
    // Un endpoint con extensión se escribe tal cual (/es/404.html); una página .astro saldría como /es/404/index.html.
    assert.match(route, /getStaticPaths = \(\) => LANGS\.map\(\(lang\) => \(\{ params: \{ lang \} \}\)\)/);
    assert.match(route, /rewrite\('\/404'\)/);
    assert.ok(!existsSync(new URL('[lang]/404.astro', PAGES)), 'sin una segunda página 404');
    const page = readFileSync(new URL('404.astro', PAGES), 'utf8');
    assert.match(page, /notFoundPage\(Astro\.originPathname\)/);
    assert.match(page, /noindex/);
  });
});
