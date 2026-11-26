import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as markdown from '../src/index.ts';
import { renderMarkdown, type RenderOptions } from '../src/index.ts';

/** Reglas de accesibilidad y de estructura que el HTML generado tiene que cumplir (plataforma-calidad U1, L4, L5). */

const html = (md: string, options: RenderOptions = {}): string => renderMarkdown(md, options).html;

describe('regiones con scroll enfocables con el teclado (WCAG 2.1.1, L4 P1-3)', () => {
  it('un bloque de código cercado es un <pre tabindex="0">', () => {
    assert.equal(html('```js\na()\n```'), '<pre tabindex="0"><code class="language-js">a()</code></pre>');
    assert.equal(html('```\nx\n```'), '<pre tabindex="0"><code>x</code></pre>');
  });

  it('la tabla va en una región enfocable con nombre, en el idioma del post', () => {
    const table = '| a | b |\n|---|---|\n| 1 | 2 |';
    const wrap = (label: string): string => `<div class="table-wrap" tabindex="0" role="region" aria-label="${label}"><table>`;
    assert.ok(html(table).startsWith(wrap('Tabla')), 'sin idioma: español');
    assert.ok(html(table, { lang: 'es' }).startsWith(wrap('Tabla')));
    assert.ok(html(table, { lang: 'en' }).startsWith(wrap('Table')));
  });
});

describe('minHeadingLevel: el título de la página es el único h1 (L5 "## sección, ### subsección")', () => {
  const options: RenderOptions = { minHeadingLevel: 2 };

  it('## es h2, ### es h3 y un # del cuerpo se trata como sección (h2)', () => {
    assert.equal(html('## Sección', options), '<h2 id="seccion">Sección</h2>');
    assert.equal(html('### Subsección', options), '<h3 id="subseccion">Subsección</h3>');
    assert.equal(html('# Título', options), '<h2 id="titulo">Título</h2>');
  });

  it('los niveles del índice son los del HTML', () => {
    const { headings } = renderMarkdown('# A\n\n## B\n\n### C\n\n#### D', options);
    assert.deepEqual(headings.map((heading) => heading.level), [2, 2, 3, 4]);
  });

  it('también dentro de una cita, y se limita a 1..6', () => {
    assert.equal(html('> # Adentro', options), '<blockquote>\n<h2>Adentro</h2>\n</blockquote>');
    assert.equal(html('# Uno', { minHeadingLevel: 9 }), '<h6 id="uno">Uno</h6>');
    assert.equal(html('# Uno', { minHeadingLevel: -3 }), '<h1 id="uno">Uno</h1>');
  });

  it('sin la opción no cambia nada: # es h1 y headingOffset sigue bajando niveles', () => {
    assert.equal(html('# Uno'), '<h1 id="uno">Uno</h1>');
    assert.equal(html('## Dos', { headingOffset: 1 }), '<h3 id="dos">Dos</h3>');
    assert.equal(html('# Uno', { headingOffset: 1, minHeadingLevel: 2 }), '<h2 id="uno">Uno</h2>');
  });
});

describe('POST_BODY_RENDER_OPTIONS: las opciones del cuerpo de un post, compartidas por el sitio y la vista previa', () => {
  it('títulos estándar, figuras y tipografía inteligente; el idioma lo agrega cada post', () => {
    assert.deepEqual(markdown.POST_BODY_RENDER_OPTIONS, { minHeadingLevel: 2, smartTypography: true, figures: true });
    const { html: out } = renderMarkdown('# A\n\n## B\n\n### C\n\n"x"', { ...markdown.POST_BODY_RENDER_OPTIONS, lang: 'en' });
    assert.equal(out, '<h2 id="a">A</h2>\n<h2 id="b">B</h2>\n<h3 id="c">C</h3>\n<p>“x”</p>');
  });
});
