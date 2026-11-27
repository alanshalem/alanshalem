import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTypesetter, measure, wrap, type TextStyle } from '../src/type.ts';

const display: TextStyle = { face: 'display', size: 100, fill: '#fff' };
const ui: TextStyle = { face: 'ui', size: 10, fill: '#fff' };

describe('measure', () => {
  it('scales with the size and applies the pair kerning (AV tightens)', () => {
    const a = measure('A', display);
    assert.ok(a > 0);
    assert.equal(measure('A', { ...display, size: 50 }), a / 2);
    assert.ok(measure('AV', display) < a + measure('V', display));
  });

  it('tracking (em) is added between letters, not after the last one', () => {
    const plain = measure('ABC', ui);
    assert.ok(Math.abs(measure('ABC', { ...ui, tracking: 0.1 }) - (plain + 2 * 0.1 * 10)) < 1e-9);
  });

  it('a character outside the glyph set measures as "?"', () => {
    assert.equal(measure('ñ', ui), measure('?', ui));
  });
});

describe('wrap', () => {
  it('wraps at words without exceeding the width and without losing any', () => {
    const text = 'Static Astro site, a .NET API and a native Markdown editor';
    const lines = wrap(text, ui, 120);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(measure(line, ui) <= 120, line);
    assert.equal(lines.join(' '), text);
  });

  it('a word wider than the line stays alone on its line', () => {
    assert.deepEqual(wrap('a Supercalifragilistic b', ui, 20), ['a', 'Supercalifragilistic', 'b']);
  });
});

describe('createTypesetter', () => {
  it('draws each letter with <use> and defines each glyph only once', () => {
    const t = createTypesetter();
    const run = t.text('Alan Alan', 10, 20, display);
    assert.equal(run.match(/<use /g)?.length, 8); // spaces advance but are not drawn
    const defs = t.defs();
    assert.equal(defs.match(/<path id=/g)?.length, 4); // A, l, a and n
    for (const ch of ['A', 'l', 'a', 'n']) assert.ok(defs.includes(`id="d${ch.codePointAt(0)!.toString(36)}"`), ch);
  });

  it('the same character in another face is another glyph', () => {
    const t = createTypesetter();
    t.text('A', 0, 0, display);
    t.text('A', 0, 0, ui);
    assert.equal(t.defs().match(/<path id=/g)?.length, 2);
  });

  it('puts the baseline at y and aligns to the middle or the end with the measured width', () => {
    const t = createTypesetter();
    const width = measure('Hi', display);
    assert.match(t.text('Hi', 100, 50, display), /transform="translate\(100 50\) scale\(0\.1\)"/);
    assert.match(t.text('Hi', 100, 50, display, 'end'), new RegExp(`translate\\(${+(100 - width).toFixed(2)} 50\\)`));
    assert.match(t.text('Hi', 100, 50, display, 'middle'), new RegExp(`translate\\(${+(100 - width / 2).toFixed(2)} 50\\)`));
  });

  it('the color goes on the group; without visible glyphs it emits nothing', () => {
    const t = createTypesetter();
    assert.match(t.text('x', 0, 0, { ...ui, fill: '#c8c8c2' }), /^<g fill="#c8c8c2"/);
    assert.equal(t.text('   ', 0, 0, ui), '');
  });
});
