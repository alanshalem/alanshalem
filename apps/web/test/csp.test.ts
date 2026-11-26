import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import config from '../astro.config.mjs';
import { cspHash, INLINE_SCRIPTS, SITE_CSP } from '../src/lib/csp.ts';
import { HERO_ROTATION_SCRIPT } from '../src/lib/hero-rotation.ts';
import { MEDIA_GUARD_SCRIPT } from '../src/lib/media-guard.ts';

/*
 * CSP del sitio (perfil-skills-produccion L8, P2-10). Astro escribe un <meta http-equiv="content-security-policy">
 * en cada página con los hashes de los scripts y estilos que procesa; los <script is:inline> son constantes de
 * src/lib y sus hashes salen de esas mismas constantes (un cambio en el script cambia el hash en el mismo build).
 */

/** sha256 en base64 con Web Crypto: otra implementación que la de cspHash, para no comparar la función consigo misma. */
const webCryptoHash = async (content: string): Promise<string> =>
  `sha256-${Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))).toString('base64')}`;

const SRC = new URL('../src/', import.meta.url);
const astroFiles = (dir: URL): URL[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? astroFiles(new URL(`${entry.name}/`, dir))
      : entry.name.endsWith('.astro')
        ? [new URL(entry.name, dir)]
        : [],
  );

describe('cspHash: fuente CSP del contenido exacto de un script', () => {
  it('es sha256 en base64 con el prefijo de CSP (vector conocido: el texto vacío)', () => {
    assert.equal(cspHash(''), 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });
});

describe('SITE_CSP: la política que astro.config.mjs le pasa a Astro', () => {
  it('astro.config.mjs usa SITE_CSP tal cual', () => {
    assert.equal(config.security?.csp, SITE_CSP);
  });

  it('los hashes de script son el sha256 de MEDIA_GUARD_SCRIPT y HERO_ROTATION_SCRIPT', async () => {
    assert.deepEqual(SITE_CSP.scriptDirective.hashes, [
      await webCryptoHash(MEDIA_GUARD_SCRIPT),
      await webCryptoHash(HERO_ROTATION_SCRIPT),
    ]);
  });

  it('todo <script is:inline> ejecutable de src/ es una constante de INLINE_SCRIPTS (si no, la CSP lo bloquea)', () => {
    const used = astroFiles(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/<script\b[^>]*\bis:inline\b[^>]*>/g)]
        .map(([tag]) => tag)
        // Los bloques de datos (type="application/json") no se ejecutan: la CSP no los mira.
        .filter((tag) => !/type="application\/json"/.test(tag))
        .map((tag) => tag.match(/set:html=\{(\w+)\}/)?.[1] ?? `sin constante: ${tag}`),
    );
    assert.deepEqual([...new Set(used)].sort(), Object.keys(INLINE_SCRIPTS).sort());
  });

  it('recursos propios; las imágenes también data: (placeholders) y https: (portadas e imágenes externas que la API acepta)', () => {
    assert.deepEqual(SITE_CSP.directives, [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "media-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ]);
  });

  it('frame-ancestors no va: un <meta> lo ignora (lo cubre X-Frame-Options de Caddy)', () => {
    assert.ok(SITE_CSP.directives.every((directive) => !directive.startsWith('frame-ancestors')));
  });

  it("estilos: 'self' y los hashes de Astro; 'unsafe-inline' solo para atributos style (color de espera de las fotos)", () => {
    assert.deepEqual(SITE_CSP.styleDirective.resources, ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }]);
  });
});
