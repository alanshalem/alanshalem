import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { POST_BODY_RENDER_OPTIONS, renderMarkdown } from '@blog/markdown';
import * as math from '../src/index.ts';
import { MATH_RENDER_OPTIONS, postBodyOptions, renderTex } from '../src/index.ts';

/** TeX → MathML with Temml, for post bodies: the site build and the admin preview inject the same function. */

const page = (md: string): string => renderMarkdown(md, postBodyOptions('es')).html;

/** Every tag name in an HTML string, lowercased. */
const tagsOf = (html: string): string[] => [...html.matchAll(/<\s*([a-z][\w-]*)/gi)].map((m) => (m[1] ?? '').toLowerCase());

describe('public API', () => {
  it('exports renderTex, MATH_RENDER_OPTIONS and postBodyOptions', () => {
    assert.deepEqual(Object.keys(math).sort(), ['MATH_RENDER_OPTIONS', 'postBodyOptions', 'renderTex']);
  });
});

describe('renderTex', () => {
  it('inline TeX becomes inline MathML', () => {
    assert.equal(
      renderTex('N_{\\text{ef}}', false),
      '<math><msub><mi>N</mi><mtext>ef</mtext></msub></math>',
    );
  });

  it('display TeX becomes block MathML', () => {
    assert.match(renderTex('D = \\sigma^2/2', true), /^<math display="block"[^>]*>.*<\/math>$/);
  });

  it("renders the author's reference formula with real operators and a superscript", () => {
    const out = renderTex('\\mu - \\sigma^2/2', false);
    assert.ok(out.includes('<mi>μ</mi><mo>−</mo><msup><mi>σ</mi><mn>2</mn></msup>'), out);
  });

  it('invalid TeX never throws: it shows its source, escaped, in an error style', () => {
    assert.equal(renderTex('\\frac{1}{', false), '<code class="math-error">\\frac{1}{</code>');
    assert.equal(renderTex('\\unknowncmd x', true), '<code class="math-error">\\unknowncmd x</code>');
    assert.equal(renderTex('\\text{<b>&}', false), '<code class="math-error">\\text{&lt;b&gt;&amp;}</code>');
  });

  it('a macro that never stops expanding is an error, not a hang', () => {
    assert.equal(renderTex('\\def\\a{\\a\\a}\\a', false), '<code class="math-error">\\def\\a{\\a\\a}\\a</code>');
  });
});

describe('security: math is never a path for HTML or URLs', () => {
  it('<script> inside math is text, never a tag', () => {
    for (const tex of ['<script>alert(1)</script>', '\\text{<script>alert(1)</script>}']) {
      const out = renderTex(tex, false);
      assert.ok(!tagsOf(out).includes('script'), out);
      assert.ok(!out.includes('<script'), out);
    }
  });

  it('\\href, \\url, \\html* and \\includegraphics never produce a link, an image or an attribute', () => {
    for (const tex of [
      '\\href{javascript:alert(1)}{x}',
      '\\url{https://e.com}',
      '\\htmlClass{a}{b}',
      '\\htmlId{a}{b}',
      '\\htmlStyle{color:red}{b}',
      '\\htmlData{a=b}{c}',
      '\\class{a}{b}',
      '\\id{a}{b}',
      '\\style{color:red}{b}',
      '\\data{a=b}{c}',
      '\\includegraphics{/x.png}',
    ]) {
      const out = renderTex(tex, false);
      assert.equal(out, `<code class="math-error">${tex.replace(/&/g, '&amp;')}</code>`, tex);
    }
  });

  it('a color cannot smuggle CSS or an attribute', () => {
    for (const tex of ['\\color{red;background:url(https://e.com/x)}{x}', '\\textcolor{red" onclick="x}{y}']) {
      assert.ok(renderTex(tex, false).startsWith('<code class="math-error">'), tex);
    }
  });

  it('through the whole post body render: no executable tag nor javascript: link', () => {
    const out = page('$\\href{javascript:alert(1)}{x}$ y $<script>$\n\n$$\n</math><script>alert(1)</script>\n$$');
    assert.ok(!/<script/i.test(out), out);
    assert.ok(!/href=/i.test(out), out);
    assert.ok(!/javascript:/i.test(out.replace(/<code class="math-error">[^<]*<\/code>/g, '')), out);
  });
});

describe('post body wiring: the site and the admin preview render the same', () => {
  it('postBodyOptions is the markdown post body preset plus the math renderer and the language', () => {
    assert.deepEqual(postBodyOptions('en'), { ...POST_BODY_RENDER_OPTIONS, math: renderTex, lang: 'en' });
    assert.deepEqual(MATH_RENDER_OPTIONS, { math: renderTex });
    assert.ok(Object.isFrozen(MATH_RENDER_OPTIONS));
  });

  it("the author's examples render as MathML, prices stay text", () => {
    const out = page('Tasa ($\\text{tiempo}^{-1}$), ($\\text{tiempo}^{-1/2}$), ($D = \\sigma^2/2$), ($N_{\\text{ef}}$).\n\ncuesta $5 y $10');
    assert.equal((out.match(/<math>/g) ?? []).length, 4, out);
    assert.ok(out.endsWith('<p>cuesta $5 y $10</p>'), out);
  });

  it('display math sits in its scrollable box', () => {
    assert.match(page('$$\n\\mu - \\sigma^2/2\n$$'), /^<div class="math-display" tabindex="0"><math display="block"/);
  });
});
