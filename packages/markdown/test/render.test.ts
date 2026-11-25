import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { excerpt, readingTimeMinutes, renderMarkdown, sanitizeUrl, slugify } from '../src/index.ts';

const html = (md: string, headingOffset = 0): string => renderMarkdown(md, { headingOffset }).html;

describe('párrafos y énfasis', () => {
  it('renderiza un párrafo', () => {
    assert.equal(html('Hola mundo'), '<p>Hola mundo</p>');
  });

  it('une líneas consecutivas en un solo párrafo y separa por línea en blanco', () => {
    assert.equal(html('uno\ndos\n\ntres'), '<p>uno\ndos</p>\n<p>tres</p>');
  });

  it('negrita, cursiva y tachado', () => {
    assert.equal(html('**a** *b* _c_ ~~d~~'), '<p><strong>a</strong> <em>b</em> <em>c</em> <del>d</del></p>');
  });

  it('anida énfasis distintos', () => {
    assert.equal(html('**negrita con *cursiva* adentro**'), '<p><strong>negrita con <em>cursiva</em> adentro</strong></p>');
  });

  it('triple delimitador = cursiva + negrita', () => {
    assert.equal(html('***hola***'), '<p><em><strong>hola</strong></em></p>');
  });

  it('el guion bajo dentro de una palabra no es énfasis', () => {
    assert.equal(html('usar snake_case_name acá'), '<p>usar snake_case_name acá</p>');
  });

  it('asteriscos rodeados de espacios quedan literales', () => {
    assert.equal(html('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
  });

  it('delimitadores sin cierre quedan literales', () => {
    assert.equal(html('**sin cierre'), '<p>**sin cierre</p>');
  });

  it('los escapes con backslash dan el carácter literal', () => {
    assert.equal(html('\\*no cursiva\\*'), '<p>*no cursiva*</p>');
  });

  it('dos espacios al final de línea = <br>', () => {
    assert.equal(html('a  \nb'), '<p>a<br>\nb</p>');
  });

  it('backslash al final de línea = <br>', () => {
    assert.equal(html('a\\\nb'), '<p>a<br>\nb</p>');
  });
});

describe('código', () => {
  it('código en línea escapa HTML', () => {
    assert.equal(html('usar `<div>` ok'), '<p>usar <code>&lt;div&gt;</code> ok</p>');
  });

  it('código en línea con backticks adentro', () => {
    assert.equal(html('`` a`b ``'), '<p><code>a`b</code></p>');
  });

  it('el énfasis no se interpreta dentro de código', () => {
    assert.equal(html('`*a*`'), '<p><code>*a*</code></p>');
  });

  it('bloque con lenguaje', () => {
    assert.equal(
      html('```ts\nconst a = 1 < 2;\n```'),
      '<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>',
    );
  });

  it('bloque sin lenguaje y sin cierre llega hasta el final', () => {
    assert.equal(html('```\nlinea1\nlinea2'), '<pre><code>linea1\nlinea2</code></pre>');
  });

  it('un lenguaje raro no se inyecta en el atributo class', () => {
    const out = html('```"><script>\nx\n```');
    assert.ok(!out.includes('<script>'));
  });

  it('el contenido de un bloque no se interpreta como Markdown', () => {
    assert.equal(html('```\n# no es titulo\n- ni lista\n```'), '<pre><code># no es titulo\n- ni lista</code></pre>');
  });

  it('un cierre más largo que la apertura también cierra', () => {
    assert.equal(html('```\na\n`````\nafuera'), '<pre><code>a</code></pre>\n<p>afuera</p>');
  });
});

describe('encabezados', () => {
  it('genera id y los registra', () => {
    const result = renderMarkdown('## Introducción a Ñandú');
    assert.equal(result.html, '<h2 id="introduccion-a-nandu">Introducción a Ñandú</h2>');
    assert.deepEqual(result.headings, [{ level: 2, id: 'introduccion-a-nandu', text: 'Introducción a Ñandú' }]);
  });

  it('ids repetidos reciben sufijo numérico', () => {
    const ids = renderMarkdown('## Tema\n\n## Tema\n\n## Tema').headings.map((h) => h.id);
    assert.deepEqual(ids, ['tema', 'tema-2', 'tema-3']);
  });

  it('headingOffset baja los niveles y se limita a h6', () => {
    assert.equal(html('# Título', 1), '<h2 id="titulo">Título</h2>');
    assert.equal(html('###### Hondo', 3), '<h6 id="hondo">Hondo</h6>');
  });

  it('quita los # de cierre', () => {
    assert.equal(html('## Hola ##'), '<h2 id="hola">Hola</h2>');
  });

  it('#sinespacio no es un encabezado', () => {
    assert.equal(html('#hashtag'), '<p>#hashtag</p>');
  });

  it('el id sale del texto plano, sin marcas', () => {
    assert.equal(renderMarkdown('## Usar **`fetch`** con [docs](https://x.com)').headings[0]?.id, 'usar-fetch-con-docs');
  });

  it('un título sin letras usa un id de respaldo', () => {
    assert.equal(renderMarkdown('## ???').headings[0]?.id, 'seccion');
  });

  it('un encabezado dentro de una cita no entra al índice', () => {
    const result = renderMarkdown('> ## Adentro');
    assert.equal(result.headings.length, 0);
    assert.ok(result.html.includes('<h2>Adentro</h2>'));
  });
});

describe('listas', () => {
  it('lista con viñetas apretada (sin <p>)', () => {
    assert.equal(html('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  });

  it('lista numerada respeta el número inicial', () => {
    assert.equal(html('3. a\n4. b'), '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
  });

  it('lista suelta (con línea en blanco) usa <p>', () => {
    assert.equal(html('- a\n\n- b'), '<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>');
  });

  it('listas anidadas', () => {
    assert.equal(html('- a\n  - b\n  - c\n- d'), '<ul>\n<li>a\n<ul>\n<li>b</li>\n<li>c</li>\n</ul></li>\n<li>d</li>\n</ul>');
  });

  it('un ítem puede tener varios párrafos', () => {
    const out = html('- a\n\n  más texto\n- b');
    assert.ok(out.includes('<li><p>a</p>\n<p>más texto</p></li>'));
  });

  it('cambiar de marcador abre otra lista', () => {
    assert.equal(html('- a\n* b'), '<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>');
  });

  it('un código dentro de un ítem', () => {
    const out = html('- paso\n\n  ```sh\n  ls\n  ```');
    assert.ok(out.includes('<pre><code class="language-sh">ls</code></pre>'));
  });

  it('una lista numerada que no empieza en 1 no interrumpe un párrafo', () => {
    assert.equal(html('en\n2024. fue un año'), '<p>en\n2024. fue un año</p>');
  });

  it('continuación perezosa de un ítem', () => {
    assert.equal(html('- uno\ndos'), '<ul>\n<li>uno\ndos</li>\n</ul>');
  });
});

describe('citas, reglas y tablas', () => {
  it('cita simple', () => {
    assert.equal(html('> hola'), '<blockquote>\n<p>hola</p>\n</blockquote>');
  });

  it('cita con continuación perezosa y contenido anidado', () => {
    const out = html('> a\nb\n>\n> - x');
    assert.ok(out.includes('<p>a\nb</p>'));
    assert.ok(out.includes('<li>x</li>'));
  });

  it('regla horizontal', () => {
    assert.equal(html('a\n\n---\n\nb'), '<p>a</p>\n<hr>\n<p>b</p>');
    assert.equal(html('***'), '<hr>');
  });

  it('tabla con alineación', () => {
    const out = html('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    assert.ok(out.includes('<th>a</th><th class="align-center">b</th><th class="align-right">c</th>'));
    assert.ok(out.includes('<td>1</td><td class="align-center">2</td><td class="align-right">3</td>'));
    assert.ok(out.startsWith('<div class="table-wrap"><table>'));
  });

  it('tabla: completa filas cortas, descarta celdas sobrantes y respeta \\|', () => {
    const out = html('a | b\n--|--\n1\n2 | 3 | 4\nx \\| y | z');
    assert.ok(out.includes('<td>1</td><td></td>'));
    assert.ok(out.includes('<td>2</td><td>3</td>'));
    assert.ok(!out.includes('<td>4</td>'));
    assert.ok(out.includes('<td>x | y</td>'));
  });

  it('una línea con | sin fila delimitadora es un párrafo', () => {
    assert.equal(html('a | b'), '<p>a | b</p>');
  });
});

describe('links e imágenes', () => {
  it('link con título; externo lleva rel', () => {
    assert.equal(
      html('[sitio](https://ejemplo.com "Ir")'),
      '<p><a href="https://ejemplo.com" title="Ir" rel="noopener noreferrer">sitio</a></p>',
    );
  });

  it('link relativo y ancla', () => {
    assert.equal(html('[a](/blog/x) [b](#top)'), '<p><a href="/blog/x">a</a> <a href="#top">b</a></p>');
  });

  it('el texto del link admite énfasis y código', () => {
    assert.equal(html('[**a** `b`](/x)'), '<p><a href="/x"><strong>a</strong> <code>b</code></a></p>');
  });

  it('un link no se anida dentro de otro link', () => {
    const out = html('[a [b](/y) c](/x)');
    assert.equal((out.match(/<a /g) ?? []).length, 1);
  });

  it('paréntesis balanceados en la URL', () => {
    assert.equal(html('[w](https://es.wikipedia.org/wiki/Foo_(bar))'), '<p><a href="https://es.wikipedia.org/wiki/Foo_(bar)" rel="noopener noreferrer">w</a></p>');
  });

  it('imagen', () => {
    assert.equal(html('![gato](/img/gato.png "Mi gato")'), '<p><img src="/img/gato.png" alt="gato" title="Mi gato" loading="lazy" decoding="async"></p>');
  });

  it('autolink', () => {
    assert.equal(html('<https://ejemplo.com>'), '<p><a href="https://ejemplo.com" rel="noopener noreferrer">https://ejemplo.com</a></p>');
  });

  it('corchetes sin paréntesis quedan literales', () => {
    assert.equal(html('[no link]'), '<p>[no link]</p>');
  });
});

describe('seguridad', () => {
  it('el HTML crudo se escapa', () => {
    assert.equal(html('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    assert.equal(html('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('javascript: en un link deja solo el texto', () => {
    assert.equal(html('[clic](javascript:alert(1))'), '<p>clic</p>');
  });

  it('esquemas ofuscados también se rechazan', () => {
    assert.equal(html('[x](JaVaScRiPt:alert(1))'), '<p>x</p>');
    assert.equal(html('[x](<java\tscript:alert(1)>)'), '<p>x</p>');
    assert.equal(sanitizeUrl('java\u0000script:alert(1)'), null);
    assert.equal(sanitizeUrl(' javascript:alert(1)'), null);
    assert.equal(sanitizeUrl('vbscript:x'), null);
    assert.equal(sanitizeUrl('data:text/html;base64,PHNjcmlwdD4='), null);
  });

  it('una imagen con URL insegura deja solo el alt', () => {
    assert.equal(html('![ojo](javascript:alert(1))'), '<p>ojo</p>');
  });

  it('las comillas en título, alt y href no rompen el atributo', () => {
    assert.equal(
      html('[x](/a"onmouseover="alert(1) "t\\"itle")'),
      '<p><a href="/a&quot;onmouseover=&quot;alert(1)" title="t&quot;itle">x</a></p>',
    );
    assert.equal(
      html('![a"b](/x.png "t\\"1")'),
      '<p><img src="/x.png" alt="a&quot;b" title="t&quot;1" loading="lazy" decoding="async"></p>',
    );
  });

  it('acepta mailto y tel', () => {
    assert.equal(sanitizeUrl('mailto:a@b.com'), 'mailto:a@b.com');
    assert.equal(sanitizeUrl('tel:+5411'), 'tel:+5411');
  });

  it('los espacios en la URL se codifican', () => {
    assert.equal(sanitizeUrl('/mi imagen.png'), '/mi%20imagen.png');
  });
});

describe('robustez', () => {
  it('entrada vacía', () => {
    assert.deepEqual(renderMarkdown(''), { html: '', headings: [] });
  });

  it('normaliza saltos de línea de Windows', () => {
    assert.equal(html('a\r\n\r\nb'), '<p>a</p>\n<p>b</p>');
  });

  it('anidamiento muy profundo no revienta la pila', () => {
    const md = `${'> '.repeat(500)}hola`;
    assert.ok(html(md).includes('hola'));
  });

  it('énfasis sin cerrar en un texto largo no se cuelga', () => {
    const start = performance.now();
    html('*a '.repeat(3000));
    assert.ok(performance.now() - start < 2000);
  });
});

describe('utilidades de texto', () => {
  it('slugify', () => {
    assert.equal(slugify('  ¡Hola, Mundo! Año 2026  '), 'hola-mundo-ano-2026');
  });

  it('excerpt corta en palabra y agrega …', () => {
    const out = excerpt('palabra '.repeat(50), 40);
    assert.ok(out.endsWith('…'));
    assert.ok(out.length <= 41);
    assert.ok(!out.includes('<'));
  });

  it('excerpt des-escapa entidades una sola vez', () => {
    assert.equal(excerpt('a & b < c'), 'a & b < c');
  });

  it('tiempo de lectura mínimo 1 minuto', () => {
    assert.equal(readingTimeMinutes('corto'), 1);
    assert.equal(readingTimeMinutes('palabra '.repeat(450)), 3);
  });
});
