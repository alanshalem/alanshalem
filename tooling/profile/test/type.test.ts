import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTypesetter, measure, wrap, type TextStyle } from '../src/type.ts';

const display: TextStyle = { face: 'display', size: 100, fill: '#fff' };
const ui: TextStyle = { face: 'ui', size: 10, fill: '#fff' };

describe('measure', () => {
  it('escala con el tamaño y aplica el kerning del par (AV se cierra)', () => {
    const a = measure('A', display);
    assert.ok(a > 0);
    assert.equal(measure('A', { ...display, size: 50 }), a / 2);
    assert.ok(measure('AV', display) < a + measure('V', display));
  });

  it('el tracking (em) se suma entre letras, no después de la última', () => {
    const plain = measure('ABC', ui);
    assert.ok(Math.abs(measure('ABC', { ...ui, tracking: 0.1 }) - (plain + 2 * 0.1 * 10)) < 1e-9);
  });

  it('un carácter fuera del juego de glifos mide como "?"', () => {
    assert.equal(measure('ñ', ui), measure('?', ui));
  });
});

describe('wrap', () => {
  it('parte en palabras sin pasarse del ancho y sin perder ninguna', () => {
    const text = 'Static Astro site, a .NET API and a native Markdown editor';
    const lines = wrap(text, ui, 120);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(measure(line, ui) <= 120, line);
    assert.equal(lines.join(' '), text);
  });

  it('una palabra más ancha que la línea queda sola en su línea', () => {
    assert.deepEqual(wrap('a Supercalifragilistic b', ui, 20), ['a', 'Supercalifragilistic', 'b']);
  });
});

describe('createTypesetter', () => {
  it('dibuja cada letra con <use> y define cada glifo una sola vez', () => {
    const t = createTypesetter();
    const run = t.text('Alan Alan', 10, 20, display);
    assert.equal(run.match(/<use /g)?.length, 8); // los espacios avanzan pero no se dibujan
    const defs = t.defs();
    assert.equal(defs.match(/<path id=/g)?.length, 4); // A, l, a y n
    for (const ch of ['A', 'l', 'a', 'n']) assert.ok(defs.includes(`id="d${ch.codePointAt(0)!.toString(36)}"`), ch);
  });

  it('el mismo carácter en otra cara es otro glifo', () => {
    const t = createTypesetter();
    t.text('A', 0, 0, display);
    t.text('A', 0, 0, ui);
    assert.equal(t.defs().match(/<path id=/g)?.length, 2);
  });

  it('ubica la línea base en y y alinea al medio o al final con el ancho medido', () => {
    const t = createTypesetter();
    const width = measure('Hi', display);
    assert.match(t.text('Hi', 100, 50, display), /transform="translate\(100 50\) scale\(0\.1\)"/);
    assert.match(t.text('Hi', 100, 50, display, 'end'), new RegExp(`translate\\(${+(100 - width).toFixed(2)} 50\\)`));
    assert.match(t.text('Hi', 100, 50, display, 'middle'), new RegExp(`translate\\(${+(100 - width / 2).toFixed(2)} 50\\)`));
  });

  it('el color va en el grupo; sin glifos visibles no emite nada', () => {
    const t = createTypesetter();
    assert.match(t.text('x', 0, 0, { ...ui, fill: '#c8c8c2' }), /^<g fill="#c8c8c2"/);
    assert.equal(t.text('   ', 0, 0, ui), '');
  });
});
