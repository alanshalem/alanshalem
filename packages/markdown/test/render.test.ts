import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { excerpt, readingTimeMinutes, renderMarkdown, sanitizeUrl, slugify } from '../src/index.ts';

const html = (md: string, headingOffset = 0): string => renderMarkdown(md, { headingOffset }).html;

describe('paragraphs and emphasis', () => {
  it('renders a paragraph', () => {
    assert.equal(html('Hola mundo'), '<p>Hola mundo</p>');
  });

  it('joins consecutive lines into one paragraph and splits on a blank line', () => {
    assert.equal(html('uno\ndos\n\ntres'), '<p>uno\ndos</p>\n<p>tres</p>');
  });

  it('bold, italic and strikethrough', () => {
    assert.equal(html('**a** *b* _c_ ~~d~~'), '<p><strong>a</strong> <em>b</em> <em>c</em> <del>d</del></p>');
  });

  it('nests different emphasis', () => {
    assert.equal(html('**negrita con *cursiva* adentro**'), '<p><strong>negrita con <em>cursiva</em> adentro</strong></p>');
  });

  it('a triple delimiter = italic + bold', () => {
    assert.equal(html('***hola***'), '<p><em><strong>hola</strong></em></p>');
  });

  it('an underscore inside a word is not emphasis', () => {
    assert.equal(html('usar snake_case_name acá'), '<p>usar snake_case_name acá</p>');
  });

  it('asterisks surrounded by spaces stay literal', () => {
    assert.equal(html('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
  });

  it('unclosed delimiters stay literal', () => {
    assert.equal(html('**sin cierre'), '<p>**sin cierre</p>');
  });

  it('backslash escapes give the literal character', () => {
    assert.equal(html('\\*no cursiva\\*'), '<p>*no cursiva*</p>');
  });

  it('two spaces at the end of a line = <br>', () => {
    assert.equal(html('a  \nb'), '<p>a<br>\nb</p>');
  });

  it('a backslash at the end of a line = <br>', () => {
    assert.equal(html('a\\\nb'), '<p>a<br>\nb</p>');
  });
});

describe('code', () => {
  it('inline code escapes HTML', () => {
    assert.equal(html('usar `<div>` ok'), '<p>usar <code>&lt;div&gt;</code> ok</p>');
  });

  it('inline code with backticks inside', () => {
    assert.equal(html('`` a`b ``'), '<p><code>a`b</code></p>');
  });

  it('emphasis is not parsed inside code', () => {
    assert.equal(html('`*a*`'), '<p><code>*a*</code></p>');
  });

  it('a block with a language', () => {
    assert.equal(
      html('```ts\nconst a = 1 < 2;\n```'),
      '<pre tabindex="0"><code class="language-ts">const a = 1 &lt; 2;</code></pre>',
    );
  });

  it('a block without a language or a closing fence runs to the end', () => {
    assert.equal(html('```\nlinea1\nlinea2'), '<pre tabindex="0"><code>linea1\nlinea2</code></pre>');
  });

  it('an odd language is not injected into the class attribute', () => {
    const out = html('```"><script>\nx\n```');
    assert.ok(!out.includes('<script>'));
  });

  it('the content of a block is not parsed as Markdown', () => {
    assert.equal(html('```\n# no es titulo\n- ni lista\n```'), '<pre tabindex="0"><code># no es titulo\n- ni lista</code></pre>');
  });

  it('a closing fence longer than the opening one closes too', () => {
    assert.equal(html('```\na\n`````\nafuera'), '<pre tabindex="0"><code>a</code></pre>\n<p>afuera</p>');
  });
});

describe('headings', () => {
  it('generates an id and records them', () => {
    const result = renderMarkdown('## Introducción a Ñandú');
    assert.equal(result.html, '<h2 id="introduccion-a-nandu">Introducción a Ñandú</h2>');
    assert.deepEqual(result.headings, [{ level: 2, id: 'introduccion-a-nandu', text: 'Introducción a Ñandú' }]);
  });

  it('repeated ids get a numeric suffix', () => {
    const ids = renderMarkdown('## Tema\n\n## Tema\n\n## Tema').headings.map((h) => h.id);
    assert.deepEqual(ids, ['tema', 'tema-2', 'tema-3']);
  });

  it('headingOffset lowers the levels and stops at h6', () => {
    assert.equal(html('# Título', 1), '<h2 id="titulo">Título</h2>');
    assert.equal(html('###### Hondo', 3), '<h6 id="hondo">Hondo</h6>');
  });

  it('removes the closing #s', () => {
    assert.equal(html('## Hola ##'), '<h2 id="hola">Hola</h2>');
  });

  it('#nospace is not a heading', () => {
    assert.equal(html('#hashtag'), '<p>#hashtag</p>');
  });

  it('the id comes from the plain text, without marks', () => {
    assert.equal(renderMarkdown('## Usar **`fetch`** con [docs](https://x.com)').headings[0]?.id, 'usar-fetch-con-docs');
  });

  it('a title without letters uses a fallback id', () => {
    assert.equal(renderMarkdown('## ???').headings[0]?.id, 'seccion');
  });

  it('a heading inside a quote stays out of the table of contents', () => {
    const result = renderMarkdown('> ## Adentro');
    assert.equal(result.headings.length, 0);
    assert.ok(result.html.includes('<h2>Adentro</h2>'));
  });
});

describe('lists', () => {
  it('a tight bullet list (no <p>)', () => {
    assert.equal(html('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  });

  it('an ordered list keeps its start number', () => {
    assert.equal(html('3. a\n4. b'), '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
  });

  it('a loose list (with a blank line) uses <p>', () => {
    assert.equal(html('- a\n\n- b'), '<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>');
  });

  it('nested lists', () => {
    assert.equal(html('- a\n  - b\n  - c\n- d'), '<ul>\n<li>a\n<ul>\n<li>b</li>\n<li>c</li>\n</ul></li>\n<li>d</li>\n</ul>');
  });

  it('an item can have several paragraphs', () => {
    const out = html('- a\n\n  más texto\n- b');
    assert.ok(out.includes('<li><p>a</p>\n<p>más texto</p></li>'));
  });

  it('changing the marker opens another list', () => {
    assert.equal(html('- a\n* b'), '<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>');
  });

  it('code inside an item', () => {
    const out = html('- paso\n\n  ```sh\n  ls\n  ```');
    assert.ok(out.includes('<pre tabindex="0"><code class="language-sh">ls</code></pre>'));
  });

  it('an ordered list not starting at 1 does not interrupt a paragraph', () => {
    assert.equal(html('en\n2024. fue un año'), '<p>en\n2024. fue un año</p>');
  });

  it('lazy continuation of an item', () => {
    assert.equal(html('- uno\ndos'), '<ul>\n<li>uno\ndos</li>\n</ul>');
  });
});

describe('quotes, rules and tables', () => {
  it('a simple quote', () => {
    assert.equal(html('> hola'), '<blockquote>\n<p>hola</p>\n</blockquote>');
  });

  it('a quote with lazy continuation and nested content', () => {
    const out = html('> a\nb\n>\n> - x');
    assert.ok(out.includes('<p>a\nb</p>'));
    assert.ok(out.includes('<li>x</li>'));
  });

  it('horizontal rule', () => {
    assert.equal(html('a\n\n---\n\nb'), '<p>a</p>\n<hr>\n<p>b</p>');
    assert.equal(html('***'), '<hr>');
  });

  it('a table with alignment', () => {
    const out = html('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    assert.ok(out.includes('<th>a</th><th class="align-center">b</th><th class="align-right">c</th>'));
    assert.ok(out.includes('<td>1</td><td class="align-center">2</td><td class="align-right">3</td>'));
    assert.ok(out.startsWith('<div class="table-wrap" tabindex="0" role="region" aria-label="Tabla"><table>'));
  });

  it('table: pads short rows, drops extra cells and honors \\|', () => {
    const out = html('a | b\n--|--\n1\n2 | 3 | 4\nx \\| y | z');
    assert.ok(out.includes('<td>1</td><td></td>'));
    assert.ok(out.includes('<td>2</td><td>3</td>'));
    assert.ok(!out.includes('<td>4</td>'));
    assert.ok(out.includes('<td>x | y</td>'));
  });

  it('a line with | and no delimiter row is a paragraph', () => {
    assert.equal(html('a | b'), '<p>a | b</p>');
  });
});

describe('links and images', () => {
  it('a link with a title; an external one gets rel', () => {
    assert.equal(
      html('[sitio](https://ejemplo.com "Ir")'),
      '<p><a href="https://ejemplo.com" title="Ir" rel="noopener noreferrer">sitio</a></p>',
    );
  });

  it('relative link and anchor', () => {
    assert.equal(html('[a](/blog/x) [b](#top)'), '<p><a href="/blog/x">a</a> <a href="#top">b</a></p>');
  });

  it('the link text accepts emphasis and code', () => {
    assert.equal(html('[**a** `b`](/x)'), '<p><a href="/x"><strong>a</strong> <code>b</code></a></p>');
  });

  it('a link does not nest inside another link', () => {
    const out = html('[a [b](/y) c](/x)');
    assert.equal((out.match(/<a /g) ?? []).length, 1);
  });

  it('balanced parentheses in the URL', () => {
    assert.equal(html('[w](https://es.wikipedia.org/wiki/Foo_(bar))'), '<p><a href="https://es.wikipedia.org/wiki/Foo_(bar)" rel="noopener noreferrer">w</a></p>');
  });

  it('image', () => {
    assert.equal(html('![gato](/img/gato.png "Mi gato")'), '<p><img src="/img/gato.png" alt="gato" title="Mi gato" loading="lazy" decoding="async"></p>');
  });

  it('autolink', () => {
    assert.equal(html('<https://ejemplo.com>'), '<p><a href="https://ejemplo.com" rel="noopener noreferrer">https://ejemplo.com</a></p>');
  });

  it('brackets without parentheses stay literal', () => {
    assert.equal(html('[no link]'), '<p>[no link]</p>');
  });
});

describe('security', () => {
  it('raw HTML is escaped', () => {
    assert.equal(html('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    assert.equal(html('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('javascript: in a link leaves only the text', () => {
    assert.equal(html('[clic](javascript:alert(1))'), '<p>clic</p>');
  });

  it('obfuscated schemes are rejected too', () => {
    assert.equal(html('[x](JaVaScRiPt:alert(1))'), '<p>x</p>');
    assert.equal(html('[x](<java\tscript:alert(1)>)'), '<p>x</p>');
    assert.equal(sanitizeUrl('java\u0000script:alert(1)'), null);
    assert.equal(sanitizeUrl(' javascript:alert(1)'), null);
    assert.equal(sanitizeUrl('vbscript:x'), null);
    assert.equal(sanitizeUrl('data:text/html;base64,PHNjcmlwdD4='), null);
  });

  it('an image with an unsafe URL leaves only the alt', () => {
    assert.equal(html('![ojo](javascript:alert(1))'), '<p>ojo</p>');
  });

  it('quotes in title, alt and href do not break the attribute', () => {
    assert.equal(
      html('[x](/a"onmouseover="alert(1) "t\\"itle")'),
      '<p><a href="/a&quot;onmouseover=&quot;alert(1)" title="t&quot;itle">x</a></p>',
    );
    assert.equal(
      html('![a"b](/x.png "t\\"1")'),
      '<p><img src="/x.png" alt="a&quot;b" title="t&quot;1" loading="lazy" decoding="async"></p>',
    );
  });

  it('accepts mailto and tel', () => {
    assert.equal(sanitizeUrl('mailto:a@b.com'), 'mailto:a@b.com');
    assert.equal(sanitizeUrl('tel:+5411'), 'tel:+5411');
  });

  it('spaces in the URL are encoded', () => {
    assert.equal(sanitizeUrl('/mi imagen.png'), '/mi%20imagen.png');
  });
});

describe('robustness', () => {
  it('empty input', () => {
    assert.deepEqual(renderMarkdown(''), { html: '', headings: [], blockStarts: [], anchorLines: [], text: '' });
  });

  it('normalizes Windows line breaks', () => {
    assert.equal(html('a\r\n\r\nb'), '<p>a</p>\n<p>b</p>');
  });

  it('very deep nesting does not blow the stack', () => {
    const md = `${'> '.repeat(500)}hola`;
    assert.ok(html(md).includes('hola'));
  });

  it('unclosed emphasis in a long text does not hang', () => {
    const start = performance.now();
    html('*a '.repeat(3000));
    assert.ok(performance.now() - start < 2000);
  });
});

describe('text utilities', () => {
  it('slugify', () => {
    assert.equal(slugify('  ¡Hola, Mundo! Año 2026  '), 'hola-mundo-ano-2026');
  });

  it('excerpt cuts at a word and adds …', () => {
    const out = excerpt('palabra '.repeat(50), 40);
    assert.ok(out.endsWith('…'));
    assert.ok(out.length <= 41);
    assert.ok(!out.includes('<'));
  });

  it('excerpt unescapes entities only once', () => {
    assert.equal(excerpt('a & b < c'), 'a & b < c');
  });

  it('reading time is at least 1 minute', () => {
    assert.equal(readingTimeMinutes('corto'), 1);
    assert.equal(readingTimeMinutes('palabra '.repeat(450)), 3);
  });
});

describe('one word-character rule for emphasis and apostrophes', () => {
  it('`_` inside a non-ASCII word stays literal and an apostrophe between letters of any script closes', () => {
    assert.equal(html('año_ñandú_2 y _sí_'), '<p>año_ñandú_2 y <em>sí</em></p>');
    assert.equal(renderMarkdown("l'été d'ñ 'x'", { smartTypography: true }).html, '<p>l’été d’ñ ‘x’</p>');
  });
});
