import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generativeCover } from '../src/lib/generative.ts';

describe('generativeCover (S3b)', () => {
  it('es determinística: mismo slug y tema => SVG idéntico byte a byte', () => {
    assert.equal(generativeCover('mi-primer-post', 'ideas'), generativeCover('mi-primer-post', 'ideas'));
  });

  it('slugs distintos => SVG distintos', () => {
    assert.notEqual(generativeCover('post-uno', 'ideas'), generativeCover('post-dos', 'ideas'));
  });

  it('el tema varía el resultado para un mismo slug', () => {
    assert.notEqual(generativeCover('post-uno', 'ideas'), generativeCover('post-uno', 'software'));
  });

  it('es un SVG decorativo, liviano y sin requests externos', () => {
    const svg = generativeCover('un-slug-cualquiera', 'tema');
    assert.match(svg, /^<svg [^>]*aria-hidden="true"/);
    assert.match(svg, /focusable="false"/);
    assert.match(svg, /<\/svg>$/);
    assert.ok(svg.includes('#141416'), 'fondo bg-surface');
    assert.ok(/#a9c98a|#8fa7d9|#e08f6a/.test(svg), 'usa la paleta dataviz');
    assert.ok(!/href|url\(|<image|<script|<foreignObject/i.test(svg), 'sin referencias externas');
    assert.ok(!/ id=/.test(svg), 'sin ids que choquen entre varios SVG inline');
    const bytes = Buffer.byteLength(svg);
    assert.ok(bytes >= 600 && bytes <= 2200, `pesa ${bytes} bytes`);
  });

  it('dibuja nodos y líneas finas', () => {
    const svg = generativeCover('nodos', '');
    assert.ok((svg.match(/<circle /g) ?? []).length >= 8);
    assert.match(svg, /<path [^>]*stroke-width="0\.\d+"/);
  });

  it('se mantiene en el tamaño para muchos slugs', () => {
    for (let i = 0; i < 200; i++) {
      const bytes = Buffer.byteLength(generativeCover(`slug-${i}`, `tema-${i % 7}`));
      assert.ok(bytes <= 2200, `slug-${i}: ${bytes} bytes`);
    }
  });
});
