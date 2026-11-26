import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { absoluteUrl, site } from '../src/lib/site.ts';

/*
 * La URL del sitio sale de un solo lugar (principio 5, L4): `site` de astro.config.mjs, que la arma desde SITE_URL.
 * lib/site.ts la lee de Astro (import.meta.env.SITE) en vez de repetir el cálculo y su valor por defecto.
 */

const SRC = new URL('../src/', import.meta.url);

const sourceFiles = (dir: URL): URL[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(new URL(`${entry.name}/`, dir)) : [new URL(entry.name, dir)],
  );

describe('URL del sitio: una sola fuente', () => {
  it('ningún archivo de src/ lee SITE_URL ni repite el valor por defecto de astro.config.mjs', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => /process\.env\.SITE_URL|localhost:4321/.test(readFileSync(file, 'utf8')))
      .map((file) => file.pathname.slice(SRC.pathname.length));
    assert.deepEqual(offenders, []);
  });

  it('lib/site.ts toma `site` de la configuración de Astro', () => {
    assert.match(readFileSync(new URL('lib/site.ts', SRC), 'utf8'), /import\.meta\.env\?\.SITE/);
  });

  it('fuera de Astro (estos tests) no inventa una URL: queda vacía y las rutas siguen siendo rutas', () => {
    assert.equal(site.url, '');
    assert.equal(absoluteUrl('/es/'), '/es/');
  });
});
