import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderMarkdown, toPlainText, type RenderOptions } from '../src/index.ts';

/** Markdown extensions: footnotes, callouts, figures and smart typography. */

const html = (md: string, options: RenderOptions = {}): string => renderMarkdown(md, options).html;

const BACK = '↩\uFE0E';
const ref = (slug: string, number: number, refId = `fnref-${slug}`): string =>
  `<sup class="footnote-ref"><a href="#fn-${slug}" id="${refId}">${number}</a></sup>`;
const backref = (refId: string, label = 'Volver al texto'): string =>
  `<a href="#${refId}" class="footnote-backref" aria-label="${label}">${BACK}</a>`;
const section = (items: string[], label = 'Notas al pie'): string =>
  `<section class="footnotes" aria-label="${label}">\n<ol>\n${items.join('\n')}\n</ol>\n</section>`;

describe('footnotes', () => {
  it('a numbered reference with an id and a closing section linking back to the text', () => {
    assert.equal(
      html('Texto[^1] fin.\n\n[^1]: La nota.'),
      `<p>Texto${ref('1', 1)} fin.</p>\n` +
        section([`<li id="fn-1"><p>La nota. ${backref('fnref-1')}</p></li>`]),
    );
  });

  it('numbers by order of first reference and uses slugified ids', () => {
    const out = html('a[^Zeta] b[^alfa]\n\n[^alfa]: A\n[^Zeta]: Z');
    assert.ok(out.startsWith(`<p>a${ref('zeta', 1)} b${ref('alfa', 2)}</p>`));
    assert.ok(out.indexOf('<li id="fn-zeta">') < out.indexOf('<li id="fn-alfa">'));
  });

  it('each repeated reference has its own id and its own back link', () => {
    const out = html('x[^n] y[^n]\n\n[^n]: Nota');
    assert.ok(out.includes(`x${ref('n', 1)} y${ref('n', 1, 'fnref-n_2')}`));
    assert.ok(out.includes(`<li id="fn-n"><p>Nota ${backref('fnref-n')} ${backref('fnref-n_2')}</p></li>`));
  });

  it('a reference without a definition stays literal text and there is no section', () => {
    assert.equal(html('ver[^nada] acá'), '<p>ver[^nada] acá</p>');
  });

  it('unused definitions are dropped; with a repeated id the first one wins', () => {
    const out = html('a[^1]\n\n[^1]: primera\n[^1]: segunda\n[^suelta]: nadie la usa');
    assert.ok(out.includes('<p>primera '));
    assert.ok(!out.includes('segunda'));
    assert.ok(!out.includes('nadie la usa'));
    assert.ok(!out.includes('[^'));
  });

  it('the definition continues on indented lines', () => {
    const out = html('a[^1]\n\n[^1]: una nota\n    que sigue\n\nDespués');
    assert.ok(out.includes('<p>una nota\nque sigue '));
    assert.ok(out.includes('<p>Después</p>'));
  });

  it('a definition between paragraphs does not join them', () => {
    assert.equal(html('uno[^1]\n[^1]: n\ndos').split('<section')[0], `<p>uno${ref('1', 1)}</p>\n<p>dos</p>\n`);
  });

  it('nothing inside a code block is a footnote', () => {
    assert.equal(html('```\na[^1]\n[^1]: no\n```'), '<pre tabindex="0"><code>a[^1]\n[^1]: no</code></pre>');
  });

  it('the note text accepts inline formatting', () => {
    assert.ok(html('a[^1]\n\n[^1]: con **negrita** y `código`').includes('con <strong>negrita</strong> y <code>código</code>'));
  });

  it('a footnote in a title stays out of the id and the table of contents text', () => {
    const result = renderMarkdown('## Historia[^1]\n\n[^1]: n');
    assert.deepEqual(result.headings, [{ level: 2, id: 'historia', text: 'Historia' }]);
    assert.ok(result.html.startsWith(`<h2 id="historia">Historia${ref('1', 1)}</h2>`));
  });

  it('in English the accessible texts change', () => {
    const out = html('a[^1]\n\n[^1]: n', { lang: 'en' });
    assert.ok(out.includes('aria-label="Footnotes"'));
    assert.ok(out.includes(backref('fnref-1', 'Back to text')));
  });

  it('security: HTML in the note is escaped', () => {
    const out = html('a[^x]\n\n[^x]: <script>alert(1)</script>');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });
});

describe('callouts', () => {
  it('> [!NOTE] is an <aside> with its title', () => {
    assert.equal(
      html('> [!NOTE]\n> Cuerpo'),
      '<aside class="callout callout-note">\n<p class="callout-title">Nota</p>\n<p>Cuerpo</p>\n</aside>',
    );
  });

  it('titles per kind and language (es by default)', () => {
    const title = (kind: string, lang?: 'es' | 'en'): string =>
      /<p class="callout-title">([^<]*)<\/p>/.exec(html(`> [!${kind}]\n> x`, lang ? { lang } : {}))?.[1] ?? '';
    assert.deepEqual(['NOTE', 'TIP', 'WARNING'].map((k) => title(k)), ['Nota', 'Puntos clave', 'Advertencia']);
    assert.deepEqual(['NOTE', 'TIP', 'WARNING'].map((k) => title(k, 'en')), ['Note', 'Key takeaways', 'Warning']);
  });

  it('the marker is case-insensitive', () => {
    assert.ok(html('> [!tip]\n> x').startsWith('<aside class="callout callout-tip">'));
    assert.ok(html('> [!Warning]\n> x').startsWith('<aside class="callout callout-warning">'));
  });

  it('accepts nested content (lists, code, several paragraphs)', () => {
    const out = html('> [!TIP]\n> - uno\n> - dos\n>\n> ```js\n> a()\n> ```\n>\n> Fin');
    assert.ok(out.includes('<ul>\n<li>uno</li>\n<li>dos</li>\n</ul>'));
    assert.ok(out.includes('<pre tabindex="0"><code class="language-js">a()</code></pre>'));
    assert.ok(out.endsWith('<p>Fin</p>\n</aside>'));
  });

  it('an unknown kind or text on the marker line: a plain quote', () => {
    assert.equal(html('> [!CAUTION]\n> x'), '<blockquote>\n<p>[!CAUTION]\nx</p>\n</blockquote>');
    assert.equal(html('> [!NOTE] texto'), '<blockquote>\n<p>[!NOTE] texto</p>\n</blockquote>');
  });

  it('a quote without a marker does not change', () => {
    assert.equal(html('> hola\n> chau'), '<blockquote>\n<p>hola\nchau</p>\n</blockquote>');
  });

  it('an unknown language uses the Spanish texts', () => {
    assert.ok(html('> [!NOTE]\n> x', { lang: 'fr' as never }).includes('<p class="callout-title">Nota</p>'));
  });

  it('security: the body is escaped', () => {
    const out = html('> [!WARNING]\n> <script>alert(1)</script>');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'));
  });
});

describe('figures with a caption', () => {
  const figure = (md: string): string => html(md, { figures: true });

  it('a lone image with a title => <figure> + <figcaption> with inline formatting', () => {
    assert.equal(
      figure('![Faro](/img/faro.jpg "Faro de *noche*")'),
      '<figure><img src="/img/faro.jpg" alt="Faro" loading="lazy" decoding="async">' +
        '<figcaption>Faro de <em>noche</em></figcaption></figure>',
    );
  });

  it('without a title or with text around it stays the usual image', () => {
    assert.equal(figure('![a](/a.png)'), '<p><img src="/a.png" alt="a" loading="lazy" decoding="async"></p>');
    assert.equal(
      figure('Mirá ![a](/a.png "t")'),
      '<p>Mirá <img src="/a.png" alt="a" title="t" loading="lazy" decoding="async"></p>',
    );
    assert.ok(figure('![a](/a.png "t") ![b](/b.png "u")').startsWith('<p>'));
  });

  it('without the figures option the output does not change', () => {
    assert.equal(
      html('![gato](/img/gato.png "Mi gato")'),
      '<p><img src="/img/gato.png" alt="gato" title="Mi gato" loading="lazy" decoding="async"></p>',
    );
  });

  it('security: caption and alt are escaped', () => {
    const out = figure('![x"<b>](/x.png "<script>alert(1)</script>")');
    assert.ok(!out.includes('<script>') && !out.includes('<b>'));
    assert.ok(out.includes('alt="x&quot;&lt;b&gt;"'));
    assert.ok(out.includes('<figcaption>&lt;script&gt;alert(1)&lt;/script&gt;</figcaption>'));
  });

  it('with an unsafe URL there is no figure: only the alt is left', () => {
    assert.equal(figure('![ojo](javascript:alert(1) "t")'), '<p>ojo</p>');
  });
});

describe('smart typography', () => {
  const smart = (md: string, lang: 'es' | 'en' = 'es'): string => html(md, { smartTypography: true, lang });

  it('quotes, dashes, ellipsis and apostrophes', () => {
    assert.equal(
      smart(`"Hola" -- dijo --- 'bien'... don't`),
      '<p>“Hola” – dijo — ‘bien’… don’t</p>',
    );
  });

  it('nested quotes and quotes around emphasis or opening signs', () => {
    assert.equal(smart(`"ella dijo 'hola'"`), '<p>“ella dijo ‘hola’”</p>');
    assert.equal(smart('"**hola**" y ¿"sí"?'), '<p>“<strong>hola</strong>” y ¿“sí”?</p>');
    assert.equal(smart('(“ya”) y\n"otra"'), '<p>(“ya”) y\n“otra”</p>');
  });

  it('the same typographic quotes in Spanish and English', () => {
    assert.equal(smart('"a"', 'es'), smart('"a"', 'en'));
  });

  it('never inside code', () => {
    assert.equal(smart('`"a" -- b...`'), '<p><code>&quot;a&quot; -- b...</code></p>');
    assert.equal(smart('```\n"a" -- b\n```'), '<pre tabindex="0"><code>&quot;a&quot; -- b</code></pre>');
  });

  it('never in URLs or attributes', () => {
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

  it('a backslash keeps the straight quote', () => {
    assert.equal(smart('\\"a\\"'), '<p>&quot;a&quot;</p>');
  });

  it('off by default', () => {
    assert.equal(html(`"a" -- b...`), '<p>&quot;a&quot; -- b...</p>');
  });
});

describe('preservation', () => {
  it('Markdown without the new syntax renders the same with every new option', () => {
    const md = '## Título\n\nUn párrafo con **negrita** y [link](/x).\n\n> cita\n\n- a\n- b\n\n![img](/i.png)';
    assert.equal(html(md, { lang: 'en', figures: true, smartTypography: true }), html(md));
  });

  it('toPlainText stays tag-free with the extensions', () => {
    assert.equal(toPlainText('> [!NOTE]\n> hola'), 'Nota hola');
  });
});
