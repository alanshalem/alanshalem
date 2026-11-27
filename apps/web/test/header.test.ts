import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/*
 * Header order: on desktop brand · links · ES|EN; on phones brand · ES|EN · ☰ with the panel below.
 * The HTML order must be the one seen at both sizes (WCAG 2.4.3), without `order` in the CSS.
 */
const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
const markup = header.slice(header.indexOf('<header'), header.indexOf('</header>'));

const at = (needle: string): number => {
  const index = markup.indexOf(needle);
  assert.ok(index >= 0, `missing ${needle}`);
  return index;
};

describe('header: the HTML goes in the order it is seen (WCAG 2.4.3)', () => {
  it('brand, desktop links, ES|EN, ☰ and its panel', () => {
    const order = ['class="brand"', 'site-nav--bar', 'class="lang-switch"', 'class="nav-toggle"', 'id="site-nav"'].map(at);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  it('the panel comes right after the ☰ (the CSS shows it with `.nav-toggle[aria-expanded="true"] + .site-nav`)', () => {
    assert.match(markup, /aria-controls="site-nav"[^>]*>☰<\/button>\s*<nav id="site-nav"/);
  });

  it('the two places of the menu come from the same list (no copied links)', () => {
    assert.equal(markup.match(/\{links\.map\(/g)?.length, 2);
    // Brand, language and the two places of the menu: no menu link written by hand.
    assert.equal(markup.match(/<a\b/g)?.length, 4);
    assert.equal(markup.match(/<a \{\.\.\.attributes\}>\{label\}<\/a>/g)?.length, 2);
  });
});
