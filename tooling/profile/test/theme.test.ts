import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

  // tokens.json is a hand-kept mirror of tokens.css and the profile is its only reader: pin what it reads to the CSS
  // the site ships. TOKENS_CSS=<path> points it at another file (to prove it catches a drifted copy).
  it('reads the same colors the site gets from tokens.css', () => {
    const css = readFileSync(process.env.TOKENS_CSS ?? new URL('../../../packages/tokens/src/tokens.css', import.meta.url), 'utf8');
    const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
    const vars = new Map([...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]));
    const cssColor = (name: string): string => {
      const value = vars.get(name);
      assert.ok(value, `tokens.css has no --${name}`);
      const reference = /^var\(--([\w-]+)\)$/.exec(value)?.[1];
      if (reference) return cssColor(reference);
      return value.toLowerCase().replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, '#$1$1$2$2$3$3');
    };
    assert.deepEqual(color, {
      page: cssColor('bg-page'),
      surface: cssColor('bg-surface'),
      surfaceAlt: cssColor('bg-surface-alt'),
      border: cssColor('border-subtle'),
      text: cssColor('text-primary'),
      textSecondary: cssColor('text-secondary'),
      textTertiary: cssColor('text-tertiary'),
      accent: cssColor('link-accent'),
      dataviz: ['green', 'blue', 'orange'].map((name) => cssColor(`dataviz-${name}`)),
    });
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
