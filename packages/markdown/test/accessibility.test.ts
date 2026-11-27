import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as markdown from '../src/index.ts';
import { renderMarkdown, type RenderOptions } from '../src/index.ts';

/** Accessibility and structure rules the generated HTML must meet. */

const html = (md: string, options: RenderOptions = {}): string => renderMarkdown(md, options).html;

describe('scrollable regions are keyboard focusable (WCAG 2.1.1)', () => {
  it('a fenced code block is a <pre tabindex="0">', () => {
    assert.equal(html('```js\na()\n```'), '<pre tabindex="0"><code class="language-js">a()</code></pre>');
    assert.equal(html('```\nx\n```'), '<pre tabindex="0"><code>x</code></pre>');
  });

  it('the table sits in a named focusable region, in the post language', () => {
    const table = '| a | b |\n|---|---|\n| 1 | 2 |';
    const wrap = (label: string): string => `<div class="table-wrap" tabindex="0" role="region" aria-label="${label}"><table>`;
    assert.ok(html(table).startsWith(wrap('Tabla')), 'no language: Spanish');
    assert.ok(html(table, { lang: 'es' }).startsWith(wrap('Tabla')));
    assert.ok(html(table, { lang: 'en' }).startsWith(wrap('Table')));
  });
});

describe('minHeadingLevel: the page title is the only h1 ("## section, ### subsection")', () => {
  const options: RenderOptions = { minHeadingLevel: 2 };

  it('## is h2, ### is h3 and a body # is treated as a section (h2)', () => {
    assert.equal(html('## Sección', options), '<h2 id="seccion">Sección</h2>');
    assert.equal(html('### Subsección', options), '<h3 id="subseccion">Subsección</h3>');
    assert.equal(html('# Título', options), '<h2 id="titulo">Título</h2>');
  });

  it('the table of contents levels are the HTML ones', () => {
    const { headings } = renderMarkdown('# A\n\n## B\n\n### C\n\n#### D', options);
    assert.deepEqual(headings.map((heading) => heading.level), [2, 2, 3, 4]);
  });

  it('inside a quote too, and clamped to 1..6', () => {
    assert.equal(html('> # Adentro', options), '<blockquote>\n<h2>Adentro</h2>\n</blockquote>');
    assert.equal(html('# Uno', { minHeadingLevel: 9 }), '<h6 id="uno">Uno</h6>');
    assert.equal(html('# Uno', { minHeadingLevel: -3 }), '<h1 id="uno">Uno</h1>');
  });

  it('without the option nothing changes: # is h1 and headingOffset still lowers levels', () => {
    assert.equal(html('# Uno'), '<h1 id="uno">Uno</h1>');
    assert.equal(html('## Dos', { headingOffset: 1 }), '<h3 id="dos">Dos</h3>');
    assert.equal(html('# Uno', { headingOffset: 1, minHeadingLevel: 2 }), '<h2 id="uno">Uno</h2>');
  });
});

describe('POST_BODY_RENDER_OPTIONS: the post body options, shared by the site and the preview', () => {
  it('standard headings, figures and smart typography; each post adds its language', () => {
    assert.deepEqual(markdown.POST_BODY_RENDER_OPTIONS, { minHeadingLevel: 2, smartTypography: true, figures: true });
    const { html: out } = renderMarkdown('# A\n\n## B\n\n### C\n\n"x"', { ...markdown.POST_BODY_RENDER_OPTIONS, lang: 'en' });
    assert.equal(out, '<h2 id="a">A</h2>\n<h2 id="b">B</h2>\n<h3 id="c">C</h3>\n<p>“x”</p>');
  });
});
