import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DEFAULT_LANG, LANGS, NOT_FOUND_PATH, notFoundPage, paths, ui } from '../src/lib/i18n.ts';

/*
 * 404 by the URL's language: the build writes /es/404.html and /en/404.html, each entirely in its language, and keeps
 * a bilingual /404.html for URLs without a prefix. Caddy picks which one to serve (caddyfile.test.ts).
 */

const PAGES = new URL('../src/pages/', import.meta.url);

describe('404 per language', () => {
  it('each language has its /<lang>/404.html file and the root has its own', () => {
    assert.equal(paths.notFound('es'), '/es/404.html');
    assert.equal(paths.notFound('en'), '/en/404.html');
    assert.equal(NOT_FOUND_PATH, '/404.html');
  });

  it('/en/404.html: everything in English (header, footer and a single notice)', () => {
    // Astro gives the original route with a trailing slash in the build ("/en/404.html/") and without it in `astro dev`.
    for (const origin of ['/en/404.html/', '/en/404.html', '/en/articles/nope/']) {
      assert.deepEqual(notFoundPage(origin), { lang: 'en', notices: ['en'] }, origin);
    }
    assert.equal(ui('en').notFoundTitle, 'Page not found');
    assert.equal(ui('en').notFoundHeading, 'This page does not exist.');
    assert.equal(ui('en').backHome, 'Back to home');
  });

  it('/es/404.html: everything in Spanish', () => {
    for (const origin of ['/es/404.html/', '/es/404.html', '/es/temas/nada/']) {
      assert.deepEqual(notFoundPage(origin), { lang: 'es', notices: ['es'] }, origin);
    }
    assert.equal(ui('es').notFoundTitle, 'Página no encontrada');
    assert.equal(ui('es').notFoundHeading, 'Esta página no existe.');
    assert.equal(ui('es').backHome, 'Volver al inicio');
  });

  it('/404.html (no language prefix): notice in both languages, header and footer in the main one', () => {
    for (const origin of ['/404/', '/404.html', '/nope', '/', '/fr/x/', '/english/', '/eses/']) {
      assert.deepEqual(notFoundPage(origin), { lang: DEFAULT_LANG, notices: [...LANGS] }, origin);
    }
  });

  it('a single page: the /<lang>/404.html route rewrites to /404 (no second copy of the 404)', () => {
    const route = readFileSync(new URL('[lang]/404.html.ts', PAGES), 'utf8');
    // An endpoint with an extension is written as is (/es/404.html); an .astro page would come out as /es/404/index.html.
    assert.match(route, /getStaticPaths = \(\) => LANGS\.map\(\(lang\) => \(\{ params: \{ lang \} \}\)\)/);
    assert.match(route, /rewrite\('\/404'\)/);
    assert.ok(!existsSync(new URL('[lang]/404.astro', PAGES)), 'no second 404 page');
    const page = readFileSync(new URL('404.astro', PAGES), 'utf8');
    assert.match(page, /notFoundPage\(Astro\.originPathname\)/);
    assert.match(page, /noindex/);
  });
});
