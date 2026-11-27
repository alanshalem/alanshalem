import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml, POST_BODY_RENDER_OPTIONS, renderMarkdown, type RenderOptions } from '../src/index.ts';

/*
 * TeX math, the GitHub way, behind the opt-in `math` option: the renderer finds the formulas and an injected function
 * turns each one into HTML (the site and the admin inject @blog/math). Delimiters follow pandoc's rule so prices stay
 * text: the opening `$` is not followed by whitespace; the closing `$` is not preceded by whitespace nor followed by
 * a digit.
 */

/** A stand-in for the real renderer: shows exactly which TeX arrived and whether it was display math. */
const fakeMath = (tex: string, display: boolean): string =>
  display ? `<math display="block">${escapeHtml(tex)}</math>` : `<math>${escapeHtml(tex)}</math>`;

const MATH: RenderOptions = { math: fakeMath };
const html = (md: string, options: RenderOptions = MATH): string => renderMarkdown(md, options).html;
const inline = (tex: string): string => `<math>${escapeHtml(tex)}</math>`;
const display = (tex: string): string =>
  `<div class="math-display" tabindex="0"><math display="block">${escapeHtml(tex)}</math></div>`;

describe('inline math: $...$', () => {
  it("renders the author's examples, verbatim", () => {
    assert.equal(html('($\\text{tiempo}^{-1}$)'), `<p>(${inline('\\text{tiempo}^{-1}')})</p>`);
    assert.equal(html('($\\text{tiempo}^{-1/2}$)'), `<p>(${inline('\\text{tiempo}^{-1/2}')})</p>`);
    assert.equal(html('($D = \\sigma^2/2$)'), `<p>(${inline('D = \\sigma^2/2')})</p>`);
    assert.equal(html('($N_{\\text{ef}}$)'), `<p>(${inline('N_{\\text{ef}}')})</p>`);
    assert.equal(html('$\\mu - \\sigma^2/2$'), `<p>${inline('\\mu - \\sigma^2/2')}</p>`);
  });

  it('inside a sentence, with the TeX passed raw (no Markdown inside math)', () => {
    assert.equal(
      html('La deriva es $\\mu - \\sigma^2/2$ por unidad de tiempo.'),
      `<p>La deriva es ${inline('\\mu - \\sigma^2/2')} por unidad de tiempo.</p>`,
    );
    assert.equal(html('$a_1 *b* \\_ c$'), `<p>${inline('a_1 *b* \\_ c')}</p>`);
  });

  it('prices stay text: the closing $ cannot be preceded by a space nor followed by a digit', () => {
    assert.equal(html('cuesta $5 y $10'), '<p>cuesta $5 y $10</p>');
    assert.equal(html('de $20,000 a $30,000'), '<p>de $20,000 a $30,000</p>');
    assert.equal(html('$x$5'), '<p>$x$5</p>');
  });

  it('the opening $ cannot be followed by a space, nor the closing one preceded by one', () => {
    assert.equal(html('un $ x$ y'), '<p>un $ x$ y</p>');
    assert.equal(html('un $x $ y'), '<p>un $x $ y</p>');
    assert.equal(html('un solo $ acá'), '<p>un solo $ acá</p>');
  });

  it('\\$ is a literal dollar, outside math and as an escaped dollar inside it', () => {
    assert.equal(html('\\$5 y \\$x\\$'), '<p>$5 y $x$</p>');
    assert.equal(html('$a \\$ b$'), `<p>${inline('a \\$ b')}</p>`);
  });

  it('never inside code spans, code blocks, link destinations, autolinks or bare URLs', () => {
    assert.equal(html('`$x$` y'), '<p><code>$x$</code> y</p>');
    assert.equal(html('```\n$x$\n```'), '<pre tabindex="0"><code>$x$</code></pre>');
    assert.equal(html('[a](/b?$x$)'), '<p><a href="/b?$x$">a</a></p>');
    assert.equal(html('<https://e.com/$x$>'), '<p><a href="https://e.com/$x$" rel="noopener noreferrer">https://e.com/$x$</a></p>');
    assert.equal(html('ver https://e.com/$x$ ok'), '<p>ver https://e.com/$x$ ok</p>');
    assert.equal(html('$a `b$` c'), '<p>$a <code>b$</code> c</p>');
  });

  it('a $$ run inside a paragraph is text; inline math is a single $', () => {
    assert.equal(html('a $$x$$ b'), '<p>a $$x$$ b</p>');
  });

  it('emphasis around math closes after it, and math inside emphasis, links and footnotes renders', () => {
    assert.equal(html('*a $b*c$*'), `<p><em>a ${inline('b*c')}</em></p>`);
    assert.equal(html('[ver $x$](/y)'), `<p><a href="/y">ver ${inline('x')}</a></p>`);
    assert.ok(html('a[^1]\n\n[^1]: nota $x^2$').includes(`<p>nota ${inline('x^2')} `));
  });

  it('smart typography never touches math, and still works around it', () => {
    const out = html('"si" -- $a--b...$ -- fin', { ...POST_BODY_RENDER_OPTIONS, math: fakeMath });
    assert.equal(out, `<p>“si” – ${inline('a--b...')} – fin</p>`);
  });
});

describe('display math', () => {
  it('$$ on its own lines, in a focusable box that scrolls by itself', () => {
    assert.equal(html('$$\nD = \\sigma^2/2\n$$'), display('D = \\sigma^2/2'));
    assert.equal(html('$$\n\\mu\n- \\sigma^2/2\n$$'), display('\\mu\n- \\sigma^2/2'));
  });

  it('a one-line $$ ... $$ paragraph', () => {
    assert.equal(html('$$ \\mu - \\sigma^2/2 $$'), display('\\mu - \\sigma^2/2'));
  });

  it('a fenced ```math block', () => {
    assert.equal(html('```math\n\\mu - \\sigma^2/2\n```'), display('\\mu - \\sigma^2/2'));
  });

  it('interrupts a paragraph and is one top-level block', () => {
    const md = 'La deriva:\n$$\nx\n$$\n\nfin';
    assert.equal(html(md), `<p>La deriva:</p>\n${display('x')}\n<p>fin</p>`);
    assert.deepEqual(renderMarkdown(md, MATH).blockStarts, [0, 1, 5]);
    assert.deepEqual(renderMarkdown('a\n\n```math\nx\n```\n\n$$ y $$', MATH).blockStarts, [0, 2, 6]);
  });

  it('inside a list item', () => {
    assert.equal(html('- a\n\n  $$\n  x\n  $$'), `<ul>\n<li><p>a</p>\n${display('x')}</li>\n</ul>`);
  });

  it('an unclosed $$, or one with a blank line before the closing $$, stays text', () => {
    assert.equal(html('$$\nx'), '<p>$$\nx</p>');
    assert.equal(html('$$\nx\n\ny\n$$'), '<p>$$\nx</p>\n<p>y\n$$</p>');
  });
});

describe('plain text carries the TeX source', () => {
  it('of each inline and display formula', () => {
    const { text } = renderMarkdown('Sea ($\\mu$) y\n\n$$\nx^2 < 1\n$$\n\n```math\ny\n```', MATH);
    assert.equal(text, 'Sea (\\mu) y x^2 < 1 y');
  });
});

describe('the math function', () => {
  it('is called once per formula, with display set only for display math', () => {
    const calls: Array<[string, boolean]> = [];
    renderMarkdown('$a$ y $b$\n\n$$\nc\n$$', { math: (tex, isDisplay) => (calls.push([tex, isDisplay]), '') });
    assert.deepEqual(calls, [['a', false], ['b', false], ['c', true]]);
  });

  it('is never called for Markdown without math', () => {
    let calls = 0;
    renderMarkdown('# T\n\ncuesta $5 y $10\n\n```\n$x$\n```', { math: () => String((calls += 1)) });
    assert.equal(calls, 0);
  });
});

describe('without the math option, $ renders exactly as before', () => {
  it('prices, a lone $, $...$ and $$ blocks are text; ```math is a code block', () => {
    assert.equal(html('cuesta $5 y $10', {}), '<p>cuesta $5 y $10</p>');
    assert.equal(html('un solo $ acá', {}), '<p>un solo $ acá</p>');
    assert.equal(html('($\\text{tiempo}^{-1}$)', {}), '<p>($\\text{tiempo}^{-1}$)</p>');
    assert.equal(html('$a *b* c$', {}), '<p>$a <em>b</em> c$</p>');
    assert.equal(html('$$\nx\n$$', {}), '<p>$$\nx\n$$</p>');
    assert.equal(html('```math\nx\n```', {}), '<pre tabindex="0"><code class="language-math">x</code></pre>');
    assert.deepEqual(renderMarkdown('a\n$$\nx\n$$').blockStarts, [0]);
  });

  it('Markdown without $ renders byte for byte the same with and without the option', () => {
    const md = '## T\n\n"Hola" -- *x* `c` [a](/b)\n\n- a\n- b\n\n> [!NOTE]\n> n[^1]\n\n[^1]: nota\n\n| a |\n|---|\n| 1 |';
    const plain = renderMarkdown(md, POST_BODY_RENDER_OPTIONS);
    assert.deepEqual(renderMarkdown(md, { ...POST_BODY_RENDER_OPTIONS, math: fakeMath }), plain);
  });
});
