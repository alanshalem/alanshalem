import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import config from '../astro.config.mjs';
import { cspHash, DIAGRAM_STYLE_RESOURCES, INLINE_SCRIPTS, SITE_CSP } from '../src/lib/csp.ts';
import { HERO_ROTATION_SCRIPT } from '../src/lib/hero-rotation.ts';
import { MEDIA_GUARD_SCRIPT } from '../src/lib/media-guard.ts';

/*
 * The site CSP. Astro writes a <meta http-equiv="content-security-policy"> on every page with the hashes of the
 * scripts and styles it processes; the <script is:inline>s are src/lib constants and their hashes come from those same
 * constants (a change in a script changes its hash in the same build).
 */

/** sha256 in base64 with Web Crypto: another implementation than cspHash's, so the function is not compared with itself. */
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

describe('cspHash: CSP source of the exact content of a script', () => {
  it('is sha256 in base64 with the CSP prefix (known vector: the empty text)', () => {
    assert.equal(cspHash(''), 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });
});

describe('SITE_CSP: the policy astro.config.mjs passes to Astro', () => {
  it('astro.config.mjs uses SITE_CSP as is', () => {
    assert.equal(config.security?.csp, SITE_CSP);
  });

  it('the script hashes are the sha256 of MEDIA_GUARD_SCRIPT and HERO_ROTATION_SCRIPT', async () => {
    assert.deepEqual(SITE_CSP.scriptDirective.hashes, [
      await webCryptoHash(MEDIA_GUARD_SCRIPT),
      await webCryptoHash(HERO_ROTATION_SCRIPT),
    ]);
  });

  it('every executable <script is:inline> in src/ is an INLINE_SCRIPTS constant (otherwise the CSP blocks it)', () => {
    const used = astroFiles(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/<script\b[^>]*\bis:inline\b[^>]*>/g)]
        .map(([tag]) => tag)
        // Data blocks (type="application/json") do not run: the CSP does not look at them.
        .filter((tag) => !/type="application\/json"/.test(tag))
        .map((tag) => tag.match(/set:html=\{(\w+)\}/)?.[1] ?? `no constant: ${tag}`),
    );
    assert.deepEqual([...new Set(used)].sort(), Object.keys(INLINE_SCRIPTS).sort());
  });

  it('own resources; images also data: (placeholders) and https: (covers and external images the API accepts)', () => {
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

  it('no frame-ancestors: a <meta> ignores it (Caddy X-Frame-Options covers it)', () => {
    assert.ok(SITE_CSP.directives.every((directive) => !directive.startsWith('frame-ancestors')));
  });

  it("styles: 'self' and the Astro hashes; 'unsafe-inline' only for style attributes (the photos' waiting color)", () => {
    assert.deepEqual(SITE_CSP.styleDirective.resources, ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }]);
  });
});

describe('pages with a diagram: Mermaid draws each SVG with its own <style>', () => {
  const read = (file: URL): string => readFileSync(file, 'utf8');
  const diagrams = new URL('components/Diagrams.astro', SRC);

  it("only style elements are relaxed ('self' and 'unsafe-inline'); scripts keep their hashes", () => {
    assert.deepEqual(DIAGRAM_STYLE_RESOURCES, [
      { resource: "'self'", kind: 'element' },
      { resource: "'unsafe-inline'", kind: 'element' },
    ]);
  });

  it('only the diagram component changes the policy, with DIAGRAM_STYLE_RESOURCES', () => {
    const changing = astroFiles(SRC).filter((file) => read(file).includes('Astro.csp'));
    assert.deepEqual(changing.map((file) => file.href), [diagrams.href]);
    assert.ok(read(diagrams).includes('for (const resource of DIAGRAM_STYLE_RESOURCES) Astro.csp?.insertStyleResource(resource);'));
  });

  it('only a post whose body has a diagram renders that component', () => {
    const post = read(new URL('pages/[lang]/[posts]/[slug].astro', SRC));
    assert.ok(post.includes('{hasDiagram(post.html) && <Diagrams />}'));
    const uses = astroFiles(SRC).filter((file) => read(file).includes('<Diagrams'));
    assert.deepEqual(uses.map((file) => file.pathname.split('/src/')[1]), ['pages/[lang]/[posts]/[slug].astro']);
  });
});
