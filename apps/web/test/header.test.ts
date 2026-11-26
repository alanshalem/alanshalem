import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/*
 * Orden de la cabecera (L13): en escritorio marca · links · ES|EN; en el celular marca · ES|EN · ☰ con el panel abajo.
 * El orden del HTML tiene que ser el que se ve en los dos tamaños (WCAG 2.4.3) sin `order` en el CSS.
 */
const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
const markup = header.slice(header.indexOf('<header'), header.indexOf('</header>'));

const at = (needle: string): number => {
  const index = markup.indexOf(needle);
  assert.ok(index >= 0, `falta ${needle}`);
  return index;
};

describe('cabecera: el HTML va en el orden en que se ve (WCAG 2.4.3, L13)', () => {
  it('marca, links de escritorio, ES|EN, ☰ y su panel', () => {
    const order = ['class="brand"', 'site-nav--bar', 'class="lang-switch"', 'class="nav-toggle"', 'id="site-nav"'].map(at);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  it('el panel va justo después del ☰ (el CSS lo muestra con `.nav-toggle[aria-expanded="true"] + .site-nav`)', () => {
    assert.match(markup, /aria-controls="site-nav"[^>]*>☰<\/button>\s*<nav id="site-nav"/);
  });

  it('las dos ubicaciones del menú salen de la misma lista (sin copiar los enlaces)', () => {
    assert.equal(markup.match(/\{links\.map\(/g)?.length, 2);
    // Marca, idioma y los dos lugares del menú: ningún enlace del menú escrito a mano.
    assert.equal(markup.match(/<a\b/g)?.length, 4);
    assert.equal(markup.match(/<a \{\.\.\.attributes\}>\{label\}<\/a>/g)?.length, 2);
  });
});
