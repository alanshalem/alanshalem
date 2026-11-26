import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderMarkdown, toPlainText, type RenderOptions } from '../src/index.ts';

/** Extensiones de Markdown de editor-pro (L4): notas al pie, cajas, figuras y tipografía inteligente. */

const html = (md: string, options: RenderOptions = {}): string => renderMarkdown(md, options).html;

const BACK = '↩\uFE0E';
const ref = (slug: string, number: number, refId = `fnref-${slug}`): string =>
  `<sup class="footnote-ref"><a href="#fn-${slug}" id="${refId}">${number}</a></sup>`;
const backref = (refId: string, label = 'Volver al texto'): string =>
  `<a href="#${refId}" class="footnote-backref" aria-label="${label}">${BACK}</a>`;
const section = (items: string[], label = 'Notas al pie'): string =>
  `<section class="footnotes" aria-label="${label}">\n<ol>\n${items.join('\n')}\n</ol>\n</section>`;

describe('notas al pie', () => {
  it('referencia numerada con id y sección final con vuelta al texto', () => {
    assert.equal(
      html('Texto[^1] fin.\n\n[^1]: La nota.'),
      `<p>Texto${ref('1', 1)} fin.</p>\n` +
        section([`<li id="fn-1"><p>La nota. ${backref('fnref-1')}</p></li>`]),
    );
  });

  it('numera por orden de primera referencia y usa ids slugificados', () => {
    const out = html('a[^Zeta] b[^alfa]\n\n[^alfa]: A\n[^Zeta]: Z');
    assert.ok(out.startsWith(`<p>a${ref('zeta', 1)} b${ref('alfa', 2)}</p>`));
    assert.ok(out.indexOf('<li id="fn-zeta">') < out.indexOf('<li id="fn-alfa">'));
  });

  it('cada referencia repetida tiene su id y su propia vuelta', () => {
    const out = html('x[^n] y[^n]\n\n[^n]: Nota');
    assert.ok(out.includes(`x${ref('n', 1)} y${ref('n', 1, 'fnref-n_2')}`));
    assert.ok(out.includes(`<li id="fn-n"><p>Nota ${backref('fnref-n')} ${backref('fnref-n_2')}</p></li>`));
  });

  it('una referencia sin definición queda como texto literal y no hay sección', () => {
    assert.equal(html('ver[^nada] acá'), '<p>ver[^nada] acá</p>');
  });

  it('las definiciones sin uso se descartan; con id repetido gana la primera', () => {
    const out = html('a[^1]\n\n[^1]: primera\n[^1]: segunda\n[^suelta]: nadie la usa');
    assert.ok(out.includes('<p>primera '));
    assert.ok(!out.includes('segunda'));
    assert.ok(!out.includes('nadie la usa'));
    assert.ok(!out.includes('[^'));
  });

  it('la definición continúa en las líneas indentadas', () => {
    const out = html('a[^1]\n\n[^1]: una nota\n    que sigue\n\nDespués');
    assert.ok(out.includes('<p>una nota\nque sigue '));
    assert.ok(out.includes('<p>Después</p>'));
  });

  it('una definición entre párrafos no los une', () => {
    assert.equal(html('uno[^1]\n[^1]: n\ndos').split('<section')[0], `<p>uno${ref('1', 1)}</p>\n<p>dos</p>\n`);
  });

  it('dentro de un bloque de código nada es nota', () => {
    assert.equal(html('```\na[^1]\n[^1]: no\n```'), '<pre tabindex="0"><code>a[^1]\n[^1]: no</code></pre>');
  });

  it('el texto de la nota admite formato en línea', () => {
    assert.ok(html('a[^1]\n\n[^1]: con **negrita** y `código`').includes('con <strong>negrita</strong> y <code>código</code>'));
  });

  it('una nota en un título no entra al id ni al texto del índice', () => {
    const result = renderMarkdown('## Historia[^1]\n\n[^1]: n');
    assert.deepEqual(result.headings, [{ level: 2, id: 'historia', text: 'Historia' }]);
    assert.ok(result.html.startsWith(`<h2 id="historia">Historia${ref('1', 1)}</h2>`));
  });

  it('en inglés los textos accesibles cambian', () => {
    const out = html('a[^1]\n\n[^1]: n', { lang: 'en' });
    assert.ok(out.includes('aria-label="Footnotes"'));
    assert.ok(out.includes(backref('fnref-1', 'Back to text')));
  });

  it('seguridad: el HTML en la nota se escapa', () => {
    const out = html('a[^x]\n\n[^x]: <script>alert(1)</script>');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });
});

describe('cajas destacadas', () => {
  it('> [!NOTE] es un <aside> con su título', () => {
    assert.equal(
      html('> [!NOTE]\n> Cuerpo'),
      '<aside class="callout callout-note">\n<p class="callout-title">Nota</p>\n<p>Cuerpo</p>\n</aside>',
    );
  });

  it('títulos por tipo e idioma (es por defecto)', () => {
    const title = (kind: string, lang?: 'es' | 'en'): string =>
      /<p class="callout-title">([^<]*)<\/p>/.exec(html(`> [!${kind}]\n> x`, lang ? { lang } : {}))?.[1] ?? '';
    assert.deepEqual(['NOTE', 'TIP', 'WARNING'].map((k) => title(k)), ['Nota', 'Puntos clave', 'Advertencia']);
    assert.deepEqual(['NOTE', 'TIP', 'WARNING'].map((k) => title(k, 'en')), ['Note', 'Key takeaways', 'Warning']);
  });

  it('el marcador no distingue mayúsculas', () => {
    assert.ok(html('> [!tip]\n> x').startsWith('<aside class="callout callout-tip">'));
    assert.ok(html('> [!Warning]\n> x').startsWith('<aside class="callout callout-warning">'));
  });

  it('admite contenido anidado (listas, código, varios párrafos)', () => {
    const out = html('> [!TIP]\n> - uno\n> - dos\n>\n> ```js\n> a()\n> ```\n>\n> Fin');
    assert.ok(out.includes('<ul>\n<li>uno</li>\n<li>dos</li>\n</ul>'));
    assert.ok(out.includes('<pre tabindex="0"><code class="language-js">a()</code></pre>'));
    assert.ok(out.endsWith('<p>Fin</p>\n</aside>'));
  });

  it('tipo desconocido o texto en la línea del marcador: cita común', () => {
    assert.equal(html('> [!CAUTION]\n> x'), '<blockquote>\n<p>[!CAUTION]\nx</p>\n</blockquote>');
    assert.equal(html('> [!NOTE] texto'), '<blockquote>\n<p>[!NOTE] texto</p>\n</blockquote>');
  });

  it('una cita sin marcador no cambia', () => {
    assert.equal(html('> hola\n> chau'), '<blockquote>\n<p>hola\nchau</p>\n</blockquote>');
  });

  it('un idioma desconocido usa los textos en español', () => {
    assert.ok(html('> [!NOTE]\n> x', { lang: 'fr' as never }).includes('<p class="callout-title">Nota</p>'));
  });

  it('seguridad: el cuerpo se escapa', () => {
    const out = html('> [!WARNING]\n> <script>alert(1)</script>');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'));
  });
});

describe('figuras con epígrafe', () => {
  const figure = (md: string): string => html(md, { figures: true });

  it('imagen sola con título => <figure> + <figcaption> con formato en línea', () => {
    assert.equal(
      figure('![Faro](/img/faro.jpg "Faro de *noche*")'),
      '<figure><img src="/img/faro.jpg" alt="Faro" loading="lazy" decoding="async">' +
        '<figcaption>Faro de <em>noche</em></figcaption></figure>',
    );
  });

  it('sin título o con texto alrededor queda la imagen de siempre', () => {
    assert.equal(figure('![a](/a.png)'), '<p><img src="/a.png" alt="a" loading="lazy" decoding="async"></p>');
    assert.equal(
      figure('Mirá ![a](/a.png "t")'),
      '<p>Mirá <img src="/a.png" alt="a" title="t" loading="lazy" decoding="async"></p>',
    );
    assert.ok(figure('![a](/a.png "t") ![b](/b.png "u")').startsWith('<p>'));
  });

  it('sin la opción figures la salida no cambia', () => {
    assert.equal(
      html('![gato](/img/gato.png "Mi gato")'),
      '<p><img src="/img/gato.png" alt="gato" title="Mi gato" loading="lazy" decoding="async"></p>',
    );
  });

  it('seguridad: epígrafe y alt se escapan', () => {
    const out = figure('![x"<b>](/x.png "<script>alert(1)</script>")');
    assert.ok(!out.includes('<script>') && !out.includes('<b>'));
    assert.ok(out.includes('alt="x&quot;&lt;b&gt;"'));
    assert.ok(out.includes('<figcaption>&lt;script&gt;alert(1)&lt;/script&gt;</figcaption>'));
  });

  it('con URL insegura no hay figura: queda solo el alt', () => {
    assert.equal(figure('![ojo](javascript:alert(1) "t")'), '<p>ojo</p>');
  });
});

describe('tipografía inteligente', () => {
  const smart = (md: string, lang: 'es' | 'en' = 'es'): string => html(md, { smartTypography: true, lang });

  it('comillas, rayas, puntos suspensivos y apóstrofos', () => {
    assert.equal(
      smart(`"Hola" -- dijo --- 'bien'... don't`),
      '<p>“Hola” – dijo — ‘bien’… don’t</p>',
    );
  });

  it('comillas anidadas y alrededor de énfasis o signos de apertura', () => {
    assert.equal(smart(`"ella dijo 'hola'"`), '<p>“ella dijo ‘hola’”</p>');
    assert.equal(smart('"**hola**" y ¿"sí"?'), '<p>“<strong>hola</strong>” y ¿“sí”?</p>');
    assert.equal(smart('(“ya”) y\n"otra"'), '<p>(“ya”) y\n“otra”</p>');
  });

  it('las mismas comillas tipográficas en español e inglés', () => {
    assert.equal(smart('"a"', 'es'), smart('"a"', 'en'));
  });

  it('nunca dentro de código', () => {
    assert.equal(smart('`"a" -- b...`'), '<p><code>&quot;a&quot; -- b...</code></p>');
    assert.equal(smart('```\n"a" -- b\n```'), '<pre tabindex="0"><code>&quot;a&quot; -- b</code></pre>');
  });

  it('nunca en URLs ni en atributos', () => {
    assert.equal(
      smart('[x--y](/a--b "t\'s")'),
      '<p><a href="/a--b" title="t&#39;s">x–y</a></p>',
    );
    assert.equal(
      smart('<https://x.com/a--b>'),
      '<p><a href="https://x.com/a--b" rel="noopener noreferrer">https://x.com/a--b</a></p>',
    );
    assert.equal(
      smart(`![it's](/i--1.png "a--b")`),
      '<p><img src="/i--1.png" alt="it&#39;s" title="a--b" loading="lazy" decoding="async"></p>',
    );
    assert.equal(smart('ver https://x.com/a--b...c "ok"'), '<p>ver https://x.com/a--b...c “ok”</p>');
  });

  it('un backslash deja la comilla recta', () => {
    assert.equal(smart('\\"a\\"'), '<p>&quot;a&quot;</p>');
  });

  it('desactivada por defecto', () => {
    assert.equal(html(`"a" -- b...`), '<p>&quot;a&quot; -- b...</p>');
  });
});

describe('preservación', () => {
  it('Markdown sin sintaxis nueva sale igual con todas las opciones nuevas', () => {
    const md = '## Título\n\nUn párrafo con **negrita** y [link](/x).\n\n> cita\n\n- a\n- b\n\n![img](/i.png)';
    assert.equal(html(md, { lang: 'en', figures: true, smartTypography: true }), html(md));
  });

  it('toPlainText sigue sin etiquetas con las extensiones', () => {
    assert.equal(toPlainText('> [!NOTE]\n> hola'), 'Nota hola');
  });
});
