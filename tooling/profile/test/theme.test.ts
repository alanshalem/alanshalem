import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { color, TEXT_COLORS } from '../src/theme.ts';
import { cssColors } from '../src/tokens.ts';
import { escapeXml } from '../src/xml.ts';

/** WCAG 2.x contrast between two #rrggbb colors. */
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
  it('takes the colors from packages/tokens/src/tokens.css (the same ones as the site)', () => {
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

  it('every text color reaches 4.5:1 on the card surfaces', () => {
    for (const fg of TEXT_COLORS) {
      for (const bg of [color.page, color.surface, color.surfaceAlt]) {
        assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}: ${contrast(fg, bg).toFixed(2)}`);
      }
    }
  });
});

describe('cssColors', () => {
  const css = `
    /* --commented: #123456; */
    :root {
      --ink: #0A0A0B;
      --short: #fA3;
      --page: var(--ink);
      --alias: var(--page);
      --broken: var(--missing);
      --loop-a: var(--loop-b);
      --loop-b: var(--loop-a);
    }
    .paper { --page: #ffffff; }
  `;
  const colorOf = cssColors(css);

  it('reads a :root custom property as lowercase #rrggbb, expanding #rgb', () => {
    assert.equal(colorOf('ink'), '#0a0a0b');
    assert.equal(colorOf('short'), '#ffaa33');
  });

  it('follows var() references, also chained, and ignores other blocks', () => {
    assert.equal(colorOf('page'), '#0a0a0b');
    assert.equal(colorOf('alias'), '#0a0a0b');
  });

  it('fails naming the property that is missing, commented out or referenced but undefined', () => {
    assert.throws(() => colorOf('nope'), { message: 'tokens.css has no --nope' });
    assert.throws(() => colorOf('commented'), { message: 'tokens.css has no --commented' });
    assert.throws(() => colorOf('broken'), { message: 'tokens.css has no --missing' });
  });

  it('fails on a var() cycle instead of overflowing the stack', () => {
    assert.throws(() => colorOf('loop-a'), { message: 'tokens.css has a var() cycle: --loop-a -> --loop-b -> --loop-a' });
  });
});

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    assert.equal(escapeXml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;');
  });
});
