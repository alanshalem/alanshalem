import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { robotsTxt } from '../src/lib/robots.ts';

/*
 * robots.txt sale de SITE_URL (perfil-skills-produccion L8, P1-4): el archivo fijo de public/ apuntaba el sitemap a
 * example.com en cualquier despliegue. Ahora lo arma src/pages/robots.txt.ts con la URL de `site`.
 */

describe('robotsTxt: robots.txt del sitio con su propio sitemap', () => {
  it('deja rastrear el sitio, no el admin ni la API, y apunta al sitemap del dominio', () => {
    assert.equal(
      robotsTxt('https://blog.midominio.com'),
      'User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: https://blog.midominio.com/sitemap.xml\n',
    );
  });

  it('el sitemap usa la URL que recibe, sin dominios de ejemplo', () => {
    const txt = robotsTxt('http://localhost:8080');
    assert.match(txt, /^Sitemap: http:\/\/localhost:8080\/sitemap\.xml$/m);
    assert.doesNotMatch(txt, /example\.com/);
  });

  it('no queda un robots.txt fijo en public/ (le ganaría al generado) y la ruta usa la URL de `site`', () => {
    assert.equal(existsSync(new URL('../public/robots.txt', import.meta.url)), false);
    const page = readFileSync(new URL('../src/pages/robots.txt.ts', import.meta.url), 'utf8');
    assert.match(page, /robotsTxt\(site\.url\)/);
  });
});
