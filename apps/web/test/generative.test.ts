import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generativeCover } from '../src/lib/generative.ts';

describe('generativeCover', () => {
  it('is deterministic: same slug and topic => byte-identical SVG', () => {
    assert.equal(generativeCover('mi-primer-post', 'ideas'), generativeCover('mi-primer-post', 'ideas'));
  });

  it('different slugs => different SVGs', () => {
    assert.notEqual(generativeCover('post-uno', 'ideas'), generativeCover('post-dos', 'ideas'));
  });

  it('the topic varies the result for the same slug', () => {
    assert.notEqual(generativeCover('post-uno', 'ideas'), generativeCover('post-uno', 'software'));
  });

  it('is a decorative, lightweight SVG with no external requests', () => {
    const svg = generativeCover('any-slug', 'topic');
    assert.match(svg, /^<svg [^>]*aria-hidden="true"/);
    assert.match(svg, /focusable="false"/);
    assert.match(svg, /<\/svg>$/);
    assert.ok(svg.includes('#141416'), 'bg-surface background');
    assert.ok(/#a9c98a|#8fa7d9|#e08f6a/.test(svg), 'uses the dataviz palette');
    assert.ok(!/href|url\(|<image|<script|<foreignObject/i.test(svg), 'no external references');
    assert.ok(!/ id=/.test(svg), 'no ids that clash between several inline SVGs');
    const bytes = Buffer.byteLength(svg);
    assert.ok(bytes >= 600 && bytes <= 2200, `weighs ${bytes} bytes`);
  });

  it('draws nodes and thin lines', () => {
    const svg = generativeCover('nodes', '');
    assert.ok((svg.match(/<circle /g) ?? []).length >= 8);
    assert.match(svg, /<path [^>]*stroke-width="0\.\d+"/);
  });

  it('stays within size for many slugs', () => {
    for (let i = 0; i < 200; i++) {
      const bytes = Buffer.byteLength(generativeCover(`slug-${i}`, `topic-${i % 7}`));
      assert.ok(bytes <= 2200, `slug-${i}: ${bytes} bytes`);
    }
  });
});
