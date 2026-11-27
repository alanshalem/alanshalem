import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DEFAULT_LANG, notFoundLang, paths, ui } from '../src/lib/i18n.ts';

/*
 * 404 in one language: the build writes /es/404.html and /en/404.html, each entirely in its language. Caddy serves the
 * one of the URL's prefix and, for URLs without a prefix, the one of the browser's first Accept-Language preference
 * (caddyfile.test.ts, infra/test/caddy-runtime.sh).
 */

const PAGES = new URL('../src/pages/', import.meta.url);

describe('404 per language', () => {
  it('each language has its /<lang>/404.html file', () => {
    assert.equal(paths.notFound('es'), '/es/404.html');
    assert.equal(paths.notFound('en'), '/en/404.html');
  });

  it('/en/404.html: everything in English', () => {
    // Astro gives the original route with a trailing slash in the build ("/en/404.html/") and without it in `astro dev`.
    for (const origin of ['/en/404.html/', '/en/404.html', '/en/articles/nope/']) {
      assert.equal(notFoundLang(origin), 'en', origin);
    }
    assert.equal(ui('en').notFoundTitle, 'Page not found');
    assert.equal(ui('en').notFoundHeading, 'This page does not exist.');
    assert.equal(ui('en').backHome, 'Back to home');
  });

  it('/es/404.html: everything in Spanish', () => {
    for (const origin of ['/es/404.html/', '/es/404.html', '/es/temas/nada/']) {
      assert.equal(notFoundLang(origin), 'es', origin);
    }
    assert.equal(ui('es').notFoundTitle, 'Página no encontrada');
    assert.equal(ui('es').notFoundHeading, 'Esta página no existe.');
    assert.equal(ui('es').backHome, 'Volver al inicio');
  });

  it('without a language prefix (the root /404.html Astro also writes, astro dev): the main language only', () => {
    for (const origin of ['/404/', '/404.html', '/nope', '/', '/fr/x/', '/english/', '/eses/']) {
      assert.equal(notFoundLang(origin), DEFAULT_LANG, origin);
    }
  });

  it('a single page in a single language: the /<lang>/404.html route rewrites to /404', () => {
    const route = readFileSync(new URL('[lang]/404.html.ts', PAGES), 'utf8');
    // An endpoint with an extension is written as is (/es/404.html); an .astro page would come out as /es/404/index.html.
    assert.match(route, /getStaticPaths = \(\) => LANGS\.map\(\(lang\) => \(\{ params: \{ lang \} \}\)\)/);
    assert.match(route, /rewrite\('\/404'\)/);
    assert.ok(!existsSync(new URL('[lang]/404.astro', PAGES)), 'no second 404 page');
    const page = readFileSync(new URL('404.astro', PAGES), 'utf8');
    assert.match(page, /notFoundLang\(Astro\.originPathname\)/);
    assert.match(page, /noindex/);
    // One notice, one h1: no second language block below the first.
    assert.equal(page.match(/<h1>/g)?.length, 1);
    assert.doesNotMatch(page, /<h2\b|\.map\(/, 'no notice repeated per language');
  });
});
