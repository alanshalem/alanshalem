import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * How formulas look (MathML from @blog/math inside .prose): the math font that matches the body's Pagella, self-hosted
 * and only used by <math> (so only pages with a formula download it), and display math that scrolls inside its own
 * box instead of widening the page on mobile.
 */

const read = (specifier: string): string => readFileSync(new URL(import.meta.resolve(specifier)), 'utf8');
const tokens = read('@blog/tokens/tokens.css');
const prose = read('@blog/tokens/prose.css');

/** The body of the first block whose selector is exactly `selector` (these stylesheets have no nesting). */
function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(String.raw`(?:^|[}\s])${escaped}\s*\{([^}]*)\}`, 'm').exec(css);
  assert.ok(rule, `missing rule ${selector}`);
  return rule[1]!;
}

describe('math font', () => {
  it('Pagella Math is self-hosted from /fonts, swaps, and its file and license note are in public/fonts', () => {
    const face = /@font-face\s*\{[^}]*font-family:\s*"Pagella Math";[^}]*\}/.exec(tokens)?.[0] ?? '';
    assert.match(face, /src:\s*url\("\/fonts\/pagella-math\.woff2"\)\s*format\("woff2"\)/);
    assert.match(face, /font-display:\s*swap/);
    assert.ok(existsSync(new URL('../public/fonts/pagella-math.woff2', import.meta.url)));
    const licenses = readFileSync(new URL('../public/fonts/LICENSES.txt', import.meta.url), 'utf8');
    assert.match(licenses, /TeX Gyre Pagella Math \(pagella-math\.woff2\) — GUST Font License/);
  });

  it('the --font-math token names it first, then the generic math family', () => {
    assert.match(tokens, /--font-math:\s*"Pagella Math",\s*math;/);
  });

  it('only <math> uses it, so a page without formulas never downloads it', () => {
    assert.match(block(prose, '.prose math'), /font-family:\s*var\(--font-math\)/);
    const css = `${tokens}\n${prose}`.replace(/\/\*[\s\S]*?\*\//g, '');
    const users = [...css.matchAll(/([^{}]+)\{[^}]*var\(--font-math\)[^}]*\}/g)].map((m) => m[1]!.trim());
    assert.deepEqual(users, ['.prose math']);
  });
});

describe('inline math', () => {
  it('the text written against a formula stays on its line with it', () => {
    assert.match(block(prose, '.prose .math-nowrap'), /white-space:\s*nowrap/);
  });
});

describe('display math', () => {
  it('scrolls horizontally inside its own box, never the page', () => {
    assert.match(block(prose, '.prose .math-display'), /overflow-x:\s*auto/);
  });

  it('is centered while it fits and starts at the left edge when it scrolls (no unreachable left part)', () => {
    const formula = block(prose, '.prose .math-display > math');
    assert.match(formula, /width:\s*max-content/);
    assert.match(formula, /margin-inline:\s*auto/);
  });
});
