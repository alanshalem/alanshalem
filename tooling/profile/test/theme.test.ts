import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { color, TEXT_COLORS } from '../src/theme.ts';
import { escapeXml } from '../src/xml.ts';

/** Contraste WCAG 2.x entre dos colores #rrggbb. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('theme', () => {
  it('toma los colores de packages/tokens (los mismos del sitio)', () => {
    assert.equal(color.page, '#0a0a0b');
    assert.equal(color.surface, '#141416');
    assert.equal(color.surfaceAlt, '#1b1b1e');
    assert.equal(color.border, '#2a2a2d');
    assert.equal(color.text, '#ededea');
    assert.equal(color.textSecondary, '#c8c8c2');
    assert.equal(color.textTertiary, '#8e8e88');
    assert.equal(color.accent, '#9db2ff');
    assert.deepEqual(color.dataviz, ['#a9c98a', '#8fa7d9', '#e08f6a']);
  });

  it('todo color de texto llega a 4,5:1 sobre las superficies de las tarjetas', () => {
    for (const fg of TEXT_COLORS) {
      for (const bg of [color.page, color.surface, color.surfaceAlt]) {
        assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}: ${contrast(fg, bg).toFixed(2)}`);
      }
    }
  });
});

describe('escapeXml', () => {
  it('escapa los cinco caracteres especiales de XML', () => {
    assert.equal(escapeXml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;');
  });
});
